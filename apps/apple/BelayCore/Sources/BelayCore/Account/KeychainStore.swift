import Foundation
import Security
import os

/// A Keychain failure, by its status code alone.
public struct KeychainError: Error, Sendable, Equatable {
  public let status: OSStatus
}

/// The token in the Keychain: one item, the last sign-in's, under the instance's origin. The app
/// before this one kept its token under the same service; it is not read, and the first sign-in
/// deletes it with the rest.
public struct KeychainStore: SecretStore {
  private static let sessionService = "cloud.libresoftware.belay.session"
  private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "keychain")
  private let service: String

  public init() {
    self.init(service: Self.sessionService)
  }

  /// A store under another service, so tests never touch the session item.
  init(service: String) {
    self.service = service
  }

  /// The session item of `origin`, or of every instance when nil, whatever settings it was kept
  /// under.
  static func query(origin: String?, service: String = sessionService) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
    ]
    if let origin { query[kSecAttrAccount as String] = origin }
    return query
  }

  /// `token` as the session item of `origin`. Readable on this device only, once it has been
  /// unlocked after a restart: never copied into a backup or onto another device.
  static func item(origin: String, token: String, service: String = sessionService) -> [String: Any] {
    var item = query(origin: origin, service: service)
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    item[kSecValueData as String] = Data(token.utf8)
    return item
  }

  public func read(origin: String) -> String? {
    var query = Self.query(origin: origin, service: service)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      // Locked before the first unlock, or a damaged item: the person signs in again.
      Self.log.error("keychain read failed: \(status)")
      return nil
    }
    return String(data: data, encoding: .utf8)
  }

  /// Every other item goes first: one token at a time, so a new instance never inherits the old
  /// instance's session. A token deleted here is not ended on its instance; it lapses there with
  /// the session lifetime.
  public func write(origin: String, token: String) throws {
    try clear()
    let status = SecItemAdd(Self.item(origin: origin, token: token, service: service) as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError(status: status) }
  }

  public func clear() throws {
    let status = SecItemDelete(Self.query(origin: nil, service: service) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError(status: status)
    }
  }
}
