import Foundation
import Synchronization
import Testing

@testable import BelayCore

// An exercise's loop: asked of the person's instance only, with the session's token, never while
// the instance serves no media; kept for offline, capped, and gone at sign-out.

/// Answers every request with one status, type and body, and keeps what it was sent. The first
/// `failing` answers throw their error, as a phone off the network does; `held`, no answer comes
/// until `release()`, or for 5 s at most so a test never hangs.
private final class LoopServer: HTTPClient, Sendable {
  let sent = Mutex<[URLRequest]>([])
  /// The requests whose wait was cancelled before an answer came.
  let cancelled = Mutex(0)
  private let failing: Mutex<[URLError.Code]>
  private let held: Mutex<Bool>
  private let status: Int
  private let offline: Bool
  private let type: String
  private let body: Data

  init(
    status: Int = 200, offline: Bool = false, failing: [URLError.Code] = [], held: Bool = false,
    type: String = "video/mp4", body: Data = Data("loop".utf8)
  ) {
    self.status = status
    self.offline = offline
    self.failing = Mutex(failing)
    self.held = Mutex(held)
    self.type = type
    self.body = body
  }

  var requests: [URLRequest] { sent.withLock { $0 } }

  func release() { held.withLock { $0 = false } }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    sent.withLock { $0.append(request) }
    do {
      // Long enough for a second fetch to start while this one is out.
      try await Task.sleep(for: .milliseconds(50))
      for _ in 0..<1_000 where held.withLock({ $0 }) { try await Task.sleep(for: .milliseconds(5)) }
    } catch {
      cancelled.withLock { $0 += 1 }
      throw error
    }
    if offline { throw URLError(.notConnectedToInternet) }
    if let code = failing.withLock({ $0.isEmpty ? nil : $0.removeFirst() }) { throw URLError(code) }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": type])!
    return (body, response)
  }
}

private let instance = Instance(storedOrigin: "https://belay.example.org")!
private let token = "tok-loop-secret"

/// A fresh caches folder for one test.
private func scratch() -> URL {
  FileManager.default.temporaryDirectory.appending(path: "loops-\(UUID().uuidString)", directoryHint: .isDirectory)
}

@Suite struct LoopsTests {
  @Test func pathOnlyForTheDatasetsExercises() {
    #expect(loopPath("ds:0042") == "media/exercises/0042")
    #expect(loopPath("belay:dead-hang") == nil)
    #expect(loopPath("ds:42") == nil)
    #expect(loopPath("ds:00420") == nil)
  }

  @Test func requestPathAndBearer() async throws {
    let server = LoopServer()
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    let url = try #require(await loops.fetch("ds:0042", token: token, at: instance, media: true))
    let request = try #require(server.requests.first)
    #expect(request.url?.absoluteString == "https://belay.example.org/media/exercises/0042")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
    #expect(request.httpMethod == "GET")
    #expect(try Data(contentsOf: url) == Data("loop".utf8))
  }

