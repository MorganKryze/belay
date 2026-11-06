import Foundation

/// Why a sign-in did not end with a session. The four the server names are the ones Accueil shows
/// after a web sign-in; `cancelled` is the person closing the sheet.
public enum SignInFailure: Error, Sendable, Equatable {
  case cancelled, unavailable, expired, failed, denied
}

/// The instance's sign-in for an app: a sheet on its native start, a one-time code in the
/// `belay://` callback, and that code exchanged with the verifier for a session token.
public enum SignInFlow {
  /// The scheme the server sends the sheet back to.
  public static let callbackScheme = "belay"

  /// The exchange gives up after this long, and says the sign-in is unavailable.
  static let exchangeTimeout: TimeInterval = 20

  public static func startURL(_ instance: Instance, challenge: String) -> URL {
    instance.url("auth/native/start").appending(queryItems: [URLQueryItem(name: "challenge", value: challenge)])
  }

  /// The code in the sheet's callback, or the reason the server gave. A reason this version does not
  /// know reads as a plain failure.
  public static func callback(_ url: URL) -> Result<String, SignInFailure> {
    guard url.scheme?.lowercased() == callbackScheme,
      let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
    else { return .failure(.failed) }
    if let reason = items.first(where: { $0.name == "error" })?.value {
      return .failure(reasons[reason] ?? .failed)
    }
    guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
      return .failure(.failed)
    }
    return .success(code)
  }

  private static let reasons: [String: SignInFailure] = [
    "unavailable": .unavailable, "expired": .expired, "failed": .failed, "denied": .denied,
  ]

  /// The session token the instance gives for `code`, proven with `verifier`.
  public static func exchange(
    code: String, verifier: String, at instance: Instance, using client: HTTPClient
  ) async -> Result<String, SignInFailure> {
    var request = URLRequest(url: instance.url("auth/native/token"))
    request.httpMethod = "POST"
    request.timeoutInterval = exchangeTimeout
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONEncoder().encode(["code": code, "verifier": verifier])
    let data: Data
    let response: HTTPURLResponse
    do {
      (data, response) = try await client.send(request)
    } catch {
      return .failure(.unavailable)
    }
    // The server answers 400 to every refused code: used, past its minute, or another verifier.
    if response.statusCode == 400 { return .failure(.expired) }
    struct Answer: Decodable { let token: String }
    guard (200..<300).contains(response.statusCode),
      let answer = try? JSONDecoder().decode(Answer.self, from: data)
    else { return .failure(.failed) }
    return .success(answer.token)
  }
}
