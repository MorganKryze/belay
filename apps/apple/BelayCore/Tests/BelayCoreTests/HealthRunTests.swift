import Foundation
import GRDB
import Testing

@testable import BelayCore

// The run that brings Apple Health in line with the store, against a fake Health that records
// every call: what it writes, removes and relates, and when it does nothing at all.

/// Health as a test sets it up: the access it answers, whether another app's workout covers a
/// span, and every call it was made.
private actor FakeHealth: HealthWriting {
  var answer = HealthAccess(available: true, workouts: .allowed, effort: .allowed)
  var covered = false
  /// What a save answers; `.written` unless a test says otherwise.
  var saving = HealthOutcome.written
  private(set) var saved: [(object: HealthObject, syncId: String)] = []
  private(set) var deleted: [String] = []
  private(set) var related: [(score: Int, syncId: String)] = []
  private(set) var looked = 0
  private(set) var calls = 0
  /// Runs inside the first save, or the first relate: what the person does while Health works.
  private var duringSave: (@Sendable () throws -> Void)?
  private var duringRelate: (@Sendable () throws -> Void)?

  func set(access: HealthAccess? = nil, covered: Bool? = nil, saving: HealthOutcome? = nil) {
    if let access { answer = access }
    if let covered { self.covered = covered }
    if let saving { self.saving = saving }
  }

  func during(
    save: (@Sendable () throws -> Void)? = nil, relate: (@Sendable () throws -> Void)? = nil
  ) {
    duringSave = save
    duringRelate = relate
  }

  func access() async -> HealthAccess {
    calls += 1
    return answer
  }

  func authorize() async throws { calls += 1 }

  func save(_ w: HealthObject, syncId: String) async -> HealthOutcome {
    calls += 1
    try? duringSave?()
    duringSave = nil
    if saving == .written { saved.append((w, syncId)) }
    return saving
  }

  func delete(syncId: String) async -> HealthOutcome {
    calls += 1
    deleted.append(syncId)
    return .removed
  }

  func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool {
    calls += 1
    looked += 1
    return covered
  }

  func relateEffort(score: Int, syncId: String) async -> HealthOutcome {
    calls += 1
    try? duringRelate?()
    duringRelate = nil
    related.append((score, syncId))
    return .written
  }
}

@Suite struct HealthRunTests {
  let userId = "user-1"
  var owner: String { ownerOf(userId) }
  let w = Fixture.id(0)
  /// The run's clock: two hours after the fixture's start, well within Health's day.
  let now = Fixture.t0.addingTimeInterval(2 * 3600)

  /// A session started at `start`, one set logged, ended at `end` (minutes from the fixture's
  /// start). Its set's id is returned, to remove it.
  @discardableResult
  private func finished(_ store: AccountStore, _ id: String, start: Double = 0, end: Double = 30)
    throws -> String
  {
    _ = try store.startWorkout(
      Fixture.start(id, at: start), now: Fixture.t0.addingTimeInterval(start * 60))
    let set = try store.recordSet(
      Fixture.set(id, at: start + 1), at: Fixture.time(start + 1), active: Fixture.active(id))
    try edit(store, id, at: end, .ended(Fixture.time(end)))
    return set.id
  }

  private func edit(_ store: AccountStore, _ id: String, at: Double, _ edit: WorkoutChange.Edit)
    throws
  {
    try store.recordChanges(
      [.workout(WorkoutChange(id: id, at: Fixture.time(at), edit: edit))], active: .clear)
  }

  private func storeOn(at minutes: Double = -10) throws -> AccountStore {
    let store = try AccountStore.inMemory(userId: userId)
    try store.setHealthOn(true, now: Fixture.t0.addingTimeInterval(minutes * 60))
    return store
  }

  private func run(_ store: AccountStore, _ health: FakeHealth, at: Date? = nil) async {
    await runHealth(store: store, writer: health, owner: owner, now: at ?? now)
  }

