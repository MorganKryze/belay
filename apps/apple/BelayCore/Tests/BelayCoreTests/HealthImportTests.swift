import Foundation
import Testing

@testable import BelayCore

// The weigh-ins read from Apple Health after a landed sync, against a fake Health that answers a
// read with the samples a test gives it: only days with no weigh-in are filled, at the start of
// their day, never from Belay's own samples, and the place in Health stays with its account.

/// Health as the import reads it: the samples it holds, the anchor it hands out, and what each read
/// asked for. Every write succeeds and is counted.
private actor FakeReader: HealthWriting {
  var samples: [HealthSample] = []
  /// A read iOS refused, or one that failed: no answer at all.
  var refused = false
  var next = "anchor-1"
  private(set) var asked: [(anchor: String?, since: Int64)] = []
  private(set) var writes = 0
  /// Runs inside the next read: what the person does while Health is read.
  private var duringRead: (@Sendable () throws -> Void)?
  /// Health's step total by day; a day it holds no samples for answers nil.
  var steps: [String: Double?] = [:]
  /// A steps read iOS refused, or one that failed.
  var stepsRefused = false
  private(set) var askedDays: [[String]] = []
  private var duringSteps: (@Sendable () throws -> Void)?

  func set(samples: [HealthSample]? = nil, refused: Bool? = nil, next: String? = nil) {
    if let samples { self.samples = samples }
    if let refused { self.refused = refused }
    if let next { self.next = next }
  }

  func during(read: @escaping @Sendable () throws -> Void) { duringRead = read }

  func set(steps: [String: Double?]? = nil, stepsRefused: Bool? = nil) {
    if let steps { self.steps = steps }
    if let stepsRefused { self.stepsRefused = stepsRefused }
  }

  func during(steps: @escaping @Sendable () throws -> Void) { duringSteps = steps }

  func readDaySteps(days: [String], timeZone: TimeZone) async -> [String: Double?]? {
    askedDays.append(days)
    try? duringSteps?()
    duringSteps = nil
    if stepsRefused { return nil }
    var out: [String: Double?] = [:]
    for day in days { out[day] = steps[day] ?? nil }
    // A day Health was not asked for, which the import must never write.
    out["2026-10-30"] = 4321
    return out
  }

  func access() async -> HealthAccess {
    HealthAccess(available: true, workouts: .allowed, effort: .allowed, weighIns: .allowed)
  }

  func authorize() async throws {}

  func save(_ w: HealthObject, syncId: String) async -> HealthOutcome {
    writes += 1
    return .written
  }

  func delete(syncId: String) async -> HealthOutcome { .removed }

  func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool { false }

  func relateEffort(score: Int, syncId: String, effortSyncId: String) async -> HealthOutcome {
    .written
  }

  func saveWeighIn(kg: Double, at: Int64, syncId: String, version: Int64) async -> HealthOutcome {
    writes += 1
    return .written
  }

  func deleteWeighIn(syncId: String) async -> HealthOutcome { .removed }

  func readWeighIns(anchor: String?, since: Int64) async -> (
    samples: [HealthSample], anchor: String
  )? {
    asked.append((anchor, since))
    try? duringRead?()
    duringRead = nil
    return refused ? nil : (samples, next)
  }
}

@Suite struct HealthImportTests {
  let userId = "user-1"
  var owner: String { ownerOf(userId) }
  /// 10:00 in Paris on 2026-11-06.
  let now = Fixture.t0

  private func ms(_ iso: String) -> Int64 { Instant.milliseconds(iso)! }

  private func reading(_ iso: String, _ kg: Double, syncId: String? = nil) -> HealthSample {
    HealthSample(startedAt: ms(iso), kg: kg, syncId: syncId)
  }

  /// A store with Santé and the import on, for `userId`.
  private func importing(_ userId: String? = nil) throws -> AccountStore {
    let store = try AccountStore.inMemory(userId: userId ?? self.userId)
    try store.setHealthOn(true, now: now.addingTimeInterval(-600))
    try store.setHealthImportOn(true)
    return store
  }

