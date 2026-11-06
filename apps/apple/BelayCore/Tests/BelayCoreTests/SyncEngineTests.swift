import Foundation
import GRDB
import Synchronization
import Testing

@testable import BelayCore

// The sync's rounds against a server the test scripts: what goes out, in which order, what the
// store keeps when the answer is not a 200, and one run at a time.

/// A server whose answers the test writes. Every request is kept; while held, a request waits
/// until the test lets it go, so a test can act in the middle of a send.
actor ScriptedTransport: SyncTransport {
  private(set) var requests: [SyncRequest] = []
  private(set) var maxInFlight = 0
  private var inFlight = 0
  private var holding = false
  private var held: [CheckedContinuation<Void, Never>] = []
  private let answer: @Sendable (SyncRequest, Int) -> SendResult

  init(_ answer: @escaping @Sendable (SyncRequest, Int) -> SendResult) {
    self.answer = answer
  }

  func hold() { holding = true }

  func release() {
    holding = false
    for request in held { request.resume() }
    held = []
  }

  func send(_ request: SyncRequest) async -> SendResult {
    let index = requests.count
    requests.append(request)
    inFlight += 1
    maxInFlight = max(maxInFlight, inFlight)
    if holding { await withCheckedContinuation { held.append($0) } }
    inFlight -= 1
    return answer(request, index)
  }
}

/// How many times something ran, readable from any closure.
final class Count: Sendable {
  private let value = Mutex(0)
  func bump() { value.withLock { $0 += 1 } }
  var now: Int { value.withLock { $0 } }
}

/// Waits until `condition` holds, or records an issue after two seconds.
func eventually(_ condition: () async -> Bool) async throws {
  for _ in 0..<2000 {
    if await condition() { return }
    try await Task.sleep(for: .milliseconds(1))
  }
  Issue.record("the condition never held")
}

extension Fixture {
  static func ok(cursor: String = "1", hasMore: Bool = false, workouts: [WorkoutRow] = [],
    sets: [SetRow] = []) -> SendResult
  {
    var response = response(cursor: cursor, workouts: workouts, sets: sets)
    response.hasMore = hasMore
    return .ok(response)
  }

  static func note(_ w: String, _ text: String, at minutes: Double) -> Change {
    .workout(WorkoutChange(id: w, at: time(minutes), edit: .note(text)))
  }
}

@Suite struct SyncEngineTests {
  let store: AccountStore
  let w = Fixture.id()
  let landed = Count()

  init() throws {
    store = try AccountStore.inMemory(userId: "u1")
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
  }

  private func engine(_ transport: ScriptedTransport, debounce: Duration = .seconds(1))
    -> SyncEngine
  {
    let landed = landed
    return SyncEngine(
      userId: "u1", store: store, transport: transport, debounce: debounce,
      onLanded: { landed.bump() })
  }

  @Test func sendsTheOldestFiveHundredWithTheCursorUntilTheQueueIsEmpty() async throws {
    // The start is already queued: 1 200 entries in all.
    try store.recordChanges(
      (1..<1200).map { Fixture.note(w, "n\($0)", at: Double($0) / 60) }, active: .keep)
    let queued = try store.outbox(limit: nil).map { RawChange(bytes: $0.bytes) }
    let transport = ScriptedTransport { _, i in Fixture.ok(cursor: "c\(i + 1)") }

    let engine = engine(transport)
    await engine.sync()

    let requests = await transport.requests
    #expect(requests.map(\.changes.count) == [500, 500, 200])
    #expect(requests.map(\.cursor) == ["0", "c1", "c2"])
    #expect(requests.allSatisfy { $0.account == "u1" })
    #expect(requests.flatMap(\.changes) == queued)
    #expect(try store.outbox(limit: nil).isEmpty)
    #expect(try store.cursor() == "c3")
    #expect(await engine.status == .idle)
    #expect(landed.now == 1)
  }

  @Test func aSyncAskedDuringARunRunsOnceMoreNeverTwoAtOnce() async throws {
    let transport = ScriptedTransport { _, i in Fixture.ok(cursor: "c\(i + 1)") }
    let engine = engine(transport)
    await transport.hold()

    let first = Task { await engine.sync() }
    try await eventually { await transport.requests.count == 1 }
    // A write lands while the start is out, and its sync is asked twice.
    try store.recordChanges([Fixture.note(w, "a", at: 1)], active: .keep)
    let second = Task { await engine.sync() }
    let third = Task { await engine.sync() }
    try await Task.sleep(for: .milliseconds(20))
    await transport.release()
    await first.value
    await second.value
    await third.value

    let requests = await transport.requests
    // The run drains the note, then one more run pulls what the server took meanwhile.
    #expect(requests.map(\.changes.count) == [1, 1, 0])
    #expect(await transport.maxInFlight == 1)
    #expect(try store.outbox(limit: nil).isEmpty)
  }