  @Test func theSwitchStartsOffAndRemembersWhenItWentOn() throws {
    let store = try AccountStore.inMemory(userId: userId)
    #expect(try store.healthSettings() == HealthSettings(on: false, turnedOnAt: nil))
    try store.setHealthOn(true, now: Fixture.t0)
    #expect(
      try store.healthSettings()
        == HealthSettings(on: true, turnedOnAt: Instant.milliseconds(Fixture.t0)))
  }

  @Test func anEligibleSessionIsWrittenOnceAndAReplayWritesNothing() async throws {
    let store = try storeOn()
    try finished(store, w)
    let health = FakeHealth()

    await run(store, health)
    await run(store, health)

    let saved = await health.saved
    #expect(saved.count == 1)
    guard case .workout(let id, let startedAt, let endedAt, _) = saved.first?.object else {
      Issue.record("a workout is saved")
      return
    }
    #expect(id == w)
    #expect(startedAt == Instant.milliseconds(Fixture.t0))
    #expect(endedAt == Instant.milliseconds(Fixture.t0.addingTimeInterval(30 * 60)))
    guard case .workout = try store.healthWritten()[sessionKey(w)] else {
      Issue.record("the record holds the workout")
      return
    }
  }

  @Test func theSyncIdCarriesTheOwnerTag() async throws {
    let store = try storeOn()
    try finished(store, w)
    let health = FakeHealth()

    await run(store, health)

    #expect(await health.saved.first?.syncId == "belay-session-\(owner)-\(w)")
    #expect(healthSyncId(w, owner: owner) == "belay-session-\(owner)-\(w)")
    #expect(healthSyncId(w, owner: ownerOf("user-2")) != healthSyncId(w, owner: owner))
  }

  @Test func aSessionEndedBeforeTheSwitchWentOnIsNotWritten() async throws {
    let store = try AccountStore.inMemory(userId: userId)
    try finished(store, w, end: 30)
    try store.setHealthOn(true, now: Fixture.t0.addingTimeInterval(60 * 60))
    let health = FakeHealth()

    await run(store, health)

    #expect(await health.saved.isEmpty)
    #expect(try store.healthWritten().isEmpty)
  }

  @Test func aChangedEndSavesAgainWithAGreaterVersion() async throws {
    let store = try storeOn()
    try finished(store, w, end: 30)
    let health = FakeHealth()
    await run(store, health)
    let first = try #require(try store.healthWritten()[sessionKey(w)]).version

    try edit(store, w, at: 46, .ended(Fixture.time(45)))
    await run(store, health)

    let saved = await health.saved
    #expect(saved.count == 2)
    guard case .workout(_, _, let endedAt, let version) = saved.last?.object else {
      Issue.record("the workout is saved again")
      return
    }
    #expect(endedAt == Instant.milliseconds(Fixture.t0.addingTimeInterval(45 * 60)))
    #expect(version > first)
    #expect(try store.healthWritten()[sessionKey(w)]?.version == version)
  }

  @Test func theVersionRisesEvenWhenTheRowTimesDoNot() async throws {
    let store = try storeOn()
    try finished(store, w, end: 30)
    // A record ahead of every time on the row, as after a clock set back.
    let ahead = Instant.milliseconds(Fixture.t0.addingTimeInterval(3 * 3600))
    try store.recordHealthWritten(
      sessionKey(w), .workout(version: ahead, startedAt: 0, endedAt: 1))
    let health = FakeHealth()

    await run(store, health)

    guard case .workout(_, _, _, let version) = await health.saved.first?.object else {
      Issue.record("the workout is saved")
      return
    }
    #expect(version > ahead)
  }

  @Test(arguments: ["removed", "emptied", "reopened"])
  func aSessionNoLongerFinishedIsDeleted(_ how: String) async throws {
    let store = try storeOn()
    let setId = try finished(store, w)
    let health = FakeHealth()
    await run(store, health)

    switch how {
    case "removed": try edit(store, w, at: 40, .removed(true))
    case "emptied":
      try store.recordChanges(
        [.set(SetChange(id: setId, workoutId: w, at: Fixture.time(40), edit: .removed(true)))],
        active: .keep)
    default: try edit(store, w, at: 40, .ended(nil))
    }
    await run(store, health)
    await run(store, health)

    #expect(await health.deleted == [healthSyncId(w, owner: owner)])
    guard case .removed = try store.healthWritten()[sessionKey(w)] else {
      Issue.record("the record says removed")
      return
    }
  }

  @Test func anOverlapIsSkippedAndLookedAtAgainOnlyAfterAChange() async throws {
    let store = try storeOn()
    try finished(store, w, end: 30)
    let health = FakeHealth()
    await health.set(covered: true)

    await run(store, health)
    await run(store, health)

    #expect(await health.saved.isEmpty)
    #expect(await health.looked == 1)
    guard case .skipped = try store.healthWritten()[sessionKey(w)] else {
      Issue.record("the record says skipped")
      return
    }

    await health.set(covered: false)
    try edit(store, w, at: 51, .ended(Fixture.time(50)))
    await run(store, health)

    #expect(await health.looked == 2)
    #expect(await health.saved.count == 1)
  }

  @Test func refusedAccessWritesNothingAndKeepsThePlan() async throws {
    let store = try storeOn()
    try finished(store, w)
    let health = FakeHealth()
    await health.set(access: HealthAccess(available: true, workouts: .denied, effort: .denied))

    await run(store, health)

    #expect(await health.saved.isEmpty)
    #expect(try store.healthWritten().isEmpty)

    await health.set(access: HealthAccess(available: true, workouts: .allowed, effort: .allowed))
    await run(store, health)
    #expect(await health.saved.count == 1)
  }

  @Test func aSaveRefusedMidRunIsLeftForTheNextRun() async throws {
    let store = try storeOn()
    try finished(store, w)
    try finished(store, Fixture.id(40), start: 40, end: 70)
    let health = FakeHealth()
    await health.set(saving: .denied)

    await run(store, health)

    // The first refusal stops the workouts of this run: the second is not even tried.
    #expect(await health.calls == 3)
    #expect(try store.healthWritten().isEmpty)
  }

  @Test func theEffortIsRelatedOnceAsFloorTimesTwoOnlyOnceSettledAndWritten() async throws {
    let store = try storeOn()
    try finished(store, w)
    try store.giveEffort(workoutId: w, floor: 3)
    let health = FakeHealth()

    // Not settled: the workout goes, the effort waits.
    await run(store, health)
    #expect(await health.saved.count == 1)
    #expect(await health.related.isEmpty)

    try store.settleEffort(workoutId: w)
    await run(store, health)
    await run(store, health)

    let related = await health.related
    #expect(related.count == 1)
    #expect(related.first?.score == 6)
    #expect(related.first?.syncId == healthSyncId(w, owner: owner))
    #expect(try store.effort(workoutId: w)?.relatedAt == Instant.string(now))
  }

  /// A workout saved again is a new object in Health, without the effort related to the one it
  /// replaces: the effort goes again, to the new one.
  @Test func aWorkoutSavedAgainGetsItsEffortAgain() async throws {
    let store = try storeOn()
    try finished(store, w)
    try store.giveEffort(workoutId: w, floor: 4)
    try store.settleEffort(workoutId: w)
    let health = FakeHealth()
    await run(store, health)

    try edit(store, w, at: 46, .ended(Fixture.time(45)))
    await run(store, health)
    await run(store, health)

    #expect(await health.saved.count == 2)
    let related = await health.related
    #expect(related.count == 2)
    #expect(related.last?.score == 8)
    #expect(try store.effort(workoutId: w)?.relatedAt != nil)
  }

  @Test func anEffortWithoutAWrittenWorkoutStaysOnThePhone() async throws {
    let store = try storeOn()
    try finished(store, w)
    try store.giveEffort(workoutId: w, floor: 5)
    try store.settleEffort(workoutId: w)
    let health = FakeHealth()
    await health.set(covered: true)

    await run(store, health)

    #expect(await health.related.isEmpty)
    #expect(try store.effort(workoutId: w)?.relatedAt == nil)
  }

  @Test func anEffortRefusedByHealthIsNotRelated() async throws {
    let store = try storeOn()
    try finished(store, w)
    try store.giveEffort(workoutId: w, floor: 2)
    try store.settleEffort(workoutId: w)
    let health = FakeHealth()
    await health.set(access: HealthAccess(available: true, workouts: .allowed, effort: .denied))

    await run(store, health)

    #expect(await health.saved.count == 1)
    #expect(await health.related.isEmpty)
  }

  @Test func healthOffStopsEverythingAndDeletesNothing() async throws {
    let store = try storeOn()
    try finished(store, w)
    let health = FakeHealth()
    await run(store, health)
    let before = await health.calls

    try store.setHealthOn(false, now: now)
    try edit(store, w, at: 40, .removed(true))
    try finished(store, Fixture.id(50), start: 50, end: 80)
    await run(store, health)

    #expect(await health.calls == before)
    #expect(await health.deleted.isEmpty)
    // What was written is kept, so a later turn-on deletes it then.
    guard case .workout = try store.healthWritten()[sessionKey(w)] else {
      Issue.record("the record is kept")
      return
    }
  }

  /// Turned off while Health is writing, or off and on again: the plan of that run was made with
  /// the person's consent of before, so nothing more of it goes, not a write, a deletion or an
  /// effort.
  @Test(arguments: [false, true])
  func turnedOffMidRunNothingMoreGoes(onAgain: Bool) async throws {
    let store = try storeOn()
    let other = Fixture.id(40)
    try finished(store, w)
    try finished(store, other, start: 40, end: 70)
    let health = FakeHealth()
    await run(store, health)
    for id in [w, other] {
      try store.giveEffort(workoutId: id, floor: 3)
      try store.settleEffort(workoutId: id)
    }
    try edit(store, w, at: 46, .ended(Fixture.time(45)))
    try edit(store, other, at: 80, .removed(true))
    let turnOff: @Sendable () throws -> Void = { [store] in
      try store.setHealthOn(false, now: Fixture.t0.addingTimeInterval(100 * 60))
      if onAgain { try store.setHealthOn(true, now: Fixture.t0.addingTimeInterval(101 * 60)) }
    }
    await health.during(save: turnOff)

    await run(store, health)

    #expect(await health.saved.count == 3)
    #expect(await health.deleted.isEmpty)
    #expect(await health.related.isEmpty)
  }

  @Test(arguments: [false, true])
  func turnedOffWhileAnEffortGoesNoOtherEffortGoes(onAgain: Bool) async throws {
    let store = try storeOn()
    let other = Fixture.id(40)
    try finished(store, w)
    try finished(store, other, start: 40, end: 70)
    let health = FakeHealth()
    await run(store, health)
    for id in [w, other] {
      try store.giveEffort(workoutId: id, floor: 3)
      try store.settleEffort(workoutId: id)
    }
    await health.during(relate: { [store] in
      try store.setHealthOn(false, now: Fixture.t0.addingTimeInterval(100 * 60))
      if onAgain { try store.setHealthOn(true, now: Fixture.t0.addingTimeInterval(101 * 60)) }
    })

    await run(store, health)

    #expect(await health.related.count == 1)
  }

  @Test func turningOnAgainStartsFromThatMoment() throws {
    let store = try storeOn(at: 0)
    try store.setHealthOn(false, now: Fixture.t0.addingTimeInterval(60))
    try store.setHealthOn(true, now: Fixture.t0.addingTimeInterval(120))
    #expect(
      try store.healthSettings().turnedOnAt
        == Instant.milliseconds(Fixture.t0.addingTimeInterval(120)))
  }

  @Test func healthUnavailableDoesNothing() async throws {
    let store = try storeOn()
    try finished(store, w)
    let health = FakeHealth()
    await health.set(
      access: HealthAccess(available: false, workouts: .undetermined, effort: .undetermined))

    await run(store, health)

    #expect(await health.calls == 1)
    #expect(try store.healthWritten().isEmpty)
  }

  /// The one request made at turn-on: workouts and their effort to write, workouts to read for
  /// the overlap check. A request naming fewer types to write takes back the right to write them.
  @Test func theRequestNamesWorkoutAndEffortToShareAndWorkoutToRead() {
    #expect(HealthAccessRequest.share == [.workouts, .effort])
    #expect(HealthAccessRequest.read == [.workouts])
  }

  @Test func v3OpensOnAFileTheV2SchemaMade() throws {
    let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let origin = URL(string: "https://belay.example")!
    let url = AccountStore.fileURL(userId: userId, origin: origin, in: folder)
    do {
      let old = try DatabasePool(path: url.path)
      try Schema.migrator.migrate(old, upTo: "v2")
      try old.write { db in
        try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('cursor', '7')")
        try db.execute(
          sql: "INSERT INTO efforts (workoutId, row) VALUES (?, ?)",
          arguments: [
            w,
            try Rows.encode(SessionEffort(workoutId: w, floor: 4, settled: true, relatedAt: nil)),
          ])
      }
      try old.close()
    }
    let store = try AccountStore.open(userId: userId, origin: origin, in: folder)
    #expect(try store.cursor() == "7")
    #expect(try store.effort(workoutId: w)?.floor == 4)
    #expect(try store.healthSettings() == HealthSettings(on: false, turnedOnAt: nil))
    try store.recordHealthWritten(sessionKey(w), .removed(version: 3))
    #expect(try store.healthWritten() == [sessionKey(w): .removed(version: 3)])
  }

  @Test func anUnknownWrittenStateIsRefused() {
    let json = Data(#"{"state":"lost","version":1}"#.utf8)
    #expect(throws: DecodingError.self) { try Rows.decode(HealthWritten.self, json) }
  }
}