  /// A run after a landed sync; how many weigh-ins it imported.
  @discardableResult
  private func landed(_ store: AccountStore, _ health: FakeReader, owner: String? = nil) async
    -> Int
  {
    await runHealth(
      store: store, writer: health, owner: owner ?? self.owner, now: now, timeZone: Days.paris,
      imports: true)
  }

  private func weights(_ store: AccountStore) throws -> [WeightRow] { try store.body().weights }

  @Test func fillsOnlyEmptyDays() async throws {
    let store = try importing()
    try BodyActions(store: store, now: { Fixture.t0 }, timeZone: Days.paris)
      .weigh(date: "2026-11-04", kg: 81)
    let typed = try weights(store)
    let health = FakeReader()
    await health.set(samples: [
      reading("2026-11-04T06:00:00.000Z", 79),
      reading("2026-11-05T06:30:00.000Z", 79.4),
      reading("2026-11-05T05:00:00.000Z", 79.6),
    ])

    #expect(await landed(store, health) == 1)

    #expect(try weights(store).first == typed.first)
    #expect(try weights(store).map(\.date) == ["2026-11-04", "2026-11-05"])
    #expect(try weights(store).last?.weightKg == 79.6)
    // Queued as an ordinary weigh-in, so the web shows the day once.
    #expect(
      try Fixture.changes(store).map(\.weightDay) == ["2026-11-04", "2026-11-05"])
  }

  @Test func stampedAtDayStart() async throws {
    let store = try importing()
    let health = FakeReader()
    await health.set(samples: [reading("2026-11-05T05:00:00.000Z", 79.6)])

    await landed(store, health)

    // Midnight in Paris: a weigh-in typed for that day, here or offline elsewhere, is later.
    #expect(
      try weights(store)
        == [WeightRow(date: "2026-11-05", weightKg: 79.6, at: "2026-11-04T23:00:00.000Z")])
  }

  @Test func neverReadsOwnSamples() async throws {
    let store = try importing()
    let health = FakeReader()
    await health.set(samples: [
      // This phone's weigh-in, and one the old app or another account's phone wrote.
      reading(
        "2026-11-03T07:00:00.000Z", 80,
        syncId: weighingSyncId(owner: owner, date: "2026-11-03")),
      reading("2026-11-04T07:00:00.000Z", 80, syncId: "belay-weighing-ffff0000-2026-11-04"),
      reading("2026-11-05T06:00:00.000Z", 79.6, syncId: "scale-42"),
    ])

    #expect(await landed(store, health) == 1)

    #expect(try weights(store).map(\.date) == ["2026-11-05"])
  }

  /// The server holds days the earlier app imported from the same scale; Health holds the scale's
  /// readings and the earlier app's samples of them. Nothing is imported or written twice.
  @Test func oldAppDaysStayOne() async throws {
    let store = try importing()
    var server = Fixture.response()
    server.weights = [
      WeightRow(date: "2026-11-02", weightKg: 79.8, at: "2026-11-01T23:00:00.000Z"),
      WeightRow(date: "2026-11-03", weightKg: 79.7, at: "2026-11-02T23:00:00.000Z"),
    ]
    try store.applyServer(sent: [], response: server)
    let health = FakeReader()
    await health.set(samples: [
      reading("2026-11-02T06:00:00.000Z", 79.8),
      reading("2026-11-03T06:00:00.000Z", 79.7),
      reading(
        "2026-11-02T07:00:00.000Z", 79.8,
        syncId: weighingSyncId(owner: owner, date: "2026-11-02")),
    ])

    #expect(await landed(store, health) == 0)

    #expect(try weights(store) == server.weights)
    #expect(try Fixture.changes(store).isEmpty)
    #expect(await health.writes == 0)
  }

  @Test func anchorKeptPerAccount() async throws {
    let first = try importing("user-1")
    let second = try importing("user-2")
    let health = FakeReader()
    await health.set(samples: [reading("2026-11-05T05:00:00.000Z", 79.6)], next: "first-place")

    await landed(first, health)
    #expect(try first.healthSettings().anchor == "first-place")
    #expect(try second.healthSettings().anchor == nil)

    // A run that follows no landed sync reads nothing.
    await runHealth(
      store: first, writer: health, owner: owner, now: now, timeZone: Days.paris, imports: false)
    await landed(second, health, owner: ownerOf("user-2"))
    await landed(first, health)

    let asked = await health.asked
    #expect(asked.map(\.anchor) == [nil, nil, "first-place"])
    // The first read covers the whole history.
    #expect(asked.allSatisfy { $0.since == healthEarliest })
  }

  @Test func offDuringReadTakesNothing() async throws {
    let store = try importing()
    let health = FakeReader()
    await health.set(samples: [reading("2026-11-05T05:00:00.000Z", 79.6)])
    await health.during(read: { try store.setHealthImportOn(false) })

    #expect(await landed(store, health) == 0)

    #expect(try weights(store).isEmpty)
    #expect(try store.healthSettings().anchor == nil)
  }

  /// iOS answers a refused read as an empty Health: no place is kept, so a read allowed later
  /// starts from the floor.
  @Test func refusedReadTakesNothing() async throws {
    let store = try importing()
    let health = FakeReader()
    await health.set(refused: true)
    #expect(await landed(store, health) == 0)
    #expect(try store.healthSettings().anchor == nil)

    await health.set(samples: [], refused: false)
    #expect(await landed(store, health) == 0)
    #expect(try store.healthSettings().anchor == nil)
    #expect(try weights(store).isEmpty)
  }

  /// The import reads through Santé's switch: it goes on only with it, and off with it.
  @Test func theImportFollowsSante() throws {
    let store = try AccountStore.inMemory(userId: userId)
    try store.setHealthImportOn(true)
    #expect(try store.healthSettings().importOn == false)

    try store.setHealthOn(true, now: now)
    try store.setHealthImportOn(true)
    #expect(try store.healthSettings().importOn)
    try store.setHealthOn(false, now: now)
    #expect(try store.healthSettings().importOn == false)
  }

  /// A record written before the import decodes with it off and no place.
  @Test func anEarlierRecordDecodesWithTheImportOff() throws {
    let json = Data(#"{"on":true,"turnedOnAt":5}"#.utf8)
    #expect(
      try Rows.decode(HealthSettings.self, json) == HealthSettings(on: true, turnedOnAt: 5))
  }

  // MARK: Steps

  /// A store with Santé and the steps import on.
  private func stepping() throws -> AccountStore {
    let store = try AccountStore.inMemory(userId: userId)
    try store.setHealthOn(true, now: now.addingTimeInterval(-600))
    try store.setHealthStepsOn(true)
    return store
  }

  private func steps(_ store: AccountStore) throws -> [String: Int?] {
    try store.writer.read { db in
      try BodyRows.all(StepsRow.self, db, "steps")
    }.reduce(into: [:]) { $0[$1.date] = $1.steps }
  }

  private func actions(_ store: AccountStore, at minutes: Double = 0) -> BodyActions {
    BodyActions(
      store: store, now: { Fixture.t0.addingTimeInterval(minutes * 60) }, timeZone: Days.paris)
  }

  @Test func stepsWriteEmptyDays() async throws {
    let store = try stepping()
    let health = FakeReader()
    await health.set(steps: ["2026-11-05": 8436.6, "2026-11-06": 1200])

    await landed(store, health)

    #expect(try steps(store) == ["2026-11-05": 8437, "2026-11-06": 1200])
    #expect(try store.stepsWritten() == ["2026-11-05": 8437, "2026-11-06": 1200])
    // Queued as ordinary steps, so the web shows them.
    #expect(try Fixture.changes(store).map(\.stepsDay) == ["2026-11-05", "2026-11-06"])
  }

  /// A day this phone imported follows Health; one the person then typed, even with the import's
  /// own value, is theirs.
  @Test func stepsFollowOwnWrite() async throws {
    let store = try stepping()
    let health = FakeReader()
    await health.set(steps: ["2026-11-06": 5000])
    await landed(store, health)
    await health.set(steps: ["2026-11-06": 6000])
    await landed(store, health)
    #expect(try steps(store)["2026-11-06"] == 6000)

    try actions(store, at: 1).writeSteps(date: "2026-11-06", value: 6000, own: false)
    await health.set(steps: ["2026-11-06": 7000])
    await landed(store, health)

    #expect(try steps(store)["2026-11-06"] == 6000)
    #expect(try store.stepsWritten().isEmpty)
  }

  /// The phone imported a day, then the web replaced it, and deleted another: the pulled values
  /// stand against Health's.
  @Test func stepsKeepWebValue() async throws {
    let store = try stepping()
    let health = FakeReader()
    await health.set(steps: ["2026-11-05": 5000, "2026-11-06": 5000])
    await landed(store, health)
    var server = Fixture.response()
    server.steps = [
      StepsRow(date: "2026-11-05", steps: 4000, stepsAt: "2026-11-06T09:30:00.000Z"),
      StepsRow(date: "2026-11-06", steps: nil, stepsAt: "2026-11-06T09:30:00.000Z"),
    ]
    try store.applyServer(sent: [], response: server)
    let queued = try Fixture.changes(store).count

    await health.set(steps: ["2026-11-05": 6000, "2026-11-06": 6000])
    await landed(store, health)

    let pulled: [String: Int?] = ["2026-11-05": 4000, "2026-11-06": nil]
    #expect(try steps(store) == pulled)
    #expect(try Fixture.changes(store).count == queued)
  }

  @Test func stepsSkipAboveCapAndNoSamples() async throws {
    let store = try stepping()
    let health = FakeReader()
    await health.set(steps: ["2026-11-04": 100_000.4, "2026-11-05": 100_001, "2026-11-06": nil])

    await landed(store, health)

    #expect(try steps(store) == ["2026-11-04": 100_000])
  }

  @Test func stepsUnchangedWritesNothing() async throws {
    let store = try stepping()
    let health = FakeReader()
    await health.set(steps: ["2026-11-06": 5000])
    await landed(store, health)
    let queued = try Fixture.changes(store).count

    await landed(store, health)

    #expect(try Fixture.changes(store).count == queued)
  }

  /// Off, before a landed sync, or with Santé off: Health's steps are never read.
  @Test func stepsOffReadsNothing() async throws {
    let store = try AccountStore.inMemory(userId: userId)
    try store.setHealthOn(true, now: now)
    let health = FakeReader()
    await health.set(steps: ["2026-11-06": 5000])
    await landed(store, health)

    try store.setHealthStepsOn(true)
    await runHealth(
      store: store, writer: health, owner: owner, now: now, timeZone: Days.paris, imports: false)

    try store.setHealthOn(false, now: now)
    await landed(store, health)

    #expect(await health.askedDays.isEmpty)
    #expect(try steps(store).isEmpty)
  }

  @Test func stepsRefusedReadsNothing() async throws {
    let store = try stepping()
    let health = FakeReader()
    await health.set(steps: ["2026-11-06": 5000], stepsRefused: true)
    await landed(store, health)
    #expect(try steps(store).isEmpty)

    // Turned off while Health was read: nothing is taken.
    await health.set(stepsRefused: false)
    await health.during(steps: { try store.setHealthStepsOn(false) })
    await landed(store, health)
    #expect(try steps(store).isEmpty)
  }

  @Test func stepsSevenDaysOnly() async throws {
    let store = try stepping()
    let health = FakeReader()

    await landed(store, health)

    #expect(
      await health.askedDays == [
        [
          "2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
          "2026-11-06",
        ]
      ])
    #expect(try steps(store).isEmpty)
  }
}

extension Change {
  /// The day of a weigh-in change, nil for any other.
  fileprivate var weightDay: String? {
    if case .weight(let c) = self { c.date } else { nil }
  }

  /// The day of a steps change, nil for any other.
  fileprivate var stepsDay: String? {
    if case .steps(let c) = self { c.date } else { nil }
  }
}
