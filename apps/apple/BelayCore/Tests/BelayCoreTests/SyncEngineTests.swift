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

/// An instance whose contract version the test sets; nil stands for an instance not reached. Each
/// ask is counted, with how many sends had gone out by then. While held, an ask waits until the
/// test lets it go, and answers what the instance said when it was asked.
actor ScriptedProbe: VersionProbe {
  private(set) var asks: [Int] = []
  private var answer: VersionAnswer?
  private let sends: ScriptedTransport
  private var holding = false
  private var held: [CheckedContinuation<Void, Never>] = []

  init(_ answer: VersionAnswer?, sends: ScriptedTransport) {
    self.answer = answer
    self.sends = sends
  }

  func answer(_ next: VersionAnswer?) { answer = next }

  func hold() { holding = true }

  func release() {
    holding = false
    for ask in held { ask.resume() }
    held = []
  }

  func version() async -> VersionAnswer? {
    let said = answer
    asks.append(await sends.requests.count)
    if holding { await withCheckedContinuation { held.append($0) } }
    return said
  }
}

/// An instance's `api/instance` answer at the version the test sets.
final class VersionServer: HTTPClient, Sendable {
  private let api = Mutex(0)
  init(api: Int) { set(api) }
  func set(_ next: Int) { api.withLock { $0 = next } }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let version = api.withLock { $0 }
    let body = #"{"app":"belay","api":\#(version),"origin":"https://belay.example.org"}"#
    let response = HTTPURLResponse(
      url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    return (Data(body.utf8), response)
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

  /// A sync answer as a later server could write it: a kind of rows this build has never heard
  /// of, and a field it does not know on each set.
  static func answerWithUnknowns(workouts: [WorkoutRow], sets: [SetRow]) throws -> Data {
    func objects(_ rows: some Encodable) throws -> [[String: Any]] {
      try JSONSerialization.jsonObject(with: JSONEncoder().encode(rows)) as! [[String: Any]]
    }
    let answer: [String: Any] = [
      "cursor": "8", "workouts": try objects(workouts),
      "sets": try objects(sets).map { $0.merging(["grip": "wide"]) { old, _ in old } },
      "chalkLogs": [["id": "c1", "grams": 12]],
      "activities": [], "rejected": [], "hasMore": false,
    ]
    return try JSONSerialization.data(withJSONObject: answer)
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

  private func engine(
    _ transport: ScriptedTransport, probe: (any VersionProbe)? = nil, debounce: Duration = .seconds(1)
  ) -> SyncEngine {
    let landed = landed
    return SyncEngine(
      userId: "u1", store: store, transport: transport, probe: probe, debounce: debounce,
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
    await SyncEngine(userId: "u1", store: twin, transport: once, probe: nil, onLanded: {}).sync()

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

  /// A later build wrote it and this one cannot read it: it stays queued as written, for that build
  /// to send, and never holds back the rest.
  @Test func anUnreadableEntryStaysQueuedAndTheRestGoesOut() async throws {
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
    #expect(landed.now == 1)
    let queued = try await store.writer.read { db in
      try Data.fetchAll(db, sql: "SELECT bytes FROM outbox ORDER BY id")
    }
    #expect(queued == [unreadable])
    let refused = try await store.writer.read { db in
      try Int.fetchOne(db, sql: "SELECT COUNT(*) FROM rejected")
    }
    #expect(refused == 0)

    // The next run sends nothing more: the entry waits without making the queue look busy.
    await engine.sync()
    #expect(await transport.requests.count == 2)
    #expect(await transport.requests[1].changes.isEmpty)
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

  @Test func checksTheVersionBeforeTheFirstSend() async throws {
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    let probe = ScriptedProbe(.same, sends: transport)
    await engine(transport, probe: probe).sync()

    #expect(await probe.asks == [0])
    #expect(await transport.requests.count == 1)
  }

  @Test func checksAgainOnlyAfterAReturnOrAnUnreadableAnswer() async throws {
    // The third send comes back unreadable.
    let transport = ScriptedTransport { _, i in i == 2 ? .failed : Fixture.ok() }
    let probe = ScriptedProbe(.same, sends: transport)
    let engine = engine(transport, probe: probe)

    await engine.sync()
    await engine.sync()
    #expect(await probe.asks == [0])
    await engine.versionOwed()
    await engine.sync()
    #expect(await probe.asks == [0, 2])
    #expect(await engine.status == .failed)
    await engine.sync()
    await engine.sync()
    #expect(await probe.asks == [0, 2, 3])
    #expect(await transport.requests.count == 5)
  }

  @Test func aReturnDuringACheckIsCheckedAgainBeforeAnySend() async throws {
    let queued = try store.outbox(limit: nil)
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    let probe = ScriptedProbe(.same, sends: transport)
    let engine = engine(transport, probe: probe)
    await probe.hold()

    let first = Task { await engine.sync() }
    try await eventually { await probe.asks.count == 1 }
    // The instance is updated and the person comes back while the first check is still out.
    await probe.answer(.instanceAhead)
    await engine.versionOwed()
    await probe.release()
    await first.value
    await engine.sync()

    #expect(await probe.asks == [0, 0])
    #expect(await transport.requests.isEmpty)
    #expect(try store.outbox(limit: nil) == queued)
    #expect(await engine.status == .instanceAhead)
  }

  @Test func anInstanceAnsweringZeroHoldsTheQueueUntilItAnswersThisVersion() async throws {
    try store.recordChanges([Fixture.note(w, "a", at: 1)], active: .keep)
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    let server = VersionServer(api: 0)
    let instance = Instance(uncheckedOrigin: URL(string: "https://belay.example.org")!)
    let engine = engine(transport, probe: HTTPVersionProbe(instance: instance, client: server))

    await engine.sync()
    #expect(await transport.requests.isEmpty)
    #expect(await engine.status == .instanceBehind)

    server.set(Bounds.apiVersion)
    await engine.versionOwed()
    await engine.sync()
    #expect(await transport.requests.count == 1)
    #expect(try store.outbox(limit: nil).isEmpty)
    #expect(await engine.status == .idle)
  }

  @Test(arguments: [
    (VersionAnswer.instanceBehind, SyncStatus.instanceBehind), (.instanceAhead, .instanceAhead),
  ])
  func anotherVersionSendsAndPullsNothingAndKeepsTheQueue(
    answer: VersionAnswer, status: SyncStatus
  ) async throws {
    try store.recordChanges([Fixture.note(w, "a", at: 1)], active: .keep)
    let queued = try store.outbox(limit: nil)
    let transport = ScriptedTransport { _, _ in Fixture.ok(cursor: "9") }
    let engine = engine(transport, probe: ScriptedProbe(answer, sends: transport))

    await engine.sync()
    #expect(await engine.status == status)
    #expect(try store.outbox(limit: nil) == queued)

    // A write made meanwhile lands and waits with the rest.
    try store.recordChanges([Fixture.note(w, "b", at: 2)], active: .keep)
    await engine.sync()
    #expect(try store.outbox(limit: nil).count == queued.count + 1)
    #expect(try store.history().workouts.first?.note == "b")
    #expect(await transport.requests.isEmpty)
    #expect(try store.cursor() == "0")
    #expect(await engine.status == status)
    #expect(landed.now == 0)
  }

  @Test func aMatchLaterSendsTheQueueOnceAndTheStatusLeaves() async throws {
    try store.recordChanges([Fixture.note(w, "a", at: 1)], active: .keep)
    let queued = try store.outbox(limit: nil).map { RawChange(bytes: $0.bytes) }
    let transport = ScriptedTransport { _, _ in Fixture.ok() }
    let probe = ScriptedProbe(.instanceAhead, sends: transport)
    let engine = engine(transport, probe: probe)
    await engine.sync()
    #expect(await engine.status == .instanceAhead)

    // The instance was updated; the person comes back to the app.
    await probe.answer(.same)
    await engine.versionOwed()
    await engine.sync()

    let requests = await transport.requests
    #expect(requests.count == 1)
    #expect(requests.first?.changes == queued)
    #expect(try store.outbox(limit: nil).isEmpty)
    #expect(await engine.status == .idle)
    #expect(landed.now == 1)
  }

  @Test func anUnreachableCheckKeepsTheLastAnswer() async throws {
    // No answer yet: the queue is not held for a check that never came back.
    let first = ScriptedTransport { _, _ in Fixture.ok() }
    await engine(first, probe: ScriptedProbe(nil, sends: first)).sync()
    #expect(await first.requests.count == 1)

    for (last, sends) in [(VersionAnswer.same, 1), (.instanceAhead, 0)] {
      let transport = ScriptedTransport { _, _ in Fixture.ok() }
      let probe = ScriptedProbe(last, sends: transport)
      let engine = engine(transport, probe: probe)
      await engine.sync()
      await probe.answer(nil)
      await engine.versionOwed()
      await engine.sync()

      #expect(await probe.asks.count == 2, "\(last)")
      #expect(await transport.requests.count == 2 * sends, "\(last)")
      #expect(await engine.status == (last == .same ? .idle : .instanceAhead), "\(last)")
    }
  }

  @Test func aPullWithUnknownKindsAndFieldsAppliesWhatItKnows() async throws {
    let set = SetRow(
      id: Fixture.id(2), workoutId: w, slotIndex: 0, position: 3, exerciseId: "belay:back-squat",
      warmup: false, weightKg: 62.5, reps: 9, seconds: nil, rir: 1, doneAt: Fixture.time(2),
      fieldsAt: Fixture.time(2), removed: false, removedAt: nil)
    let workout = Fixture.workoutRow(w)
    let bytes = try Fixture.answerWithUnknowns(workouts: [workout], sets: [set])
    let response = try JSONDecoder().decode(SyncResponse.self, from: bytes)
    let transport = ScriptedTransport { _, _ in .ok(response) }
    let engine = engine(transport, probe: ScriptedProbe(.same, sends: transport))
    await engine.sync()

    let history = try store.history()
    #expect(history.workouts == [workout])
    #expect(history.sets == [set])
    #expect(try store.cursor() == "8")
    #expect(await engine.status == .idle)
  }
}
