/// Where the session token is kept, one instance at a time.
public protocol SecretStore: Sendable {
  /// The token kept for `origin`, or nil when there is none.
  func read(origin: String) -> String?
  /// Keeps `token` for `origin`, and drops any token kept for another instance.
  func write(origin: String, token: String) throws
  /// Drops every token.
  func clear() throws
}
