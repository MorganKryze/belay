public import Foundation
public import GRDB

/// One account's records on this phone: its sessions, sets and programs, the queue of changes
/// waiting for the server, and the session open here. One SQLite file per account and instance,
/// so nothing in it is ever sent under another identity, nor to another server that kept the
/// same account ids. Closed when the last reference goes.
public final class AccountStore: Sendable {
  let writer: any DatabaseWriter

  private init(writer: any DatabaseWriter) throws {
    self.writer = writer
    try Schema.migrator.migrate(writer)
  }

  /// Readable once the phone was unlocked after a restart: a sync in the background, or a
  /// Live Activity's tick, may write while the phone is locked.
  static let protection = FileProtectionType.completeUntilFirstUserAuthentication

  /// The file of `userId` on `origin` inside `folder`. Both are percent-encoded, so no id or
  /// address can reach outside the folder or name another account's file.
  static func fileURL(userId: String, origin: URL, in folder: URL) -> URL {
    let safe = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._"))
    let encode = { (text: String) in text.addingPercentEncoding(withAllowedCharacters: safe) ?? "" }
    return folder.appendingPathComponent(
      "belay.\(encode(userId))@\(encode(origin.absoluteString)).sqlite")
  }

  /// Opens, or creates, the store of `userId` on `origin` in `folder`, which must be the app's
  /// own: a shared container would let another app or extension read it.
  public static func open(userId: String, origin: URL, in folder: URL) throws -> AccountStore {
    // The folder's class is the one SQLite's side files (-wal, -shm) are created with.
    try FileManager.default.createDirectory(
      at: folder, withIntermediateDirectories: true, attributes: [.protectionKey: protection])
    try FileManager.default.setAttributes([.protectionKey: protection], ofItemAtPath: folder.path)
    let url = fileURL(userId: userId, origin: origin, in: folder)
    let store = try AccountStore(writer: DatabasePool(path: url.path))
    try FileManager.default.setAttributes([.protectionKey: protection], ofItemAtPath: url.path)
    return store
  }

  /// A store that lives as long as the value, for tests and previews; `userId` names no file.
  public static func inMemory(userId: String) throws -> AccountStore {
    try AccountStore(writer: DatabaseQueue())
  }

  /// `fetch`'s value now, then again after each write that changed what it read.
  public func observe<T: Sendable>(_ fetch: @escaping @Sendable (Database) throws -> T)
    -> AsyncThrowingStream<T, Error>
  {
    let values = ValueObservation.tracking(fetch).values(in: writer)
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          for try await value in values { continuation.yield(value) }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}
