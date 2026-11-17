import Foundation
import Synchronization
import Testing

@testable import BelayCore

// An exercise's loop: asked of the person's instance only, with the session's token, never while
// the instance serves no media; kept for offline, capped, and gone at sign-out.

/// Answers every request with one status and body, and keeps what it was sent.
private final class LoopServer: HTTPClient, Sendable {
  let sent = Mutex<[URLRequest]>([])
  private let status: Int
  private let offline: Bool

  init(status: Int = 200, offline: Bool = false) {
    self.status = status
    self.offline = offline
  }

  var requests: [URLRequest] { sent.withLock { $0 } }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    sent.withLock { $0.append(request) }
    if offline { throw URLError(.notConnectedToInternet) }
    let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!
    return (Data("loop".utf8), response)
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
    let loops = Loops(folder: scratch(), instanceKey: "belay.example.org", client: server)
    let url = try #require(await loops.fetch("ds:0042", token: token, at: instance, media: true))
    let request = try #require(server.requests.first)
    #expect(request.url?.absoluteString == "https://belay.example.org/media/exercises/0042")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(token)")
    #expect(request.httpMethod == "GET")
    #expect(try Data(contentsOf: url) == Data("loop".utf8))
  }

  @Test func neverSentWhenMediaOff() async {
    let server = LoopServer()
    let loops = Loops(folder: scratch(), instanceKey: "belay.example.org", client: server)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: false) == nil)
    #expect(server.requests.isEmpty)
  }

  @Test func onlyToTheInstance() async {
    let server = LoopServer()
    let loops = Loops(folder: scratch(), instanceKey: "belay.example.org", client: server)
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
    let online = Loops(folder: folder, instanceKey: "belay.example.org", client: LoopServer())
    let fetched = try #require(await online.fetch("ds:0042", token: token, at: instance, media: true))

    let server = LoopServer(offline: true)
    let offline = Loops(folder: folder, instanceKey: "belay.example.org", client: server)
    #expect(offline.kept("ds:0042") == fetched)
    #expect(await offline.fetch("ds:0042", token: token, at: instance, media: true) == fetched)
    #expect(server.requests.isEmpty)
    // One never kept does not play offline.
    #expect(await offline.fetch("ds:0043", token: token, at: instance, media: true) == nil)
    // Another instance's key keeps its own loops.
    #expect(Loops(folder: folder, instanceKey: "other.example.org", client: server).kept("ds:0042") == nil)
  }

  @Test func capKeepsNewest150() async throws {
    let folder = scratch()
    let loops = Loops(folder: folder, instanceKey: "belay.example.org", client: LoopServer())
    let kept = folder.appending(path: "belay.example.org", directoryHint: .isDirectory)
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

  @Test func removedAtSignOut() async throws {
    let folder = scratch()
    let loops = Loops(folder: folder, instanceKey: "belay.example.org", client: LoopServer())
    _ = try #require(await loops.fetch("ds:0042", token: token, at: instance, media: true))
    Loops.removeAll(in: folder)
    #expect(!FileManager.default.fileExists(atPath: folder.path))
    #expect(loops.kept("ds:0042") == nil)
  }

  @Test func failureNotRetried() async {
    let server = LoopServer(status: 404)
    let loops = Loops(folder: scratch(), instanceKey: "belay.example.org", client: server)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(await loops.fetch("ds:0042", token: token, at: instance, media: true) == nil)
    #expect(server.requests.count == 1)
    #expect(loops.kept("ds:0042") == nil)
  }

  @Test func mediaReadFromMe() throws {
    let on = try JSONDecoder().decode(Me.self, from: Data(#"{"id":"u1","displayName":"Ana","media":true}"#.utf8))
    #expect(on.media)
    let absent = try JSONDecoder().decode(Me.self, from: Data(#"{"id":"u1","displayName":"Ana"}"#.utf8))
    #expect(!absent.media)
  }
}
