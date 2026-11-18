import Foundation
import Testing

// The body views never say a gain in red: the Danger token warns of a deletion only, and the body
// views delete through the system's destructive role, which draws its own red. A use of the token
// in any of them fails here, read from the app's sources by path.

private let app = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()
  .appending(path: "Belay", directoryHint: .isDirectory)
private let corps = app.appending(path: "Corps", directoryHint: .isDirectory)
private let outils = app.appending(path: "Outils", directoryHint: .isDirectory)

/// Each line of each Swift file in `folder` that matches `pattern`, as « File.swift:12: line ».
private func lines(in folder: URL, matching pattern: Regex<Substring>) throws -> (files: Int, found: [String]) {
  let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
    .filter { $0.pathExtension == "swift" }
  var found: [String] = []
  for file in files {
    let lines = try String(contentsOf: file, encoding: .utf8).split(
      separator: "\n", omittingEmptySubsequences: false)
    for (index, line) in lines.enumerated() where line.contains(pattern) {
      found.append("\(file.lastPathComponent):\(index + 1): \(line)")
    }
  }
  return (files.count, found)
}

// The token as Swift names it: the generated symbol or the asset's name.
private var danger: Regex<Substring> { #/\.danger\b|"Danger"/# }

@Suite struct BodyColourTests {
  @Test func noBodyViewUsesTheDangerToken() throws {
    let read = try lines(in: corps, matching: danger)
    #expect(read.files > 10, "the body views were read: \(read.files)")
    for line in read.found { Issue.record("uses the Danger token: \(line)") }
  }

  /// A tool's band or warning is never red, and a tool reads the day from the clock it is given,
  /// never the phone's: the fixture's clock and a test's would not reach it.
  @Test func noToolViewUsesDangerOrWallClock() throws {
    let red = try lines(in: outils, matching: danger)
    #expect(red.files >= 8, "the tool views were read: \(red.files)")
    for line in red.found { Issue.record("uses the Danger token: \(line)") }
    for line in try lines(in: outils, matching: #/Date\(\)|\.now\b(?!\()/#).found {
      Issue.record("reads the wall clock: \(line)")
    }
  }
}
