import Foundation
import Security
import os

/// A Keychain failure, by its status code alone.
public struct KeychainError: Error, Sendable, Equatable {
  public let status: OSStatus
}

/// The token in the Keychain, under the same service and account as the previous app wrote it, so a
/// session it earned stays usable.
public struct KeychainStore: SecretStore {
  private static let service = "cloud.libresoftware.belay.session"
  private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "keychain")

  public init() {}

  /// The session item of `origin`, or of every instance when nil. Readable on this device only,
  /// once it has been unlocked after a restart: never copied into a backup or onto another device.
  static func query(origin: String?) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    if let origin { query[kSecAttrAccount as String] = origin }
    return query
  }

  public func read(origin: String) -> String? {
    var query = Self.query(origin: origin)
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
  /// instance's session.
  public func write(origin: String, token: String) throws {
    try clear()
    var query = Self.query(origin: origin)
    query[kSecValueData as String] = Data(token.utf8)
    let status = SecItemAdd(query as CFDictionary, nil)
    guard status == errSecSuccess else { throw KeychainError(status: status) }
  }

  public func clear() throws {
    let status = SecItemDelete(Self.query(origin: nil) as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw KeychainError(status: status)
    }
  }
}
