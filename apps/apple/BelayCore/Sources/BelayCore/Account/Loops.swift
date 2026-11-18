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
/// under the account's own name so one plays again offline. Nothing is asked of any other server,
/// and nothing at all while the instance says it serves no media. A loop that failed is not asked
/// for again until the app starts anew, as the web keeps its failures for the page's life.
public struct Loops: Sendable {
  /// As the web's `KEPT_LOOPS`: kept by count, the oldest out. A size budget would need each
  /// file's bytes read at every write; at about 100 KB a loop this stays near 15 MB.
  static let cap = 150
  /// The instance's own ceiling (`MEDIA_MAX_BYTES`): a bigger body is not one of its loops.
  static let maxBytes = 8 * 1024 * 1024
  /// The store's own class, named at each write: a loop tells which exercise was opened.
  static let options: Data.WritingOptions = [.atomic, .completeFileProtectionUntilFirstUserAuthentication]

  private let folder: URL
  private let client: HTTPClient
  private let failed = Failed()
  private let inFlight = InFlight()
  private let closed = Closed()

  public init(folder: URL, userId: String, origin: URL, client: HTTPClient) {
    // Named as the account's store is, so another person on the same instance never sees which
    // loops this one looked at, and percent-encoded, so no id reaches outside the folder.
    self.folder = AccountStore.fileURL(userId: userId, origin: origin, in: folder).deletingPathExtension()
    self.client = client
  }

  /// The loop of `id` already on this phone, which plays without the network.
  public func kept(_ id: String) -> URL? {
    guard let url = file(id), FileManager.default.fileExists(atPath: url.path) else { return nil }
    return url
  }

  /// The loop of `id`: kept, else fetched from `instance` with the session's token and kept. Nil
  /// when the instance serves no media, the exercise has no loop, or the fetch failed now or
  /// earlier in this run. A fetch already out for `id`, a row's thumbnail and its page asking at
  /// once, is awaited rather than sent again.
  public func fetch(_ id: String, token: String, at instance: Instance, media: Bool) async -> URL? {
    guard media, !closed.isClosed, let path = loopPath(id), let url = file(id) else { return nil }
    if let kept = kept(id) { return kept }
    guard !failed.contains(id) else { return nil }
    let task = inFlight.task(id) {
      Task { await download(id, path: path, to: url, token: token, at: instance) }
    }
    let fetched = await task.value
    inFlight.done(id)
    return fetched
  }

  private func download(_ id: String, path: String, to url: URL, token: String, at instance: Instance) async
    -> URL?
  {
    do {
      let (data, response) = try await client.send(request(path, token: token, at: instance))
      // Only a loop is kept: a page served in its place, a login form say, is a failure.
      guard response.statusCode == 200, response.mimeType?.lowercased() == "video/mp4", !data.isEmpty,
        data.count <= Self.maxBytes
      else {
        failed.insert(id)
        Self.log.info("loop refused: \(response.statusCode, privacy: .public)")
        return nil
      }
      let written = try closed.unlessClosed {
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        try data.write(to: url, options: Self.options)
      }
      guard written else { return nil }
      prune()
      return url
    } catch {
      failed.insert(id)
      Self.log.info("loop not fetched: \(AccountStore.logLabel(error), privacy: .public)")
      return nil
    }
  }

  /// The account is going: a fetch still out writes nothing, and none starts. Called before
  /// `removeAll`, so no loop lands in the folder after it went.
  public func close() {
    closed.close()
    inFlight.cancelAll()
  }

  /// Sign-out's: every kept loop, of every account, goes.
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

/// The fetches out now, by exercise, shared by every copy of a `Loops`.
private final class InFlight: Sendable {
  private let tasks = Mutex<[String: Task<URL?, Never>]>([:])

  /// The task out for `id`, else the one `start` makes.
  func task(_ id: String, start: () -> Task<URL?, Never>) -> Task<URL?, Never> {
    tasks.withLock { tasks in
      if let task = tasks[id] { return task }
      let task = start()
      tasks[id] = task
      return task
    }
  }

  func done(_ id: String) { _ = tasks.withLock { $0.removeValue(forKey: id) } }

  func cancelAll() { tasks.withLock { $0.values.forEach { $0.cancel() } } }
}

/// Whether the account the loops belong to is gone, shared by every copy of a `Loops`.
private final class Closed: Sendable {
  private let closed = Mutex(false)

  var isClosed: Bool { closed.withLock { $0 } }

  func close() { closed.withLock { $0 = true } }

  /// Runs `write` unless closed, under the lock `close` takes, so a write never follows a close.
  /// Whether it ran.
  func unlessClosed(_ write: () throws -> Void) throws -> Bool {
    try closed.withLock { (closed: inout Bool) throws -> Bool in
      guard !closed else { return false }
      try write()
      return true
    }
  }
}

/// The exercises whose loop failed in this run, shared by every copy of a `Loops`.
private final class Failed: Sendable {
  private let ids = Mutex<Set<String>>([])
  func contains(_ id: String) -> Bool { ids.withLock { $0.contains(id) } }
  func insert(_ id: String) { _ = ids.withLock { $0.insert(id) } }
}
