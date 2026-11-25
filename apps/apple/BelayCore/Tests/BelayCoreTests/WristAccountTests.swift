import Foundation
import Testing

@testable import BelayCore

/// A store that keeps one token in memory and counts the reads the account makes.
private final class MemoryStore: SecretStore, @unchecked Sendable {
  private let lock = NSLock()
  private var kept: (origin: String, token: String)?
  private var reads = 0

  /// What the store holds, without counting as a read.
  var token: String? { lock.withLock { kept?.token } }
  var readCount: Int { lock.withLock { reads } }

  func read(origin: String) -> String? {
    lock.withLock {
      reads += 1
      return kept?.origin == origin ? kept?.token : nil
    }
  }

  func write(origin: String, token: String) throws {
    lock.withLock { kept = (origin, token) }
  }

  func clear() throws {
    lock.withLock { kept = nil }
  }
}

/// An iPhone that answers from a script, the last answer standing for every later ask, and notes
/// what the watch's store held each time it was asked.
private final class ScriptedPhone: PhoneAsking, @unchecked Sendable {
  private let lock = NSLock()
  private var replies: [HandoverReply?]
  private var held: [String?] = []
  private let store: MemoryStore

  init(store: MemoryStore, _ replies: HandoverReply?...) {
    self.store = store
    self.replies = replies
  }

  var asks: Int { lock.withLock { held.count } }
  /// The watch's token at each ask.
  var tokensHeldWhenAsked: [String?] { lock.withLock { held } }

  func then(_ reply: HandoverReply?) { lock.withLock { replies = [reply] } }

  func askSession() async -> HandoverReply? {
    lock.withLock {
      held.append(store.token)
      let reply = replies.first ?? nil
      if replies.count > 1 { replies.removeFirst() }
      return reply
    }
  }
}

/// An iPhone that holds its answer until told to give it, so a test can act while an ask waits.
private final class HeldPhone: PhoneAsking, @unchecked Sendable {
  private let lock = NSLock()
  private let reply: HandoverReply?
  private var asked = 0
  private var waiting: CheckedContinuation<Void, Never>?
  private var released = false

  init(_ reply: HandoverReply?) { self.reply = reply }

  var asks: Int { lock.withLock { asked } }

  func release() {
    let held = lock.withLock {
      released = true
      defer { waiting = nil }
      return waiting
    }
    held?.resume()
  }

  func askSession() async -> HandoverReply? {
    await withCheckedContinuation { continuation in
      let now = lock.withLock {
        asked += 1
        if released { return true }
        waiting = continuation
        return false
      }
      if now { continuation.resume() }
    }
    return reply
  }
}

/// A server that answers from a closure and remembers what it was asked.
private final class FakeServer: HTTPClient, @unchecked Sendable {
  typealias Answer = @Sendable (URLRequest) throws -> (Int, Data)
  private let answer: Answer
  private let lock = NSLock()
  private var seen: [URLRequest] = []

  init(_ answer: @escaping Answer) { self.answer = answer }

  convenience init(status: Int, json: String = #"{"id":"ana","displayName":"Ana"}"#) {
    self.init { _ in (status, Data(json.utf8)) }
  }

  var requests: [URLRequest] { lock.withLock { seen } }
  var paths: [String] { requests.compactMap { $0.url?.path() } }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    lock.withLock { seen.append(request) }
    let (status, data) = try answer(request)
    let response = HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (data, response)
  }
}

/// A server that holds its answer until told to give it, so a test can act while a check waits.
private final class HeldServer: HTTPClient, @unchecked Sendable {
  private let lock = NSLock()
  private var seen = 0
  private var waiting: [CheckedContinuation<Void, Never>] = []
  private var released = false

  var requestCount: Int { lock.withLock { seen } }

