import Foundation
import Security
import Testing

@testable import BelayCore

/// The Keychain item is the one the previous app wrote, so a token it kept stays usable, and it
/// never leaves this device.
@Suite struct KeychainQueryTests {
  @Test func namesTheSessionItemOfAnInstance() {
    let query = KeychainStore.query(origin: "https://belay.example.org")
    #expect(query[kSecClass as String] as? String == kSecClassGenericPassword as String)
    #expect(query[kSecAttrService as String] as? String == "cloud.libresoftware.belay.session")
    #expect(query[kSecAttrAccount as String] as? String == "https://belay.example.org")
  }

  @Test func keepsTheTokenOnThisDeviceAfterTheFirstUnlock() {
    let query = KeychainStore.query(origin: "https://belay.example.org")
    #expect(
      query[kSecAttrAccessible as String] as? String
        == kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly as String)
  }

  @Test func coversEveryInstanceWithoutAnOrigin() {
    let query = KeychainStore.query(origin: nil)
    #expect(query[kSecAttrService as String] as? String == "cloud.libresoftware.belay.session")
    #expect(query[kSecAttrAccount as String] == nil)
  }

  /// Runs against the Mac's Keychain under a service of its own, removed after.
  @Test func keepsOnlyTheLastInstancesToken() throws {
    let store = KeychainStore(service: "cloud.libresoftware.belay.tests.\(UUID().uuidString)")
    defer { try? store.clear() }
    try store.write(origin: "https://one.example.org", token: "first")
    try store.write(origin: "https://two.example.org", token: "second")
    #expect(store.read(origin: "https://one.example.org") == nil)
    #expect(store.read(origin: "https://two.example.org") == "second")
  }
}
