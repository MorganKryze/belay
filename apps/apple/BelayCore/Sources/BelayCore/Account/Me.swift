import Foundation

/// Who a session belongs to, as the instance names them.
public struct Me: Sendable, Equatable, Decodable {
  public let id: String
  public let displayName: String

  public init(id: String, displayName: String) {
    self.id = id
    self.displayName = displayName
  }
}

/// A server call made with the session: the token as a bearer, no cookie.
func request(_ path: String, token: String, at instance: Instance) -> URLRequest {
  var request = URLRequest(url: instance.url(path))
  request.timeoutInterval = 20
  request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
  return request
}

/// The person `token` signs in, read from the instance. Only a 401 or a 403 says the token is
/// refused (`failed`); any other answer, a server error or a captive portal's page, says the
/// instance was not reached (`unavailable`), so the token is kept for the next try.
public func me(token: String, at instance: Instance, using client: HTTPClient) async -> Result<Me, SignInFailure> {
  let data: Data
  let response: HTTPURLResponse
  do {
    (data, response) = try await client.send(request("api/me", token: token, at: instance))
  } catch {
    return .failure(.unavailable)
  }
  if response.statusCode == 401 || response.statusCode == 403 { return .failure(.failed) }
  guard response.statusCode == 200, let me = try? JSONDecoder().decode(Me.self, from: data) else {
    return .failure(.unavailable)
  }
  return .success(me)
}

/// Ends the session on the instance. The phone drops its token whatever the answer, so a failure
/// leaves nothing to do: the server's row lapses with the session lifetime.
public func logout(token: String, at instance: Instance, using client: HTTPClient) async {
  var request = request("auth/logout", token: token, at: instance)
  request.httpMethod = "POST"
  request.timeoutInterval = 10
  // JSON, as the web app sends it: the server's cross-site guard refuses form posts from elsewhere.
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  request.httpBody = Data("{}".utf8)
  _ = try? await client.send(request)
}
