import Foundation
import Testing

// The app's String Catalogs, read from the source tree: every string the app shows exists in
// French and English, with the plural forms each language needs, and the French follows its
// typography. The app target has no unit tests of its own, so the core's suite reads its files.

/// The app's sources, its Live Activity's and its watch app's, beside this package.
private let appleFolder = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()
private let appFolder = appleFolder.appending(path: "Belay", directoryHint: .isDirectory)
private let activityFolder = appleFolder.appending(path: "BelayActivity", directoryHint: .isDirectory)
private let watchFolder = appleFolder.appending(path: "BelayWatch", directoryHint: .isDirectory)

private func catalogs() throws -> [URL] {
  let urls = [appFolder, activityFolder, watchFolder].flatMap { folder in
    let walk = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)
    return (walk?.allObjects as? [URL]) ?? []
  }
  return urls.filter { $0.pathExtension == "xcstrings" }.sorted { $0.path < $1.path }
}

/// A plural inside a format, `%#@name@`: its argument's forms, one per plural category.
private struct Substitution {
  /// The argument it counts, from 1.
  let argument: Int
  let forms: [String: String]
}

/// One language's text for a key: a single value, one per plural category, or a format whose
/// `%#@name@` parts are each a plural of their own argument.
private enum Localized {
  case single(String)
  case plural([String: String])
  case substituted(String, [String: Substitution])

  init?(_ json: Any?) {
    guard let json = json as? [String: Any] else { return nil }
    if let unit = json["stringUnit"] as? [String: Any], let value = unit["value"] as? String {
      let substitutions = json["substitutions"] as? [String: Any] ?? [:]
      guard !substitutions.isEmpty else {
        self = .single(value)
        return
      }
      var parts: [String: Substitution] = [:]
      for (name, part) in substitutions {
        let part = part as? [String: Any] ?? [:]
        parts[name] = Substitution(
          argument: part["argNum"] as? Int ?? 0, forms: pluralForms(part["variations"]))
      }
      self = .substituted(value, parts)
    } else if (json["variations"] as? [String: Any])?["plural"] != nil {
      self = .plural(pluralForms(json["variations"]))
    } else {
      return nil
    }
  }

  var values: [String] {
    switch self {
    case .single(let value): [value]
    case .plural(let forms): Array(forms.values)
    case .substituted(let format, let parts): [format] + parts.values.flatMap(\.forms.values)
    }
  }

  /// Each plural it holds, by its forms; empty for a single value.
  var plurals: [[String: String]] {
    switch self {
    case .single: []
    case .plural(let forms): [forms]
    case .substituted(_, let parts): parts.values.map(\.forms)
    }
  }
}

/// A `variations` object's plural forms, by category.
private func pluralForms(_ variations: Any?) -> [String: String] {
  let plural = (variations as? [String: Any])?["plural"] as? [String: Any] ?? [:]
  var forms: [String: String] = [:]
  for (category, form) in plural {
    let unit = (form as? [String: Any])?["stringUnit"] as? [String: Any]
    if let value = unit?["value"] as? String { forms[category] = value }
  }
  return forms
}

/// The CLDR plural category of a whole count: French puts 0 and 1 in « one », English only 1.
private func category(_ count: Int, in language: String) -> String {
  switch language {
  case "fr": count == 0 || count == 1 ? "one" : "other"
  default: count == 1 ? "one" : "other"
  }
}

/// The text shown for `counts`, its plurals' forms chosen by `language`'s rule.
private func render(_ text: Localized, in language: String, _ counts: [Int]) -> String {
  switch text {
  case .single(let format):
    return fill(format, counts)
  case .plural(let forms):
    return fill(forms[category(counts[0], in: language)] ?? "<no form>", counts)
  case .substituted(let format, let parts):
    let chosen = format.replacing(/%(?:\d+\$)?#@(\w+)@/) { match in
      guard let part = parts[String(match.1)], counts.indices.contains(part.argument - 1) else {
        return "<no part \(match.1)>"
      }
      let count = counts[part.argument - 1]
      let form = part.forms[category(count, in: language)] ?? "<no form>"
      return form.replacing("%arg", with: "\(count)")
    }
    return fill(chosen, counts)
  }
}