  @Test func neverSentWhenMediaOff() async {
    let server = LoopServer()
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: false) == nil)
    #expect(server.requests.isEmpty)
  }

  @Test func onlyToTheInstance() async {
    let server = LoopServer()
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    // An id from the person's own exercises, or one shaped to reach elsewhere, asks for nothing.
    for id in ["belay:dead-hang", "ds:../../x", "https://cdn.example.com/0042.mp4"] {
      #expect(await loops.fetch(id, token: token, at: instance, media: true) == nil)
    }
    #expect(server.requests.isEmpty)
    _ = await loops.fetch("ds:0001", token: token, at: instance, media: true)
    #expect(server.requests.map { $0.url?.host() } == ["belay.example.org"])
  }

  @Test func keptPlaysOffline() async throws {
    let folder = scratch()
    let online = Loops(folder: folder, userId: "ana", origin: instance.origin, client: LoopServer())
    let fetched = try #require(await online.fetch("ds:0042", token: token, at: instance, media: true))

    let server = LoopServer(offline: true)
    let offline = Loops(folder: folder, userId: "ana", origin: instance.origin, client: server)
    #expect(offline.kept("ds:0042") == fetched)
    #expect(await offline.fetch("ds:0042", token: token, at: instance, media: true) == fetched)
    #expect(server.requests.isEmpty)
    // One never kept does not play offline.
    #expect(await offline.fetch("ds:0043", token: token, at: instance, media: true) == nil)
    // Another instance keeps its own loops.
    let other = try #require(URL(string: "https://other.example.org"))
    #expect(Loops(folder: folder, userId: "ana", origin: other, client: server).kept("ds:0042") == nil)
  }

  @Test func capKeepsNewest150() async throws {
    let folder = scratch()
    let loops = Loops(folder: folder, userId: "ana", origin: instance.origin, client: LoopServer())
    let kept = folder.appending(path: "belay.ana@https%3A%2F%2Fbelay.example.org", directoryHint: .isDirectory)
    try FileManager.default.createDirectory(at: kept, withIntermediateDirectories: true)
    let start = Date(timeIntervalSince1970: 1_700_000_000)
    for n in 1...150 {
      let url = kept.appending(path: String(format: "%04d.mp4", n))
      try Data("old".utf8).write(to: url)
      try FileManager.default.setAttributes(
        [.modificationDate: start.addingTimeInterval(Double(n))], ofItemAtPath: url.path)
    }
    _ = try #require(await loops.fetch("ds:0500", token: token, at: instance, media: true))
    let names = try FileManager.default.contentsOfDirectory(atPath: kept.path)
    #expect(names.count == 150)
    #expect(!names.contains("0001.mp4"))
    #expect(names.contains("0002.mp4"))
    #expect(names.contains("0500.mp4"))
  }

  /// A loop tells which exercise the person opened: it is kept under the store's own class, not
  /// whatever its folder has.
  @Test(.enabled(if: VolumeProtection.kept, VolumeProtection.reason))
  func keptUnderTheStoresProtection() async throws {
    let folder = scratch()
    try FileManager.default.createDirectory(
      at: folder, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUnlessOpen])
    let unnamed = folder.appending(path: "unnamed.mp4")
    try Data("loop".utf8).write(to: unnamed, options: .atomic)
    try #require(
      try protection(of: unnamed) == .completeUnlessOpen,
      "this volume keeps protection classes, so the read-back below can tell them apart")

    let loops = Loops(folder: folder, userId: "ana", origin: instance.origin, client: LoopServer())
    let url = try #require(await loops.fetch("ds:0042", token: token, at: instance, media: true))
    #expect(try protection(of: url) == AccountStore.protection)
  }

  private func protection(of url: URL) throws -> FileProtectionType? {
    try FileManager.default.attributesOfItem(atPath: url.path)[.protectionKey] as? FileProtectionType
  }

  @Test func removedAtSignOut() async throws {
    let folder = scratch()
    let loops = Loops(folder: folder, userId: "ana", origin: instance.origin, client: LoopServer())
    _ = try #require(await loops.fetch("ds:0042", token: token, at: instance, media: true))
    Loops.removeAll(in: folder)
    #expect(!FileManager.default.fileExists(atPath: folder.path))
    #expect(loops.kept("ds:0042") == nil)
  }

  /// Another person signing in on the same instance never sees the loops the first one looked at.
  @Test func twoAccountsOnOneInstanceDoNotShare() async throws {
    let folder = scratch()
    let ana = Loops(folder: folder, userId: "ana", origin: instance.origin, client: LoopServer())
    _ = try #require(await ana.fetch("ds:0042", token: token, at: instance, media: true))
    let bo = Loops(folder: folder, userId: "bo", origin: instance.origin, client: LoopServer(offline: true))
    #expect(bo.kept("ds:0042") == nil)
    #expect(await bo.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(ana.kept("ds:0042") != nil)
  }

  /// A fetch still out when the account goes writes nothing once its loops are closed and removed.
  @Test func fetchFinishingAfterSignOutWritesNothing() async throws {
    let folder = scratch()
    let server = LoopServer()
    let loops = Loops(folder: folder, userId: "ana", origin: instance.origin, client: server)
    async let fetched = loops.fetch("ds:0042", token: token, at: instance, media: true)
    // The request is out, its answer 50 ms away.
    while server.requests.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
    loops.close()
    Loops.removeAll(in: folder)
    #expect(await fetched == nil)
    #expect(!FileManager.default.fileExists(atPath: folder.path))
    // Nor does one asked after.
    #expect(await loops.fetch("ds:0043", token: token, at: instance, media: true) == nil)
    #expect(!FileManager.default.fileExists(atPath: folder.path))
  }

  @Test func aRefusedLoopIsNotAskedAgain() async {
    let server = LoopServer(status: 404)
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(server.requests.count == 1)
    #expect(loops.kept("ds:0042") == nil)
  }

  /// A phone off the network says nothing of the loop: back online, its next appearance asks again.
  @Test(arguments: [
    URLError.Code.notConnectedToInternet, .networkConnectionLost, .timedOut, .cannotConnectToHost,
    .dataNotAllowed, .internationalRoamingOff,
  ])
  func aLoopFailedOfflineIsFetchedAgainNextTime(code: URLError.Code) async throws {
    let server = LoopServer(failing: [code])
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    let url = try #require(await loops.fetch("ds:0042", token: token, at: instance, media: true))
    #expect(try Data(contentsOf: url) == Data("loop".utf8))
    #expect(server.requests.count == 2)
  }

  /// An error that is not the network's, an untrusted certificate say, is the visit's failure: the
  /// loop is not asked again until the app starts anew.
  @Test func aLoopFailedForAnotherReasonIsNotAskedAgain() async {
    let server = LoopServer(failing: [.serverCertificateUntrusted])
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(server.requests.count == 1)
    #expect(loops.kept("ds:0042") == nil)
  }

  /// The page left before its loop came: the request is dropped, nothing is kept, and the next
  /// visit asks again.
  @Test func aFetchNobodyWaitsForIsCancelled() async throws {
    let server = LoopServer(held: true)
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    let page = Task { await loops.fetch("ds:0042", token: token, at: instance, media: true) }
    while server.requests.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
    page.cancel()
    #expect(await page.value == nil)
    #expect(server.cancelled.withLock { $0 } == 1)
    #expect(loops.kept("ds:0042") == nil)

    server.release()
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) != nil)
    #expect(server.requests.count == 2)
  }

  /// A row and the page awaiting one loop: the row leaving does not drop the page's.
  @Test func aFetchStillAwaitedElsewhereGoesOn() async throws {
    let server = LoopServer(held: true)
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    let row = Task { await loops.fetch("ds:0042", token: token, at: instance, media: true) }
    while server.requests.isEmpty { try await Task.sleep(for: .milliseconds(5)) }
    let page = Task { await loops.fetch("ds:0042", token: token, at: instance, media: true) }
    for _ in 0..<1_000 where loops.waiting("ds:0042") < 2 { try await Task.sleep(for: .milliseconds(5)) }
    try #require(loops.waiting("ds:0042") == 2, "both await the one fetch")
    row.cancel()
    server.release()
    let url = try #require(await page.value)
    #expect(try Data(contentsOf: url) == Data("loop".utf8))
    #expect(server.cancelled.withLock { $0 } == 0)
    #expect(server.requests.count == 1)
    _ = await row.value
  }

  /// A page the instance answers in place of the loop, a login form say, is a failure, never kept.
  @Test func onlyAnMp4IsKept() async {
    let server = LoopServer(type: "text/html; charset=utf-8", body: Data("<html></html>".utf8))
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(loops.kept("ds:0042") == nil)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(server.requests.count == 1, "a failure, not asked again in the run")
  }

  /// At most the 8 MiB the instance serves (`MEDIA_MAX_BYTES`).
  @Test func atMostEightMebibytes() async throws {
    let limit = 8 * 1024 * 1024
    let over = Loops(
      folder: scratch(), userId: "ana", origin: instance.origin,
      client: LoopServer(body: Data(count: limit + 1)))
    #expect(await over.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(over.kept("ds:0042") == nil)
    let at = Loops(
      folder: scratch(), userId: "ana", origin: instance.origin, client: LoopServer(body: Data(count: limit)))
    let url = try #require(await at.fetch("ds:0042", token: token, at: instance, media: true))
    #expect(try Data(contentsOf: url).count == limit)
  }

  /// A row's thumbnail and the page asking at once make one request.
  @Test func concurrentFetchesAskOnce() async throws {
    let server = LoopServer()
    let loops = Loops(folder: scratch(), userId: "ana", origin: instance.origin, client: server)
    async let first = loops.fetch("ds:0042", token: token, at: instance, media: true)
    async let second = loops.fetch("ds:0042", token: token, at: instance, media: true)
    let (a, b) = await (first, second)
    #expect(a != nil && a == b)
    #expect(server.requests.count == 1)
  }

  @Test func mediaReadFromMe() throws {
    let on = try JSONDecoder().decode(Me.self, from: Data(#"{"id":"u1","displayName":"Ana","media":true}"#.utf8))
    #expect(on.media)
    let absent = try JSONDecoder().decode(Me.self, from: Data(#"{"id":"u1","displayName":"Ana"}"#.utf8))
    #expect(!absent.media)
  }
}