  func release() {
    let held = lock.withLock {
      released = true
      defer { waiting = [] }
      return waiting
    }
    held.forEach { $0.resume() }
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    await withCheckedContinuation { continuation in
      let now = lock.withLock {
        seen += 1
        if released { return true }
        waiting.append(continuation)
        return false
      }
      if now { continuation.resume() }
    }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    return (Data(#"{"id":"ana","displayName":"Ana"}"#.utf8), response)
  }
}

private let origin = "https://belay.example.org"

private func handed(_ id: String = "first", token: String = "t0k3n", origin: String = origin)
  -> HandoverReply
{
  .session(HandedSession(origin: origin, token: token, userId: "ana", name: "Ana", id: id))
}

/// Fresh defaults per test, so no test sees another's marker.
private func freshDefaults() -> UserDefaults {
  let name = "WristAccountTests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: name)!
  defaults.removePersistentDomain(forName: name)
  return defaults
}

private let connected = WristAccount.State.connected(name: "Ana", host: "belay.example.org", reached: true)

@MainActor @Suite struct WristAccountTests {
  private let store = MemoryStore()
  private let defaults = freshDefaults()

  private func account(phone: any PhoneAsking, http: HTTPClient = FakeServer(status: 200)) -> WristAccount {
    WristAccount(secrets: store, defaults: defaults, http: http, phone: phone, allowsLoopback: false)
  }

  @Test func asksThePhoneAtStartWhenNothingIsKept() async {
    let phone = ScriptedPhone(store: store, .signedOut)
    let account = account(phone: phone)
    #expect(account.state == .asking)
    await account.start()
    #expect(phone.asks == 1)
    #expect(account.state == .phoneSignedOut)
  }

  @Test func keepsAHandedSessionAndSaysWhoAndWhere() async throws {
    let server = FakeServer(status: 200)
    let account = account(phone: ScriptedPhone(store: store, handed()), http: server)
    await account.start()
    #expect(store.token == "t0k3n")
    #expect(account.state == connected)
    let check = try #require(server.requests.first)
    #expect(check.url?.absoluteString == "https://belay.example.org/api/me")
    #expect(check.value(forHTTPHeaderField: "Authorization") == "Bearer t0k3n")
  }

  @Test(arguments: [401, 403]) func aRefusedTokenIsDroppedAtOnce(status: Int) async {
    let phone = ScriptedPhone(store: store, handed())
    let account = account(phone: phone, http: FakeServer(status: status))
    await account.start()
    #expect(store.token == nil)
    #expect(account.state == .phoneOut)
    #expect(phone.asks == 1)
  }

  @Test(arguments: [true, false]) func anUnreachableInstanceKeepsTheToken(throwing: Bool) async {
    let server = FakeServer { _ in
      if throwing { throw URLError(.timedOut) }
      return (500, Data())
    }
    let account = account(phone: ScriptedPhone(store: store, handed()), http: server)
    await account.start()
    #expect(store.token == "t0k3n")
    #expect(account.state == .connected(name: "Ana", host: "belay.example.org", reached: false))
  }

  @Test(arguments: ["http://belay.example.org", "https://belay.example.org/seances"])
  func anAddressTheIPhoneWouldRefuseKeepsNothing(address: String) async {
    let server = FakeServer(status: 200)
    let account = account(phone: ScriptedPhone(store: store, handed(origin: address)), http: server)
    await account.start()
    #expect(store.token == nil)
    #expect(defaults.dictionaryRepresentation().keys.filter { $0.hasPrefix("belay.") && $0 != "belay.signedOut" }.isEmpty)
    #expect(server.requests.isEmpty)
    #expect(account.state == .phoneOut)
  }

  @Test func aNewSessionIdDropsTheTokenBeforeAskingAgain() async throws {
    let phone = ScriptedPhone(store: store, handed("first"))
    let account = account(phone: phone)
    await account.start()
    phone.then(handed("second", token: "renewed"))
    await account.received(try #require(HandoverState(["v": "1", "session": "second"])))
    #expect(phone.tokensHeldWhenAsked == [nil, nil])
    #expect(store.token == "renewed")
    #expect(account.state == connected)
  }

  @Test func aSignedOutPhoneDropsTheTokenAndSaysSo() async throws {
    let phone = ScriptedPhone(store: store, handed())
    let account = account(phone: phone)
    await account.start()
    await account.received(try #require(HandoverState(["v": "1"])))
    #expect(store.token == nil)
    #expect(account.state == .phoneSignedOut)
    #expect(phone.asks == 1)
  }

  @Test func theSameIdKeepsEverything() async throws {
    let phone = ScriptedPhone(store: store, handed("first"))
    let server = FakeServer(status: 200)
    let account = account(phone: phone, http: server)
    await account.start()
    await account.received(try #require(HandoverState(["v": "1", "session": "first"])))
    #expect(store.token == "t0k3n")
    #expect(account.state == connected)
    #expect(phone.asks == 1)
    #expect(server.requests.count == 1)
  }

  @Test func signingOutHereNeverEndsTheSessionAndHoldsAcrossALaunch() async throws {
    let phone = ScriptedPhone(store: store, handed("first"))
    let server = FakeServer(status: 200)
    let account = account(phone: phone, http: server)
    await account.start()
    account.signOutHere()
    // Let any request the sign-out might have started in the background reach the server.
    for _ in 0..<20 { await Task.yield() }
    #expect(account.state == .signedOutHere)
    #expect(store.token == nil)
    #expect(!server.paths.contains { $0.hasSuffix("auth/logout") })

    let relaunched = self.account(phone: phone, http: server)
    #expect(relaunched.state == .signedOutHere)
    await relaunched.start()
    await relaunched.received(try #require(HandoverState(["v": "1", "session": "second"])))
    await relaunched.retry()
    #expect(relaunched.state == .signedOutHere)
    #expect(phone.asks == 1)
    #expect(server.requests.count == 1)
  }

  @Test func anAnswerTheIPhoneGivesAfterASignOutHereIsNotKept() async {
    let phone = HeldPhone(handed())
    let server = FakeServer(status: 200)
    let account = account(phone: phone, http: server)
    let first = Task { await account.start() }
    while phone.asks == 0 { await Task.yield() }
    account.signOutHere()
    phone.release()
    await first.value
    #expect(store.token == nil)
    #expect(account.state == .signedOutHere)
    #expect(server.requests.isEmpty)
  }

  @Test func anInstanceAnswerAfterASignOutHereWritesNothingBack() async {
    let held = HeldServer()
    let account = account(phone: ScriptedPhone(store: store, handed()), http: held)
    let first = Task { await account.start() }
    while held.requestCount == 0 { await Task.yield() }
    account.signOutHere()
    held.release()
    await first.value
    #expect(account.state == .signedOutHere)
    #expect(store.token == nil)
    #expect(defaults.string(forKey: StoredSession.userKey) == nil)
    #expect(defaults.string(forKey: StoredSession.nameKey) == nil)
  }

  @Test func connectingAgainAsksThePhone() async {
    let phone = ScriptedPhone(store: store, handed())
    let account = account(phone: phone)
    await account.start()
    account.signOutHere()
    await account.connectAgain()
    #expect(phone.asks == 2)
    #expect(store.token == "t0k3n")
    #expect(account.state == connected)
    let relaunched = self.account(phone: phone)
    await relaunched.start()
    #expect(relaunched.state == connected)
    #expect(phone.asks == 2)
  }

  @Test func connectingAgainWhileAStartWaitsAsksThePhoneAndShowsItsAnswer() async {
    let held = HeldServer()
    let phone = ScriptedPhone(store: store, handed(), .signedOut)
    let account = account(phone: phone, http: held)
    let first = Task { await account.start() }
    while held.requestCount == 0 { await Task.yield() }
    account.signOutHere()
    await account.connectAgain()
    #expect(phone.asks == 2)
    #expect(account.state == .phoneSignedOut)
    held.release()
    await first.value
    #expect(account.state == .phoneSignedOut)
    #expect(store.token == nil)
  }

  @Test func aFreshInstallNeverReadsATokenAnEarlierInstallLeft() async throws {
    try store.write(origin: origin, token: "left")
    let phone = ScriptedPhone(store: store, nil)
    let server = FakeServer(status: 200)
    let account = account(phone: phone, http: server)
    await account.start()
    #expect(store.readCount == 0)
    #expect(server.requests.isEmpty)
    #expect(phone.asks == 1)
    #expect(account.state == .phoneOut)
  }

  @Test func thePhoneOutOfReachSaysSo() async {
    let phone = ScriptedPhone(store: store, nil)
    let account = account(phone: phone)
    await account.start()
    #expect(account.state == .phoneOut)
    phone.then(handed())
    await account.retry()
    #expect(account.state == connected)
  }

  @Test func checksTheInstanceOncePerReturn() async {
    let server = FakeServer(status: 200)
    let account = account(phone: ScriptedPhone(store: store, handed()), http: server)
    await account.start()
    #expect(server.requests.count == 1)
    await account.start()
    #expect(server.requests.count == 2)

    // A second trigger while the check waits for its answer adds none.
    let held = HeldServer()
    let relaunched = self.account(phone: ScriptedPhone(store: store, nil), http: held)
    let first = Task { await relaunched.start() }
    while held.requestCount == 0 { await Task.yield() }
    #expect(relaunched.state == .connected(name: "Ana", host: "belay.example.org", reached: nil))
    await relaunched.start()
    held.release()
    await first.value
    #expect(held.requestCount == 1)
    #expect(relaunched.state == connected)
  }
}