/// `format` with its `%lld` and `%n$lld` arguments written out.
private func fill(_ format: String, _ counts: [Int]) -> String {
  var next = 0
  return format.replacing(/%(?:(\d+)\$)?lld/) { match in
    let index = match.1.flatMap { Int($0) }.map { $0 - 1 } ?? next
    next += 1
    return counts.indices.contains(index) ? "\(counts[index])" : "<no argument>"
  }
}

private struct Entry {
  let key: String
  let french: Localized
  let english: Localized?
}

private func entries(of url: URL) throws -> [Entry] {
  let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  #expect(json?["sourceLanguage"] as? String == "fr", "\(url.lastPathComponent) is written in French")
  let strings = json?["strings"] as? [String: Any] ?? [:]
  return strings.compactMap { key, value in
    let string = value as? [String: Any] ?? [:]
    if string["shouldTranslate"] as? Bool == false { return nil }
    let localizations = string["localizations"] as? [String: Any] ?? [:]
    // French is the source: the key is its text unless the catalog gives French forms.
    return Entry(
      key: key, french: Localized(localizations["fr"]) ?? .single(key),
      english: Localized(localizations["en"]))
  }
}

/// The places French typography asks for a narrow no-break space and does not have one.
func frenchTypographyFaults(_ text: String) -> [String] {
  let chars = Array(text)
  var faults: [String] = []
  for (i, c) in chars.enumerated() {
    let before = i > 0 ? chars[i - 1] : nil
    let after = i + 1 < chars.count ? chars[i + 1] : nil
    switch c {
    case ":", ";", "?", "!":
      // A URL's scheme, or a mark doubled (« ?! »), takes no space.
      if c == ":" && after == "/" { continue }
      if let before, ":;?!".contains(before) { continue }
      if before != "\u{202F}" { faults.append("no narrow space before « \(c) »") }
    case "%":
      // `%%` is a percent sign; any other `%` starts an argument.
      if after == "%" && before != "\u{202F}" && before != "%" {
        faults.append("no narrow space before « % »")
      }
    case "«":
      if after != "\u{202F}" { faults.append("no narrow space after « «»") }
    case "»":
      if before != "\u{202F}" { faults.append("no narrow space before « »»") }
    default: continue
    }
  }
  return faults
}

/// A key the app's source asks a table for: its text, and a pattern any catalog key it can mean
/// matches, each interpolation standing for a format argument.
private struct SourceKey {
  let table: String
  let text: String
  let pattern: Regex<Substring>
  let at: String
  /// The Swift file the key is written in.
  let file: URL
}

/// Every string literal written straight before a `tableName:` or `table:` argument in the app's,
/// the Live Activity's and the watch app's Swift files: `Text("…", tableName: "Outils")`,
/// `String(localized: "…", table: "Reglages")`. A key passed through a variable is not seen.
private func sourceKeys() throws -> [SourceKey] {
  let files = [appFolder, activityFolder, watchFolder].flatMap { folder in
    let walk = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)
    return ((walk?.allObjects as? [URL]) ?? []).filter { $0.pathExtension == "swift" }
  }
  var keys: [SourceKey] = []
  for file in files {
    let code = Array(try String(contentsOf: file, encoding: .utf8))
    var i = 0
    while i < code.count {
      guard code[i] == "\"", let (parts, end) = literal(code, from: i) else {
        i += 1
        continue
      }
      i = end
      let rest = String(code[end..<min(code.count, end + 80)])
      guard let match = rest.prefixMatch(of: /\s*,\s*(?:tableName|table)\s*:\s*"(\w+)"/) else { continue }
      var text = ""
      var pattern = ""
      for part in parts {
        switch part {
        case .text(let piece):
          text += piece
          // A literal % may be written doubled in a format key.
          pattern += piece.map { $0 == "%" ? "%%?" : NSRegularExpression.escapedPattern(for: String($0)) }
            .joined()
        case .argument:
          text += "\\(…)"
          pattern += #"%(?:\d+\$)?(?:ll[du]|l?[duf]|@|\.\d+f)"#
        }
      }
      let line = code[..<end].filter { $0 == "\n" }.count + 1
      keys.append(
        SourceKey(
          table: String(match.1), text: text, pattern: try Regex(pattern),
          at: "\(file.lastPathComponent):\(line)", file: file))
    }
  }
  return keys
}