  @Test func refreshTakesTheRunGoingWithoutAnother() async throws {
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    let engine = engine(transport)
    await transport.hold()

    let first = Task { await engine.sync() }
    try await eventually { await transport.requests.count == 1 }
    let refresh = Task { await engine.refresh() }
    try await Task.sleep(for: .milliseconds(20))
    await transport.release()
    await first.value
    await refresh.value

    #expect(await transport.requests.count == 1)
  }

  @Test func refreshSyncsWhenNothingRuns() async throws {
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    await engine(transport).refresh()
    #expect(await transport.requests.count == 1)
  }

  @Test func pullsAgainWhileTheServerHasMoreAndStopsAtFifty() async throws {
    let transport = ScriptedTransport { _, i in Fixture.ok(cursor: "c\(i + 1)", hasMore: true) }
    let engine = engine(transport)
    await engine.sync()

    #expect(await transport.requests.count == 50)
    #expect(try store.cursor() == "c50")
    #expect(await engine.status == .idle)
    // The pull never reached the end: a set from elsewhere may still be missing.
    #expect(landed.now == 0)
  }

  @Test func landsOnlyOnceThePullIsComplete() async throws {
    let landed = landed
    let landedBefore = Mutex<[Int]>([])
    let transport = ScriptedTransport { _, i in
      landedBefore.withLock { $0.append(landed.now) }
      return Fixture.ok(cursor: "c\(i + 1)", hasMore: i < 2)
    }
    await engine(transport).sync()

    #expect(await transport.requests.map(\.cursor) == ["0", "c1", "c2"])
    #expect(landedBefore.withLock { $0 } == [0, 0, 0])
    #expect(landed.now == 1)
  }

  @Test(arguments: [
    (SendResult.offline, SyncStatus.offline), (.expired, .expired), (.failed, .failed),
  ])
  func aRefusedSendSetsItsStatusAndKeepsTheQueue(result: SendResult, status: SyncStatus)
    async throws
  {
    try store.recordChanges([Fixture.note(w, "a", at: 1)], active: .keep)
    let queued = try store.outbox(limit: nil)
    let transport = ScriptedTransport { _, _ in result }
    let engine = engine(transport)
    await engine.sync()

    #expect(await engine.status == status)
    #expect(try store.outbox(limit: nil) == queued)
    #expect(try store.cursor() == "0")
    #expect(await transport.requests.count == 1)
    #expect(landed.now == 0)
  }

  @Test func aStoreFailureSetsFailedAndLeavesTheQueue() async throws {
    let queued = try store.outbox(limit: nil)
    // The cursor is the answer's last write: refusing it rolls the whole answer back.
    try Fixture.refuseInserts(into: "meta", in: store)
    let transport = ScriptedTransport { _, _ in Fixture.ok(workouts: [Fixture.workoutRow(w)]) }
    let engine = engine(transport)
    await engine.sync()

    #expect(await engine.status == .failed)
    #expect(try store.outbox(limit: nil) == queued)
    #expect(try store.cursor() == "0")
    #expect(landed.now == 0)
  }

  @Test func stopDuringASendEndsQuietlyAndKeepsTheBatch() async throws {
    let queued = try store.outbox(limit: nil)
    let transport = ScriptedTransport { _, _ in Fixture.ok(cursor: "9") }
    let engine = engine(transport)
    await transport.hold()

    let run = Task { await engine.sync() }
    try await eventually { await transport.requests.count == 1 }
    await engine.stop()
    await transport.release()
    await run.value

    #expect(try store.outbox(limit: nil) == queued)
    #expect(try store.cursor() == "0")
    let status = await engine.status
    #expect(status != .failed && status != .offline)
    #expect(landed.now == 0)
    // Stopped for good: the account closing it is gone.
    await engine.sync()
    await engine.schedule()
    try await Task.sleep(for: .milliseconds(20))
    #expect(await transport.requests.count == 1)
  }

