import Foundation
import Testing

// The body views never say a gain in red: the Danger token warns of a deletion only, and the body
// views delete through the system's destructive role, which draws its own red. A use of the token
// in any of them fails here, read from the app's sources by path.

private let corps = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()
  .appending(path: "Belay/Corps", directoryHint: .isDirectory)

@Suite struct BodyColourTests {
  @Test func noBodyViewUsesTheDangerToken() throws {
    // The token as Swift names it: the generated symbol or the asset's name.
    let danger = #/\.danger\b|"Danger"/#
    let files = try FileManager.default.contentsOfDirectory(
      at: corps, includingPropertiesForKeys: nil
    ).filter { $0.pathExtension == "swift" }
    #expect(files.count > 10, "the body views were read: \(files.count)")
    for file in files {
      let lines = try String(contentsOf: file, encoding: .utf8).split(
        separator: "\n", omittingEmptySubsequences: false)
      for (index, line) in lines.enumerated() where line.contains(danger) {
        Issue.record("\(file.lastPathComponent):\(index + 1) uses the Danger token: \(line)")
      }
    }
  }
}