private enum LiteralPart {
  case text(String)
  case argument
}

/// The one-line string literal opening at `start`, in parts, and the index just past it; nil for a
/// multi-line or raw literal, or one that does not close.
private func literal(_ code: [Character], from start: Int) -> ([LiteralPart], Int)? {
  guard start + 2 < code.count, !(code[start + 1] == "\"" && code[start + 2] == "\"") else { return nil }
  if start > 0, code[start - 1] == "#" { return nil }
  var parts: [LiteralPart] = []
  var text = ""
  var i = start + 1
  while i < code.count {
    let c = code[i]
    if c == "\n" { return nil }
    if c == "\"" {
      if !text.isEmpty { parts.append(.text(text)) }
      return (parts, i + 1)
    }
    if c == "\\", i + 1 < code.count {
      let next = code[i + 1]
      switch next {
      case "(":
        if !text.isEmpty { parts.append(.text(text)) }
        text = ""
        parts.append(.argument)
        // Past the interpolation, nested parentheses and string literals included.
        var depth = 1
        i += 2
        while i < code.count, depth > 0 {
          if code[i] == "\"", let (_, end) = literal(code, from: i) {
            i = end
            continue
          }
          if code[i] == "(" { depth += 1 }
          if code[i] == ")" { depth -= 1 }
          i += 1
        }
        continue
      case "u":
        let hex = code[(i + 3)...].prefix { $0 != "}" }
        if let value = UInt32(String(hex), radix: 16), let scalar = Unicode.Scalar(value) {
          text.append(Character(scalar))
        }
        i += 3 + hex.count + 1
        continue
      case "n": text.append("\n")
      case "t": text.append("\t")
      default: text.append(next)
      }
      i += 2
      continue
    }
    text.append(c)
    i += 1
  }
  return nil
}

