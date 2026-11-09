import Foundation

/// The session token across launches, and the id of the person it belongs to. A sign-out marks
/// the defaults before it asks the store to drop the token, so a token the store failed to drop is
/// never restored; the next sign-in lifts the mark.
public struct StoredSession {
  static let signedOutKey = "belay.signedOut"
  /// Kept beside the instance so a launch without network opens signed in.
  static let userKey = "belay.user"
  /// The name Accueil greets, kept with the id: a launch opens before the instance is asked.
  static let nameKey = "belay.userName"
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

  /// Who the kept token belongs to, once the instance has said so.
  public var userId: String? { defaults.string(forKey: Self.userKey) }

  /// How the instance names that person.
  public var displayName: String? { defaults.string(forKey: Self.nameKey) }

  /// Keeps `token` for `origin`; the mark goes only once the token is in the store.
  public func keep(origin: String, token: String) throws {
    // The defaults can outlive the Keychain (a device restore brings back one, not the other), so an
    // id may still be here from someone else: it goes first, and only `remember` sets one again.
    defaults.removeObject(forKey: Self.userKey)
    defaults.removeObject(forKey: Self.nameKey)
    try store.write(origin: origin, token: token)
    defaults.removeObject(forKey: Self.signedOutKey)
  }

  /// The id the instance named as the kept token's owner, and the name it gave.
  public func remember(userId: String, displayName: String) {
    defaults.set(userId, forKey: Self.userKey)
    defaults.set(displayName, forKey: Self.nameKey)
  }

  /// Signed out for good, even when the store throws: the mark is written first.
  public func drop() throws {
    defaults.removeObject(forKey: Self.userKey)
    defaults.removeObject(forKey: Self.nameKey)
    defaults.set(true, forKey: Self.signedOutKey)
    try store.clear()
  }
}
