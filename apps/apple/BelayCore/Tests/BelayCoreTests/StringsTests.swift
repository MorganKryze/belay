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

/// One language's text for a key: a single value, or one per plural category.
private enum Localized {
  case single(String)
  case plural([String: String])

  init?(_ json: Any?) {
    guard let json = json as? [String: Any] else { return nil }
    if let unit = json["stringUnit"] as? [String: Any], let value = unit["value"] as? String {
      self = .single(value)
    } else if let variations = json["variations"] as? [String: Any],
      let plural = variations["plural"] as? [String: Any]
    {
      var forms: [String: String] = [:]
      for (category, form) in plural {
        let unit = (form as? [String: Any])?["stringUnit"] as? [String: Any]
        if let value = unit?["value"] as? String { forms[category] = value }
      }
      self = .plural(forms)
    } else {
      return nil
    }
  }

  var values: [String] {
    switch self {
    case .single(let value): [value]
    case .plural(let forms): Array(forms.values)
    }
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

  /// A plural in one language is a plural in the other, each with its `one` and `other` forms.
  @Test func pluralsHaveEveryForm() throws {
    for url in try catalogs() {
      for entry in try entries(of: url) {
        let languages = [("fr", entry.french), ("en", entry.english)]
        guard languages.contains(where: { if case .plural = $0.1 { true } else { false } }) else {
          continue
        }
        for (language, text) in languages {
          guard case .plural(let forms) = text else {
            Issue.record("\(url.lastPathComponent): \(entry.key) has no \(language) plural")
            continue
          }
          #expect(
            forms["one"] != nil && forms["other"] != nil,
            "\(url.lastPathComponent): \(entry.key) has \(language) one and other")
        }
      }
    }
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