@Suite struct StringsTests {
  /// Every key the source asks a table for is in that table, so no screen falls back to the
  /// French it was written in on an English phone. A key typed with a plain space where the
  /// catalog has a narrow one is a miss.
  @Test func everySourceKeyIsInItsTable() throws {
    var tables: [String: [String]] = [:]
    for url in try catalogs() {
      let json = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
      let strings = json?["strings"] as? [String: Any] ?? [:]
      tables[url.deletingPathExtension().lastPathComponent, default: []] += strings.keys
    }
    let keys = try sourceKeys()
    #expect(keys.count > 500, "the source's keys are found: \(keys.count)")
    for key in keys {
      let table = try #require(tables[key.table], "\(key.at): the table \(key.table) exists")
      #expect(
        table.contains { $0.wholeMatch(of: key.pattern) != nil },
        "\(key.at): « \(key.text) » is in \(key.table)")
    }
  }

  /// The watch's and the Live Activity's Swift files are read too, so a key either one asks for is
  /// held to its table like the app's.
  @Test func theWatchAndTheLiveActivitySourcesAreScanned() throws {
    let keys = try sourceKeys()
    #expect(keys.contains { $0.file.path.hasPrefix(watchFolder.path) }, "a key comes from the watch app's sources")
    #expect(
      keys.contains { $0.file.path.hasPrefix(activityFolder.path) }, "a key comes from the Live Activity's sources")
  }

  @Test func appHasCatalogs() throws {
    #expect(try catalogs().count >= 2, "the app's catalogs are found at \(appFolder.path)")
    #expect(
      try catalogs().contains { $0.path.hasPrefix(activityFolder.path) },
      "the Live Activity's catalog is found at \(activityFolder.path)")
    #expect(
      try catalogs().contains { $0.path.hasPrefix(watchFolder.path) },
      "the watch app's catalog is found at \(watchFolder.path)")
  }

  @Test func everyKeyHasFrenchAndEnglish() throws {
    for url in try catalogs() {
      for entry in try entries(of: url) {
        let where_ = "\(url.lastPathComponent): \(entry.key)"
        let english = try #require(entry.english, "\(where_) has English")
        #expect(english.values.allSatisfy { !$0.isEmpty }, "\(where_) has English text")
        #expect(entry.french.values.allSatisfy { !$0.isEmpty }, "\(where_) has French text")
      }
    }
  }

  /// A plural in one language is a plural in the other, each with its `one` and `other` forms,
  /// whether the whole text is plural or only a part written through `substitutions`.
  @Test func pluralsHaveEveryForm() throws {
    for url in try catalogs() {
      for entry in try entries(of: url) {
        let languages = [("fr", entry.french), ("en", entry.english)]
        guard languages.contains(where: { !($0.1?.plurals.isEmpty ?? true) }) else { continue }
        for (language, text) in languages {
          let plurals = text?.plurals ?? []
          if plurals.isEmpty {
            Issue.record("\(url.lastPathComponent): \(entry.key) has no \(language) plural")
          }
          for forms in plurals {
            #expect(
              forms["one"] != nil && forms["other"] != nil,
              "\(url.lastPathComponent): \(entry.key) has \(language) one and other")
          }
          if case .substituted(let format, let parts) = text {
            for match in format.matches(of: /#@(\w+)@/) {
              #expect(
                parts[String(match.1)] != nil,
                "\(url.lastPathComponent): \(entry.key) has its \(language) part \(match.1)")
            }
          }
        }
      }
    }
  }

  /// Every count of the app's screens, Réglages, the account and the tools included, tried at 0, 1
  /// and 2: the form each language's rule chooses reads right. A new count with no line here fails.
  @Test func countsReadRightAtZeroOneAndTwo() throws {
    // Key, then French and English at 0, 1 and 2; a key with two counts gets the same at each.
    let expected: [String: (fr: [String], en: [String])] = [
      "Corps.xcstrings: Encore %lld pesées cette semaine": (
        ["Encore 0 pesée cette semaine", "Encore 1 pesée cette semaine", "Encore 2 pesées cette semaine"],
        ["0 more weigh-ins this week", "1 more weigh-in this week", "2 more weigh-ins this week"]
      ),
      "Exercices.xcstrings: %lld exercices": (
        ["0 exercice", "1 exercice", "2 exercices"], ["0 exercises", "1 exercise", "2 exercises"]
      ),
      "Entries.xcstrings: pris · depuis %lld jours": (
        ["pris · depuis 0 jour", "pris · depuis 1 jour", "pris · depuis 2 jours"],
        ["taken · for 0 days", "taken · for 1 day", "taken · for 2 days"]
      ),
      "Trend.xcstrings: %lld pesées": (
        ["0 pesée", "1 pesée", "2 pesées"], ["0 weigh-ins", "1 weigh-in", "2 weigh-ins"]
      ),
      "Trend.xcstrings: %lld annotations": (
        ["0 annotation", "1 annotation", "2 annotations"],
        ["0 annotations", "1 annotation", "2 annotations"]
      ),
      "Activity.xcstrings: %lld activités": (
        ["0 activité", "1 activité", "2 activités"], ["0 activities", "1 activity", "2 activities"]
      ),
      "Accueil.xcstrings: %lld séances": (
        ["0 séance", "1 séance", "2 séances"], ["0 sessions", "1 session", "2 sessions"]
      ),
      "Seances.xcstrings: %lld séances": (
        ["0 séance", "1 séance", "2 séances"], ["0 sessions", "1 session", "2 sessions"]
      ),
      "Seances.xcstrings: %lld séances par semaine": (
        ["0 séance par semaine", "1 séance par semaine", "2 séances par semaine"],
        ["0 sessions a week", "1 session a week", "2 sessions a week"]
      ),
      "Seances.xcstrings: %lld séances et %lld jours de repos par semaine.": (
        [
          "0 séance et 0 jour de repos par semaine.", "1 séance et 1 jour de repos par semaine.",
          "2 séances et 2 jours de repos par semaine.",
        ],
        [
          "0 sessions and 0 rest days a week.", "1 session and 1 rest day a week.",
          "2 sessions and 2 rest days a week.",
        ]
      ),
      "Seances.xcstrings: %lld séries": (
        ["0 série", "1 série", "2 séries"], ["0 sets", "1 set", "2 sets"]
      ),
      "Account.xcstrings: %lld saisies pas encore envoyées\u{202F}: elles partiront à ta prochaine connexion sur cet appareil.":
        (
          [
            "0 saisie pas encore envoyée\u{202F}: elle partira à ta prochaine connexion sur cet appareil.",
            "1 saisie pas encore envoyée\u{202F}: elle partira à ta prochaine connexion sur cet appareil.",
            "2 saisies pas encore envoyées\u{202F}: elles partiront à ta prochaine connexion sur cet appareil.",
          ],
          [
            "0 entries not sent yet: they will go at your next sign-in on this device.",
            "1 entry not sent yet: it will go at your next sign-in on this device.",
            "2 entries not sent yet: they will go at your next sign-in on this device.",
          ]
        ),
      "Reglages.xcstrings: %lld jours marqués": (
        ["0 jour marqué", "1 jour marqué", "2 jours marqués"], ["0 days ticked", "1 day ticked", "2 days ticked"]
      ),
      "Outils.xcstrings: %lld séries": (
        ["0 série", "1 série", "2 séries"], ["0 sets", "1 set", "2 sets"]
      ),
      "SessionTools.xcstrings: %lld secondes restantes": (
        ["0 seconde restante", "1 seconde restante", "2 secondes restantes"],
        ["0 seconds left", "1 second left", "2 seconds left"]
      ),
    ]
    var counts: Set<String> = []
    for url in try catalogs()
    where [
      "Account.xcstrings", "Accueil.xcstrings", "Activity.xcstrings", "Corps.xcstrings", "Entries.xcstrings",
      "Exercices.xcstrings", "Outils.xcstrings", "Reglages.xcstrings", "Seances.xcstrings", "SessionTools.xcstrings",
      "Trend.xcstrings",
    ]
      .contains(url.lastPathComponent)
    {
      for entry in try entries(of: url) where !entry.french.plurals.isEmpty {
        let name = "\(url.lastPathComponent): \(entry.key)"
        counts.insert(name)
        guard let want = expected[name], let english = entry.english else { continue }
        let arguments = entry.key.matches(of: /%lld/).count
        for (n, (fr, en)) in zip(want.fr, want.en).enumerated() {
          let at = Array(repeating: n, count: arguments)
          #expect(render(entry.french, in: "fr", at) == fr, "\(name) at \(n) in French")
          #expect(render(english, in: "en", at) == en, "\(name) at \(n) in English")
        }
      }
    }
    #expect(counts == Set(expected.keys), "every count has its line, and every line its count")
  }

  /// The rule and the reading themselves, on a text written for them.
  @Test func renderChoosesEachLanguagesForm() {
    let text = Localized.substituted(
      "%#@a@ sur %2$lld", ["a": Substitution(argument: 1, forms: ["one": "%arg x", "other": "%arg xs"])])
    #expect(render(text, in: "fr", [0, 5]) == "0 x sur 5")
    #expect(render(text, in: "en", [0, 5]) == "0 xs sur 5")
    #expect(render(text, in: "en", [1, 5]) == "1 x sur 5")
    #expect(render(.plural(["one": "%lld y", "other": "%lld ys"]), in: "fr", [2]) == "2 ys")
  }

  @Test func frenchTypography() throws {
    for url in try catalogs() {
      for entry in try entries(of: url) {
        for value in entry.french.values {
          let faults = frenchTypographyFaults(value)
          #expect(faults.isEmpty, "\(url.lastPathComponent): \(value): \(faults)")
        }
      }
    }
  }

  /// English writes « 0.7% » where French writes « 0,7 % »: the sign sits in the catalog per
  /// language, and no English percent takes a space.
  @Test func englishPercentTakesNoSpace() throws {
    let url = try #require(try catalogs().first { $0.lastPathComponent == "Corps.xcstrings" })
    let sign = try #require(
      try entries(of: url).first { $0.key == "%@\u{202F}%%" }, "the percent sign is in Corps's catalog")
    #expect(sign.english?.values == ["%@%%"])
    for url in try catalogs() {
      for entry in try entries(of: url) {
        for value in entry.english?.values ?? [] {
          #expect(
            !value.contains("\u{202F}%%") && !value.contains(" %%"), "\(url.lastPathComponent): \(value)")
        }
      }
    }
  }

  /// In French a workout is a « séance »: the word « session » never reaches the screen, the
  /// sign-in's own included.
  @Test func frenchSaysSeance() throws {
    for url in try catalogs() {
      for entry in try entries(of: url) {
        for value in entry.french.values {
          #expect(
            value.range(of: "session", options: .caseInsensitive) == nil,
            "\(url.lastPathComponent): \(value)")
        }
      }
    }
  }

  /// The read text names the steps the import reads, in both languages (A43).
  @Test func healthReadNamesTheSteps() throws {
    let url = appFolder.appending(path: "InfoPlist.xcstrings")
    let texts = Dictionary(uniqueKeysWithValues: try entries(of: url).map { ($0.key, $0) })
    let entry = try #require(texts["NSHealthShareUsageDescription"])
    #expect(entry.french.values.joined().contains("tes pas"))
    #expect(entry.english?.values.joined().contains("steps") == true)
  }

  /// iOS asks for Health access with these texts: they name every type Belay reads and writes,
  /// weigh-ins included, and the project's own French copy is the catalog's.
  @Test func healthPermissionsNameTheWeighIns() throws {
    let url = appFolder.appending(path: "InfoPlist.xcstrings")
    let texts = Dictionary(uniqueKeysWithValues: try entries(of: url).map { ($0.key, $0) })
    let project = try String(
      contentsOf: appleFolder.appending(path: "Belay.xcodeproj/project.pbxproj"), encoding: .utf8)
    for key in ["NSHealthShareUsageDescription", "NSHealthUpdateUsageDescription"] {
      let entry = try #require(texts[key], "\(key) is in the catalog")
      let french = entry.french.values.joined()
      #expect(french.contains("tes pesées"), "\(key): \(french)")
      #expect(
        entry.english?.values.joined().contains("weigh-ins") == true, "\(key) in English")
      let settings = project.components(separatedBy: "\n")
        .filter { $0.contains("INFOPLIST_KEY_\(key) = ") }
      #expect(settings.count == 2, "\(key) in Debug and Release")
      for line in settings {
        #expect(line.contains("\"\(french)\""), "\(key) in the project: \(line)")
      }
    }
  }

  /// The check itself: it would catch what a catalog could get wrong.
  @Test func typographyCheckCatchesFaults() {
    #expect(!frenchTypographyFaults("Exemple : belay.fr").isEmpty)
    #expect(!frenchTypographyFaults("Prêt ?").isEmpty)
    #expect(!frenchTypographyFaults("Prêt?").isEmpty)
    #expect(!frenchTypographyFaults("« séance »").isEmpty)
    #expect(!frenchTypographyFaults("50 %%").isEmpty)
    #expect(frenchTypographyFaults("Exemple\u{202F}: https://belay.fr").isEmpty)
    #expect(frenchTypographyFaults("«\u{202F}séance\u{202F}» à 50\u{202F}%% de %lld").isEmpty)
    #expect(frenchTypographyFaults("Vraiment\u{202F}?!").isEmpty)
  }
}
