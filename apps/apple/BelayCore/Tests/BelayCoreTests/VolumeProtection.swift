import Foundation
import Testing

/// Whether the disk the tests run on keeps a file's data protection class. A Mac or an iPhone
/// keeps it; the hosted macOS runner's disk does not, and a test reading the class back there
/// says it cannot apply rather than failing or passing on nothing.
enum VolumeProtection {
  static let kept: Bool = {
    let folder = FileManager.default.temporaryDirectory
      .appending(path: "belay-protection-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: folder) }
    guard
      (try? FileManager.default.createDirectory(
        at: folder, withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUnlessOpen])) != nil
    else { return false }
    let probe = folder.appending(path: "probe")
    guard (try? Data("probe".utf8).write(to: probe, options: .atomic)) != nil else { return false }
    let read = try? FileManager.default.attributesOfItem(atPath: probe.path)[.protectionKey]
    return read as? FileProtectionType == .completeUnlessOpen
  }()

  static let reason: Comment = "this disk does not keep a file's protection class (the hosted macOS runner)"
}
