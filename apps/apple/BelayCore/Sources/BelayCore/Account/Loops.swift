public import Foundation
import Synchronization
import os

/// Where a library exercise's loop is served on the instance, as the web asks for it: only the
/// dataset's exercises (`ds:` and four digits) have one.
public func loopPath(_ exerciseId: String) -> String? {
  guard let match = exerciseId.wholeMatch(of: /ds:(\d{4})/) else { return nil }
  return "media/exercises/\(match.1)"
}

/// The exercise loops this phone fetched from the person's instance, kept in the caches folder
/// under the instance's key so one plays again offline. Nothing is asked of any other server, and
/// nothing at all while the instance says it serves no media. A loop that failed is not asked for
/// again until the app starts anew, as the web keeps its failures for the page's life.
public struct Loops: Sendable {
  /// As the web's `KEPT_LOOPS`: kept by count, the oldest out. A size budget would need each
  /// file's bytes read at every write; at about 100 KB a loop this stays near 15 MB.
  static let cap = 150

  private let folder: URL
  private let client: HTTPClient
  private let failed = Failed()

  public init(folder: URL, instanceKey: String, client: HTTPClient) {
    let safe = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._"))
    // Percent-encoded, so no instance's key reaches outside the folder.
    self.folder = folder.appendingPathComponent(
      instanceKey.addingPercentEncoding(withAllowedCharacters: safe) ?? "", isDirectory: true)
    self.client = client
  }

  /// The loop of `id` already on this phone, which plays without the network.
  public func kept(_ id: String) -> URL? {
    guard let url = file(id), FileManager.default.fileExists(atPath: url.path) else { return nil }
    return url
  }

  /// The loop of `id`: kept, else fetched from `instance` with the session's token and kept. Nil
  /// when the instance serves no media, the exercise has no loop, or the fetch failed now or
  /// earlier in this run.
  public func fetch(_ id: String, token: String, at instance: Instance, media: Bool) async -> URL? {
    guard media, let path = loopPath(id), let url = file(id) else { return nil }
    if let kept = kept(id) { return kept }
    guard !failed.contains(id) else { return nil }
    do {
      let (data, response) = try await client.send(request(path, token: token, at: instance))
      guard response.statusCode == 200, !data.isEmpty else {
        failed.insert(id)
        Self.log.info("loop refused: \(response.statusCode, privacy: .public)")
        return nil
      }
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
      prune()
      return url
    } catch {
      failed.insert(id)
      Self.log.info("loop not fetched: \(AccountStore.logLabel(error), privacy: .public)")
      return nil
    }
  }

  /// Sign-out's: every kept loop, of every instance, goes.
  public static func removeAll(in folder: URL) {
    guard FileManager.default.fileExists(atPath: folder.path) else { return }
    do {
      try FileManager.default.removeItem(at: folder)
    } catch {
      log.error("loops not removed: \(AccountStore.logLabel(error), privacy: .public)")
    }
  }

  private func file(_ id: String) -> URL? {
    guard let match = id.wholeMatch(of: /ds:(\d{4})/) else { return nil }
    return folder.appendingPathComponent("\(match.1).mp4")
  }

  /// Keeps the newest `cap` loops, by the time each was written.
  private func prune() {
    let key = URLResourceKey.contentModificationDateKey
    guard
      let files = try? FileManager.default.contentsOfDirectory(
        at: folder, includingPropertiesForKeys: [key]), files.count > Self.cap
    else { return }
    let dated = files.map { url in
      (url, (try? url.resourceValues(forKeys: [key]).contentModificationDate) ?? .distantPast)
    }
    for (url, _) in dated.sorted(by: { $0.1 > $1.1 }).dropFirst(Self.cap) {
      // One that will not go stays one more: the next write tries it again.
      try? FileManager.default.removeItem(at: url)
    }
  }

  private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "loops")
}

/// The exercises whose loop failed in this run, shared by every copy of a `Loops`.
private final class Failed: Sendable {
  private let ids = Mutex<Set<String>>([])
  func contains(_ id: String) -> Bool { ids.withLock { $0.contains(id) } }
  func insert(_ id: String) { _ = ids.withLock { $0.insert(id) } }
}
