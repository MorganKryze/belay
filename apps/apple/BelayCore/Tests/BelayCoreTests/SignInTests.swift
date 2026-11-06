import Foundation
import Testing

@testable import BelayCore

/// A server that answers from a closure and remembers what it was asked.
private final class FakeServer: HTTPClient, @unchecked Sendable {
  typealias Answer = @Sendable (URLRequest) throws -> (Int, Data)
  private let answer: Answer
  private let lock = NSLock()
  private var seen: [URLRequest] = []

  init(_ answer: @escaping Answer) { self.answer = answer }

  convenience init(status: Int, json: String) {
    self.init { _ in (status, Data(json.utf8)) }
  }

  convenience init(throwing error: Error) {
    self.init { _ in throw error }
  }

  var requests: [URLRequest] { lock.withLock { seen } }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { seen.append(request) }
    let (status, data) = try answer(request)
    let response = HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (data, response)
  }
}

private let belay = #"{"app":"belay","api":1,"origin":"https://belay.example.org"}"#
/// Address check, PKCE, the sheet's callback, the code exchange and the session calls.
@Suite enum SignInTests {}

private let instance = Instance(uncheckedOrigin: URL(string: "https://belay.example.org")!)

extension SignInTests {
  @Suite struct AddressCheck {
    @Test func acceptsABelayAnswerOverHTTPSAndAsksAtTheRoot() async throws {
      let server = FakeServer(status: 200, json: belay)
      let result = await Instance.check("  belay.example.org/seances  ", using: server)
      #expect(result == .success(instance))
      let request = try #require(server.requests.first)
      #expect(request.url?.absoluteString == "https://belay.example.org/api/instance")
      #expect(request.timeoutInterval == 10)
    }

    @Test func takesTheOriginTheInstanceSaysItIsServedAt() async {
      let server = FakeServer(status: 200, json: belay)
      let result = await Instance.check("https://www.example.org", using: server)
      #expect(result == .success(instance))
    }

    @Test func refusesPlainHTTPToAnotherMachine() async {
      let server = FakeServer(status: 200, json: belay)
      let result = await Instance.check("http://belay.example.org", using: server, allowsLoopback: true)
      #expect(result == .failure(.insecure))
      #expect(server.requests.isEmpty)
    }

