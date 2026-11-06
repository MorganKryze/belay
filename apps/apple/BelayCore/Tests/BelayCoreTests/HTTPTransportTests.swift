import Foundation
import Synchronization
import Testing

@testable import BelayCore

// The sync's one request: what it carries, how its answer reads, and what reaches the log.

/// Answers every request the same way and keeps what it was sent.
private final class AnsweringClient: HTTPClient, Sendable {
  let sent = Mutex<[URLRequest]>([])
  private let answer: @Sendable (URLRequest) throws -> (Data, HTTPURLResponse)

  init(_ answer: @escaping @Sendable (URLRequest) throws -> (Data, HTTPURLResponse)) {
    self.answer = answer
  }

  convenience init(status: Int, body: String = "") {
    self.init { request in
      (Data(body.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil,
        headerFields: nil)!)
    }
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    sent.withLock { $0.append(request) }
    return try answer(request)
  }
}

private final class LogLines: Sendable {
  let lines = Mutex<[String]>([])
  func write(_ line: String) { lines.withLock { $0.append(line) } }
}

private let token = "tok-7c1d9e-secret"
private let empty = #"{"cursor":"5","workouts":[],"sets":[],"activities":[],"rejected":[],"hasMore":false}"#

@Suite struct HTTPTransportTests {
  let instance = Instance(storedOrigin: "https://belay.example.org")!
  /// Bytes no encoder would write, so a test sees they went out as stored.
  let queued = RawChange(bytes: Data(#"{"kind":"workout",  "id":"w1", "note":"genou droit"}"#.utf8))

  private func request() -> SyncRequest {
    SyncRequest(account: "u1", cursor: "4", changes: [queued])
  }

  private func transport(_ client: HTTPClient, _ log: LogLines = LogLines()) -> HTTPTransport {
    HTTPTransport(instance: instance, token: token, client: client, log: log.write)
  }

  @Test func postsTheQueuedBytesWithTheBearer() async throws {
    let client = AnsweringClient(status: 200, body: empty)
    _ = await transport(client).send(request())

    let sent = try #require(client.sent.withLock { $0.first })
    #expect(sent.url?.absoluteString == "https://belay.example.org/api/sync")
    #expect(sent.httpMethod == "POST")
    #expect(sent.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
    #expect(sent.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(sent.value(forHTTPHeaderField: "Cookie") == nil)
    #expect(sent.timeoutInterval == 20)
    let body = try #require(sent.httpBody)
    #expect(body == (try request().body()))
    #expect(body.range(of: queued.bytes) != nil)
  }

  @Test func aDecodedAnswerIsOk() async throws {
    let result = await transport(AnsweringClient(status: 200, body: empty)).send(request())
    guard case .ok(let response) = result else {
      Issue.record("not ok: \(result)")
      return
    }
    #expect(response.cursor == "5")
    #expect(!response.hasMore)
  }

  @Test(arguments: [
    (401, empty, SyncStatus.expired), (409, empty, .expired), (403, empty, .failed),
    (500, empty, .failed), (302, "", .failed), (204, "", .failed), (200, "<html>", .failed),
    (200, #"{"cursor":"5"}"#, .failed),
  ])
  func eachAnswerMapsToItsStatus(status: Int, body: String, expected: SyncStatus) async {
    let result = await transport(AnsweringClient(status: status, body: body)).send(request())
    #expect(result.status == expected)
  }

  @Test(arguments: [URLError.Code.timedOut, .notConnectedToInternet, .cannotFindHost])
  func noAnswerIsOffline(code: URLError.Code) async {
    let client = AnsweringClient { _ in throw URLError(code) }
    #expect(await transport(client).send(request()).status == .offline)
  }

  @Test func theLogNamesStatusesNeverTheTokenNorTheBody() async throws {
    let log = LogLines()
    for status in [200, 401, 409, 500] {
      _ = await transport(AnsweringClient(status: status, body: "<p>genou droit</p>"), log)
        .send(request())
    }
    _ = await transport(AnsweringClient { _ in throw URLError(.timedOut) }, log).send(request())

    let lines = log.lines.withLock { $0 }
    #expect(lines.count == 5)
    for code in ["200", "401", "409", "500"] {
      #expect(lines.contains { $0.contains(code) }, "no line names \(code)")
    }
    for line in lines {
      #expect(!line.contains(token) && !line.contains("tok-"))
      #expect(!line.contains("genou") && !line.contains("w1") && !line.contains("u1"))
    }
  }
}
