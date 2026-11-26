import Foundation

/// The session token across launches, the id of the person it belongs to and what their instance
/// serves. A sign-out marks the defaults before it asks the store to drop the token, so a token
/// the store failed to drop is never restored; the next sign-in lifts the mark.
public struct StoredSession {
  static let signedOutKey = "belay.signedOut"
  /// Kept beside the instance so a launch without network opens signed in.
  static let userKey = "belay.user"
  /// The name Accueil greets, kept with the id: a launch opens before the instance is asked.
  static let nameKey = "belay.userName"
  /// Whether the instance serves exercise loops, under the web's own preference name.
  static let mediaKey = "belay.media"
  /// A random id for the kept token, which the iPhone publishes to its watch in place of the token:
  /// a new id tells the watch the session changed. Every new token and every sign-out removes it.
  static let handoverKey = "belay.handoverId"
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

  /// Whether that person's instance serves exercise loops, as it last said.
  public var media: Bool { defaults.bool(forKey: Self.mediaKey) }

  /// The id of the token kept for `origin`, or nil when none is kept. A token kept before ids
  /// existed gets one here, the first time it is asked for.
  public func handoverId(origin: String) -> String? {
    guard token(origin: origin) != nil else { return nil }
    if let id = defaults.string(forKey: Self.handoverKey) { return id }
    let id = UUID().uuidString
    defaults.set(id, forKey: Self.handoverKey)
    return id
  }

  /// Keeps `token` for `origin`; the mark goes only once the token is in the store.
  public func keep(origin: String, token: String) throws {
    // The defaults can outlive the Keychain (a device restore brings back one, not the other), so an
    // id may still be here from someone else: it goes first, and only `remember` sets one again.
    defaults.removeObject(forKey: Self.userKey)
    defaults.removeObject(forKey: Self.nameKey)
    defaults.removeObject(forKey: Self.mediaKey)
    defaults.removeObject(forKey: Self.handoverKey)
    try store.write(origin: origin, token: token)
    defaults.removeObject(forKey: Self.signedOutKey)
  }

  /// The id the instance named as the kept token's owner, the name it gave and whether it serves
  /// loops.
  public func remember(userId: String, displayName: String, media: Bool) {
    defaults.set(userId, forKey: Self.userKey)
    defaults.set(displayName, forKey: Self.nameKey)
    defaults.set(media, forKey: Self.mediaKey)
  }

  /// Signed out for good, even when the store throws: the mark is written first.
  public func drop() throws {
    defaults.removeObject(forKey: Self.userKey)
    defaults.removeObject(forKey: Self.nameKey)
    defaults.removeObject(forKey: Self.mediaKey)
    defaults.removeObject(forKey: Self.handoverKey)
    defaults.set(true, forKey: Self.signedOutKey)
    try store.clear()
  }
}