    @Test func refusesPlainHTTPToThisMachineOutsideADebugBuild() async {
      let server = FakeServer(status: 200, json: #"{"app":"belay","api":1,"origin":"http://localhost:3000"}"#)
      let refused = await Instance.check("http://localhost:3000", using: server, allowsLoopback: false)
      #expect(refused == .failure(.insecure))
      let accepted = await Instance.check("http://localhost:3000", using: server, allowsLoopback: true)
      #expect(accepted.map(\.origin.absoluteString) == .success("http://localhost:3000"))
    }

    @Test(arguments: ["", "   ", "ftp://belay.example.org", "https://ana:secret@belay.example.org"])
    func refusesWhatIsNotAnAddress(_ address: String) async {
      let server = FakeServer(status: 200, json: belay)
      #expect(await Instance.check(address, using: server) == .failure(.invalid))
    }

    @Test(arguments: [
      (200, #"{"app":"other","api":1,"origin":"https://belay.example.org"}"#),
      (200, #"{"app":"belay","api":0,"origin":"https://belay.example.org"}"#),
      (200, #"{"app":"belay","api":1}"#),
      (200, #"{"app":"belay","api":1,"origin":"http://belay.example.org"}"#),
      (200, #"{"app":"belay","api":1,"origin":"https://belay.example.org/app"}"#),
      (200, "<html></html>"),
      (404, belay),
    ])
    func refusesAnAnswerThatIsNotBelay(_ status: Int, _ body: String) async {
      let server = FakeServer(status: status, json: body)
      #expect(await Instance.check("belay.example.org", using: server) == .failure(.notBelay))
    }

    @Test func saysATimeoutIsUnreachable() async {
      let server = FakeServer(throwing: URLError(.timedOut))
      #expect(await Instance.check("belay.example.org", using: server) == .failure(.unreachable))
    }

    @Test func saysNoNetworkIsOffline() async {
      let server = FakeServer(throwing: URLError(.notConnectedToInternet))
      #expect(await Instance.check("belay.example.org", using: server) == .failure(.offline))
    }

    @Test func readsAStoredOriginOnlyWhenItIsOne() {
      #expect(Instance(storedOrigin: "https://belay.example.org") == instance)
      #expect(Instance(storedOrigin: "https://belay.example.org/app") == nil)
      #expect(Instance(storedOrigin: "http://belay.example.org", allowsLoopback: true) == nil)
      #expect(Instance(storedOrigin: "garbage") == nil)
    }
  }
}

extension SignInTests {
  @Suite struct Verifier {
    // RFC 7636, appendix B. The web's challengeOf computes the same S256: SHA-256, then base64url
    // without padding.
    @Test func computesTheRFCChallenge() {
      #expect(
        PKCE.challenge(of: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
          == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func makesAFreshURLSafeVerifierOf32Bytes() {
      let one = PKCE.verifier()
      let two = PKCE.verifier()
      #expect(one.count == 43)
      #expect(one != two)
      #expect(one.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber || $0 == "-" || $0 == "_") })
    }
  }
}

extension SignInTests {
  @Suite struct Flow {
    @Test func opensTheInstancesNativeStartWithTheChallenge() {
      let url = SignInFlow.startURL(instance, challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
      #expect(
        url.absoluteString
          == "https://belay.example.org/auth/native/start?challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func readsTheCodeFromTheCallback() {
      #expect(SignInFlow.callback(URL(string: "belay://auth?code=abc123")!) == .success("abc123"))
    }

    @Test func refusesACallbackOnAnotherScheme() {
      #expect(SignInFlow.callback(URL(string: "https://auth?code=abc123")!) == .failure(.failed))
    }

    @Test(arguments: [
      ("unavailable", SignInFailure.unavailable), ("expired", .expired), ("failed", .failed),
      ("denied", .denied), ("cancelled", .failed), ("something_new", .failed),
    ])
    func readsEachReason(_ reason: String, _ failure: SignInFailure) {
      #expect(SignInFlow.callback(URL(string: "belay://auth?error=\(reason)")!) == .failure(failure))
    }

    @Test func refusesACallbackWithoutACode() {
      #expect(SignInFlow.callback(URL(string: "belay://auth")!) == .failure(.failed))
    }

    @Test func exchangesTheCodeAndVerifierForAToken() async throws {
      let server = FakeServer(status: 200, json: #"{"token":"t0k3n"}"#)
      let result = await SignInFlow.exchange(code: "c", verifier: "v", at: instance, using: server)
      #expect(result == .success("t0k3n"))
      let request = try #require(server.requests.first)
      #expect(request.url?.absoluteString == "https://belay.example.org/auth/native/token")
      #expect(request.httpMethod == "POST")
      #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
      let body = try JSONSerialization.jsonObject(with: try #require(request.httpBody)) as? [String: String]
      #expect(body == ["code": "c", "verifier": "v"])
    }

    @Test(arguments: [
      (400, #"{"error":"invalid_grant"}"#, SignInFailure.expired),
      (500, #"{"error":"server_error"}"#, .failed),
      (200, #"{}"#, .failed),
      (200, #"{"token":42}"#, .failed),
      (200, "not json", .failed),
    ])
    func mapsARefusedExchange(_ status: Int, _ body: String, _ failure: SignInFailure) async {
      let server = FakeServer(status: status, json: body)
      let result = await SignInFlow.exchange(code: "c", verifier: "v", at: instance, using: server)
      #expect(result == .failure(failure))
    }

    @Test func saysANetworkErrorIsUnavailable() async {
      let server = FakeServer(throwing: URLError(.networkConnectionLost))
      let result = await SignInFlow.exchange(code: "c", verifier: "v", at: instance, using: server)
      #expect(result == .failure(.unavailable))
    }
  }
}

extension SignInTests {
  @Suite struct Session {
    @Test func readsWhoTheTokenBelongsTo() async throws {
      let server = FakeServer(status: 200, json: #"{"id":"u1","displayName":"Ana","media":false}"#)
      let result = await me(token: "t0k3n", at: instance, using: server)
      #expect(result == .success(Me(id: "u1", displayName: "Ana")))
      let request = try #require(server.requests.first)
      #expect(request.url?.absoluteString == "https://belay.example.org/api/me")
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer t0k3n")
    }

    @Test(arguments: [401, 403])
    func saysTheTokenIsRefusedOnlyWhenTheInstanceSaysSo(_ status: Int) async {
      let refused = FakeServer(status: status, json: #"{"error":"unauthenticated"}"#)
      #expect(await me(token: "t", at: instance, using: refused) == .failure(.failed))
    }

    @Test(arguments: [500, 502, 503])
    func keepsTheTokenWhenTheInstanceFails(_ status: Int) async {
      let failing = FakeServer(status: status, json: #"{"error":"server_error"}"#)
      #expect(await me(token: "t", at: instance, using: failing) == .failure(.unavailable))
    }

    @Test func keepsTheTokenWhenTheInstanceDoesNotAnswerInTime() async {
      let slow = FakeServer(throwing: URLError(.timedOut))
      #expect(await me(token: "t", at: instance, using: slow) == .failure(.unavailable))
    }

    @Test func keepsTheTokenWithoutANetwork() async {
      let offline = FakeServer(throwing: URLError(.notConnectedToInternet))
      #expect(await me(token: "t", at: instance, using: offline) == .failure(.unavailable))
    }

    // A captive portal answers 200 with its own page: the instance was never reached.
    @Test func keepsTheTokenWhenSomethingElseAnswers() async {
      let portal = FakeServer(status: 200, json: "<html><body>Wi-Fi login</body></html>")
      #expect(await me(token: "t", at: instance, using: portal) == .failure(.unavailable))
    }

    @Test func endsTheSessionWithTheBearer() async throws {
      let server = FakeServer(status: 200, json: #"{"redirectTo":"https://belay.example.org/"}"#)
      await logout(token: "t0k3n", at: instance, using: server)
      let request = try #require(server.requests.first)
      #expect(request.url?.absoluteString == "https://belay.example.org/auth/logout")
      #expect(request.httpMethod == "POST")
      #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer t0k3n")
      // JSON, as the web sends it: the server's cross-site guard stops form posts only.
      #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    }

    @Test func logoutIgnoresAFailure() async {
      await logout(token: "t", at: instance, using: FakeServer(throwing: URLError(.timedOut)))
      await logout(token: "t", at: instance, using: FakeServer(status: 500, json: "{}"))
    }
  }
}