  @Test func theSameBatchSentAgainAfterALostAnswerEqualsOneSend() async throws {
    // The same phone twice over: one answer lost, the other not.
    let input = Fixture.set(w)
    _ = try store.recordSet(input, at: Fixture.time(1), active: Fixture.active(w))
    let twin = try AccountStore.inMemory(userId: "u1")
    _ = try twin.startWorkout(Fixture.start(w), now: Fixture.t0)
    _ = try twin.recordSet(input, at: Fixture.time(1), active: Fixture.active(w))
    #expect(try Fixture.changes(store) == Fixture.changes(twin))
    let held = try #require(try twin.history().sets.first)
    let answer = Fixture.ok(cursor: "7", workouts: [Fixture.workoutRow(w)], sets: [held])

    // The first answer is lost on the way back: the server took the batch, the phone never knew.
    let lossy = ScriptedTransport { _, i in i == 0 ? .offline : answer }
    let engine = engine(lossy)
    await engine.sync()
    await engine.sync()
    let once = ScriptedTransport { _, _ in answer }
    await SyncEngine(userId: "u1", store: twin, transport: once, onLanded: {}).sync()

    let requests = await lossy.requests
    #expect(requests.count == 2)
    #expect(requests[0].changes == requests[1].changes)
    #expect(try store.history() == twin.history())
    #expect(try store.outbox(limit: nil).isEmpty && twin.outbox(limit: nil).isEmpty)
    #expect(try store.cursor() == twin.cursor())
    #expect(try store.activeSession() == twin.activeSession())
  }

  @Test func theWebDevicesRowsAndThePhonesConvergeToTheServers() async throws {
    // The phone logs a set; meanwhile the web, on the same account, logged its own set at the same
    // place and ended the session. The server keeps both sets and the web's end.
    let mine = try store.recordSet(
      Fixture.set(w, kg: 60, at: 1), at: Fixture.time(1), active: Fixture.active(w))
    guard case .create(let created) = mine.edit else {
      Issue.record("not a creation")
      return
    }
    let web = SetRow(
      id: Fixture.id(2), workoutId: w, slotIndex: 0, position: 3, exerciseId: created.exerciseId,
      warmup: false, weightKg: 62.5, reps: 9, seconds: nil, rir: 1, doneAt: Fixture.time(2),
      fieldsAt: Fixture.time(2), removed: false, removedAt: nil)
    let phone = SetRow(
      id: mine.id, workoutId: w, slotIndex: 0, position: 3, exerciseId: created.exerciseId,
      warmup: false, weightKg: 60, reps: 8, seconds: nil, rir: 2, doneAt: Fixture.time(1),
      fieldsAt: Fixture.time(1), removed: false, removedAt: nil)
    let server = Fixture.workoutRow(w, ended: Fixture.time(3))
    let transport = ScriptedTransport { request, _ in
      #expect(request.changes.count == 2)
      return Fixture.ok(cursor: "12", workouts: [server], sets: [phone, web])
    }
    await engine(transport).sync()

    let history = try store.history()
    #expect(history.workouts == [server])
    #expect(history.sets.sorted { $0.id < $1.id } == [phone, web].sorted { $0.id < $1.id })
    // Ended elsewhere: this phone lets the session go.
    #expect(try store.activeSession() == nil)
    #expect(try store.outbox(limit: nil).isEmpty)
    #expect(landed.now == 1)
  }

  @Test func anUnreadableEntryIsRefusedAloneAndTheRestGoesOut() async throws {
    let unreadable = Data(#"{"kind":"weighIn","id":"x"}"#.utf8)
    try await store.writer.write { db in
      try db.execute(sql: "INSERT INTO outbox (bytes) VALUES (?)", arguments: [unreadable])
    }
    try store.recordChanges([Fixture.note(w, "a", at: 1)], active: .keep)
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    let engine = engine(transport)
    await engine.sync()

    let requests = await transport.requests
    #expect(requests.count == 1)
    #expect(requests[0].changes.count == 2)
    #expect(!requests[0].changes.contains(RawChange(bytes: unreadable)))
    #expect(await engine.status == .idle)
    #expect(try store.outbox(limit: nil).isEmpty)
    // Its trace stays, though no screen can say what it was.
    let traces = try await store.writer.read { db in
      try Data.fetchAll(db, sql: "SELECT bytes FROM rejected WHERE reason = 'unreadable'")
    }
    #expect(traces == [unreadable])
    #expect(try store.rejected().isEmpty)
  }

  @Test func writesCloseTogetherAreSentOnceAfterTheDebounce() async throws {
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    let engine = engine(transport, debounce: .milliseconds(50))
    await engine.schedule()
    await engine.schedule()
    await engine.schedule()
    #expect(await transport.requests.isEmpty)
    try await eventually { await transport.requests.count == 1 }
    try await Task.sleep(for: .milliseconds(120))
    #expect(await transport.requests.count == 1)
  }

  @Test func theStatusesStreamStartsWithTheCurrentOne() async throws {
    let transport = ScriptedTransport { _, _ in .offline }
    let engine = engine(transport)
    var statuses = engine.statuses().makeAsyncIterator()
    #expect(await statuses.next() == .idle)
    await engine.sync()
    #expect(await statuses.next() == .syncing)
    #expect(await statuses.next() == .offline)
  }
}
