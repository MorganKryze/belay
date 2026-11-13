import Foundation
import Testing

// The app's String Catalogs, read from the source tree: every string the app shows exists in
// French and English, with the plural forms each language needs, and the French follows its
// typography. The app target has no unit tests of its own, so the core's suite reads its files.

/// The app's sources and its Live Activity's, beside this package.
private let appleFolder = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()
private let appFolder = appleFolder.appending(path: "Belay", directoryHint: .isDirectory)
private let activityFolder = appleFolder.appending(path: "BelayActivity", directoryHint: .isDirectory)

private func catalogs() throws -> [URL] {
  let urls = [appFolder, activityFolder].flatMap { folder in
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

@Suite struct StringsTests {
  @Test func appHasCatalogs() throws {
    #expect(try catalogs().count >= 2, "the app's catalogs are found at \(appFolder.path)")
    #expect(
      try catalogs().contains { $0.path.hasPrefix(activityFolder.path) },
      "the Live Activity's catalog is found at \(activityFolder.path)")
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

  /// Every count of Accueil, Séances and the session's tools, tried at 0, 1 and 2: the form each
  /// language's rule chooses reads right. A new count with no line here fails.
  @Test func countsReadRightAtZeroOneAndTwo() throws {
    // Key, then French and English at 0, 1 and 2; a key with two counts gets the same at each.
    let expected: [String: (fr: [String], en: [String])] = [
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
      "SessionTools.xcstrings: %lld secondes restantes": (
        ["0 seconde restante", "1 seconde restante", "2 secondes restantes"],
        ["0 seconds left", "1 second left", "2 seconds left"]
      ),
    ]
    var counts: Set<String> = []
    for url in try catalogs()
    where ["Accueil.xcstrings", "Seances.xcstrings", "SessionTools.xcstrings"]
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
