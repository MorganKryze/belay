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

  /// The sheet `open` shows on the instance's native start, then its code exchanged for a session
  /// token. The verifier stays here: only its hash goes to the sheet, and the verifier itself only
  /// to the exchange that proves this app asked for the code.
  public static func authorize(
    at instance: Instance, using client: HTTPClient,
    open: @Sendable (URL) async -> Result<URL, SignInFailure>
  ) async -> Result<String, SignInFailure> {
    let verifier = PKCE.verifier()
    switch await open(startURL(instance, challenge: PKCE.challenge(of: verifier))).flatMap(callback) {
    case .success(let code): return await exchange(code: code, verifier: verifier, at: instance, using: client)
    case .failure(let failure): return .failure(failure)
    }
  }

  /// A new session token and the person the instance says it belongs to.
  public struct Renewal: Sendable, Equatable {
    public let token: String
    public let me: Me

    public init(token: String, me: Me) {
      self.token = token
      self.me = me
    }
  }

  /// Signs in again on the instance of an account still open. Nothing kept is touched: until the
  /// whole of it succeeds, the open account and its records stay usable, and a sheet closed or a
  /// network gone changes nothing. A token whose owner the instance did not name is ended, since
  /// nothing on the phone would ever sign it out.
  public static func renew(
    at instance: Instance, using client: HTTPClient,
    open: @Sendable (URL) async -> Result<URL, SignInFailure>
  ) async -> Result<Renewal, SignInFailure> {
    let token: String
    switch await authorize(at: instance, using: client, open: open) {
    case .success(let earned): token = earned
    case .failure(let failure): return .failure(failure)
    }
    switch await me(token: token, at: instance, using: client) {
    case .success(let me): return .success(Renewal(token: token, me: me))
    case .failure(let failure):
      await logout(token: token, at: instance, using: client)
      return .failure(failure)
    }
  }

  /// Puts a renewed token in the place of `old`: `keep` stores it and switches the account to it,
  /// then `old` is ended. A token refused for another account's queue (409) is still valid, and with
  /// the new one kept nothing on the phone could sign it out; ending one already refused is
  /// harmless. When `keep` throws, the new token is the one ended, and `old` stays in use.
  public static func replace(
    _ old: String, with renewal: Renewal, at instance: Instance, using client: HTTPClient,
    keep: @MainActor @Sendable () throws -> Void
  ) async throws {
    do {
      try await keep()
    } catch {
      await logout(token: renewal.token, at: instance, using: client)
      throw error
    }
    await logout(token: old, at: instance, using: client)
  }
}
