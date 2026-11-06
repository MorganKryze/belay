import Foundation
import Testing

@testable import BelayCore

/// A store that keeps one token in memory and, when asked, fails to drop it, as a locked or
/// damaged Keychain can.
private final class MemoryStore: SecretStore, @unchecked Sendable {
  private let lock = NSLock()
  private var kept: (origin: String, token: String)?
  private let clearFails: Bool

  init(clearFails: Bool = false) { self.clearFails = clearFails }

  func read(origin: String) -> String? {
    lock.withLock { kept?.origin == origin ? kept?.token : nil }
  }

  func write(origin: String, token: String) throws {
    lock.withLock { kept = (origin, token) }
  }

  func clear() throws {
    if clearFails { throw KeychainError(status: -25308) }
    lock.withLock { kept = nil }
  }
}

private let origin = "https://belay.example.org"

/// Fresh defaults per test, so no test sees another's marker.
private func freshDefaults() -> UserDefaults {
  let name = "StoredSessionTests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: name)!
  defaults.removePersistentDomain(forName: name)
  return defaults
}

@Suite struct StoredSessionTests {
  @Test func restoresTheTokenItKept() throws {
    let session = StoredSession(store: MemoryStore(), defaults: freshDefaults())
    try session.keep(origin: origin, token: "t0k3n")
    #expect(session.token(origin: origin) == "t0k3n")
  }

  @Test func staysSignedOutWhenTheStoreCannotDropTheToken() throws {
    let store = MemoryStore(clearFails: true)
    let defaults = freshDefaults()
    try StoredSession(store: store, defaults: defaults).keep(origin: origin, token: "t0k3n")
    #expect(throws: KeychainError.self) { try StoredSession(store: store, defaults: defaults).drop() }
    #expect(store.read(origin: origin) == "t0k3n")
    // The next launch builds its own.
    #expect(StoredSession(store: store, defaults: defaults).token(origin: origin) == nil)
  }

  @Test func restoresAgainAfterTheNextSignIn() throws {
    let store = MemoryStore(clearFails: true)
    let session = StoredSession(store: store, defaults: freshDefaults())
    try session.keep(origin: origin, token: "old")
    try? session.drop()
    try session.keep(origin: origin, token: "new")
    #expect(session.token(origin: origin) == "new")
  }

  @Test func marksTheSignOutEvenWhenTheStoreDropsTheToken() throws {
    let defaults = freshDefaults()
    let session = StoredSession(store: MemoryStore(), defaults: defaults)
    try session.keep(origin: origin, token: "t0k3n")
    try session.drop()
    #expect(defaults.bool(forKey: StoredSession.signedOutKey))
    #expect(session.token(origin: origin) == nil)
  }
}
