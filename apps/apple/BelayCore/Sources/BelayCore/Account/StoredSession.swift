import Foundation

/// The session token across launches. A sign-out marks the defaults before it asks the store to
/// drop the token, so a token the store failed to drop is never restored; the next sign-in lifts
/// the mark.
public struct StoredSession {
  static let signedOutKey = "belay.signedOut"
  private let store: SecretStore
  private let defaults: UserDefaults

  public init(store: SecretStore, defaults: UserDefaults) {
    self.store = store
    self.defaults = defaults
  }

  /// The token kept for `origin`, unless the person signed out since it was kept.
  public func token(origin: String) -> String? {
    defaults.bool(forKey: Self.signedOutKey) ? nil : store.read(origin: origin)
  }

  /// Keeps `token` for `origin`; the mark goes only once the token is in the store.
  public func keep(origin: String, token: String) throws {
    try store.write(origin: origin, token: token)
    defaults.removeObject(forKey: Self.signedOutKey)
  }

  /// Signed out for good, even when the store throws: the mark is written first.
  public func drop() throws {
    defaults.set(true, forKey: Self.signedOutKey)
    try store.clear()
  }
}
