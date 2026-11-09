import Foundation
import Testing

// Rules the session screens' code keeps, read from the source tree as the catalog tests read the
// catalogs: the app target has no unit tests of its own.

private let appFolder = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent().appending(path: "Belay", directoryHint: .isDirectory)

/// Each Swift line of the app's folder `path`, with its place.
private func lines(in path: String) throws -> [(place: String, text: String)] {
  let folder = appFolder.appending(path: path, directoryHint: .isDirectory)
  let urls = (FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)?.allObjects as? [URL]) ?? []
  return try urls.filter { $0.pathExtension == "swift" }.sorted { $0.path < $1.path }.flatMap { url in
    try String(contentsOf: url, encoding: .utf8).components(separatedBy: "\n").enumerated().map {
      ("\(url.lastPathComponent):\($0.offset + 1)", $0.element)
    }
  }
}

@Suite struct SessionSourceTests {
  /// The unit and the reserve's abbreviation are words of the catalog, so English can write them
  /// its own way: no « kg » or « RIR » typed straight into the session's text.
  @Test func unitsGoThroughTheCatalog() throws {
    let words = [#""kg""#, #"\u{202F}kg"#, #""RIR "#]
    for (place, text) in try lines(in: "Session") where words.contains(where: text.contains) {
      let trimmed = text.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("//") { continue }
      #expect(
        text.contains("localized:") || text.contains("tableName:") || text.contains("table:"),
        "\(place): \(trimmed)")
    }
  }

  /// One spring moves the app: every animation is Motion's.
  @Test func oneSpring() throws {
    let named = #/\.(snappy|bouncy|smooth|spring)\b/#
    for (place, text) in try lines(in: "") where !place.hasPrefix("Motion.swift") {
      guard text.replacing("Motion.spring", with: "").contains(named) else { continue }
      Issue.record("\(place): \(text.trimmingCharacters(in: .whitespaces))")
    }
  }
}
