import Foundation
import Testing

// Loops come from the person's instance only: no exercise video or animation ships in the app, its
// Live Activity, the core's resources or the library data the app bundles.

private let appleFolder = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()
private let libraryData = appleFolder.deletingLastPathComponent().deletingLastPathComponent()
  .appending(path: "packages/shared/src/exercises/data", directoryHint: .isDirectory)

private let media: Set<String> = ["mp4", "m4v", "mov", "gif", "webm", "webp", "apng"]

@Suite struct BundleResourceTests {
  @Test func noMediaShipped() throws {
    let folders = [
      appleFolder.appending(path: "Belay", directoryHint: .isDirectory),
      appleFolder.appending(path: "BelayActivity", directoryHint: .isDirectory),
      appleFolder.appending(path: "BelayCore/Sources", directoryHint: .isDirectory),
      libraryData,
    ]
    for folder in folders {
      #expect(FileManager.default.fileExists(atPath: folder.path), "\(folder.path)")
      let walk = FileManager.default.enumerator(at: folder, includingPropertiesForKeys: nil)
      for case let url as URL in walk?.allObjects ?? [] {
        #expect(!media.contains(url.pathExtension.lowercased()), "\(url.path)")
      }
    }
    // Nor does the project name one as a resource from anywhere else.
    let project = try String(
      contentsOf: appleFolder.appending(path: "Belay.xcodeproj/project.pbxproj"), encoding: .utf8)
    for ext in media {
      #expect(!project.contains(".\(ext) "), "project.pbxproj names a .\(ext)")
    }
  }
}
