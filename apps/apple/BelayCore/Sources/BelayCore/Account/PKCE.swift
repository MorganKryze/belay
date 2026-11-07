import CryptoKit
import Foundation

/// The proof that the app which exchanges a sign-in code is the one that asked for it (RFC 7636,
/// S256): the sheet gets only the challenge, the exchange the verifier.
public enum PKCE {
  /// 32 random bytes, base64url: 43 characters, as the web app makes them.
  public static func verifier() -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0..<32).map { _ in UInt8.random(in: .min ... .max, using: &generator) }
    return base64url(Data(bytes))
  }

  /// The S256 challenge of `verifier`: the same the web's `challengeOf` computes, which the server
  /// compares against.
  public static func challenge(of verifier: String) -> String {
    base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
  }

  static func base64url(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
