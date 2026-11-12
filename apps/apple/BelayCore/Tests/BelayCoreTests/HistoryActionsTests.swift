import Foundation
import GRDB
import Testing

@testable import BelayCore

// What the Séances tab writes outside a session: the active program chosen, a past session
// deleted, a past set corrected or removed. Each is one write with its queued change, and works
// with no network.

@Suite struct HistoryActionsTests {
  let store: AccountStore
  let actions: HistoryActions
  /// A finished session, ended at minute 30, with two work sets.
  let done = Fixture.id(0)
  let first: String
  let second: String
  /// A second live program beside the starting one.
  let other = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f03"
  let seed = Seed.programs.activeId!
  /// The clock of the actions, an hour after the session ended.
  static let now = Fixture.t0.addingTimeInterval(90 * 60)

  init() throws {
    store = try AccountStore.inMemory(userId: "u1")
    actions = HistoryActions(store: store, now: { Self.now })
    _ = try store.startWorkout(Fixture.start(done), now: Fixture.t0)
    first = try store.recordSet(
      Fixture.set(done, position: 3, at: 1), at: Fixture.time(1), active: Fixture.active(done)
    ).id
    second = try store.recordSet(
      Fixture.set(done, position: 4, at: 3), at: Fixture.time(3), active: Fixture.active(done)
    ).id
    try store.recordChanges(
      [.workout(WorkoutChange(id: done, at: Fixture.time(30), edit: .ended(Fixture.time(30))))],
      active: .clear)
    try store.applyServer(
      sent: [], response: Fixture.response(programs: [program(other), program(seed)]))
    try store.applyServer(sent: try store.outbox(limit: nil), response: Fixture.response())
  }

  private func program(_ id: String, removed: Bool = false) -> ProgramRow {
    ProgramRow(
      id: id, name: "P \(id.suffix(2))", nameAt: nil,
      schedule: Seed.programs.programs[0].schedule, scheduleAt: nil, removed: removed,
      removedAt: nil)
  }

  private func queued() throws -> [Change] { try store.outbox(limit: nil).map(\.change) }

  private func pointer() throws -> ActiveProgramRow? {
    try store.writer.read { try Rows.single(ActiveProgramRow.self, $0, "activeProgram") }
  }

  /// A trigger that fails every insert into `table`, as a full disk would.
  private func failInserts(into table: String) throws {
    try store.writer.write { db in
      try db.execute(
        sql: """
          CREATE TEMP TRIGGER fail_\(table) BEFORE INSERT ON \(table)
          BEGIN SELECT RAISE(ABORT, 'disk full'); END
          """)
    }
  }

  // MARK: The active program

  /// Either half failing takes the other with it: the screen never shows a choice that is not
  /// queued, nor queues one it does not show. Once the disk is back, both are written.
  @Test(arguments: ["outbox", "activeProgram"])
  func chooseProgramWritesRowAndQueueTogether(_ failing: String) throws {
    try failInserts(into: failing)

    #expect(throws: (any Error).self) { try actions.chooseProgram(other) }
    #expect(try pointer() == nil)
    #expect(try store.programs().activeId == seed)
    #expect(try queued().isEmpty)

    try store.writer.write { try $0.execute(sql: "DROP TRIGGER fail_\(failing)") }
    try actions.chooseProgram(other)

    let at = Instant.string(Self.now)
    #expect(try pointer() == ActiveProgramRow(programId: other, at: at))
    #expect(try store.programs().activeId == other)
    #expect(try queued() == [.activeProgram(ActiveProgramChange(programId: other, at: at))])
    #expect(
      try store.outbox(limit: nil).map { String(decoding: $0.bytes, as: UTF8.self) }
        == [#"{"kind":"activeProgram","programId":"\#(other)","at":"\#(at)"}"#])
  }

  @Test func chooseRemovedProgramRefused() throws {
    try store.applyServer(
      sent: [], response: Fixture.response(programs: [program(other, removed: true)]))

    #expect(throws: HistoryError.notLive) { try actions.chooseProgram(other) }
    #expect(throws: HistoryError.notLive) {
      try actions.chooseProgram("019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1fff")
    }
    #expect(try pointer() == nil)
    #expect(try queued().isEmpty)
  }

  /// A second tap on the active program moves nothing: a new time would restart the rotation's
  /// count for sessions recorded by letter.
  @Test func choosingTheActiveProgramAgainWritesNothing() throws {
    try actions.chooseProgram(other)
    try actions.chooseProgram(other)
    try actions.chooseProgram(other)

    #expect(try queued().count == 1)
  }

  @Test func newerServerRowWins() throws {
    try actions.chooseProgram(other)
    let mine = Instant.string(Self.now)
    // Another device chose the starting program a second later.
    let later = Instant.string(Self.now.addingTimeInterval(1))
    try store.applyServer(
      sent: [],
      response: Fixture.response(activeProgram: ActiveProgramRow(programId: seed, at: later)))

    #expect(try pointer() == ActiveProgramRow(programId: seed, at: later))
    #expect(try store.programs().activeId == seed)

    // An older one does not take this phone's choice back while it waits in the queue.
    let earlier = Instant.string(Self.now.addingTimeInterval(-1))
    let again = try AccountStore.inMemory(userId: "u2")
    try again.applyServer(sent: [], response: Fixture.response(programs: [program(other)]))
    try HistoryActions(store: again, now: { Self.now }).chooseProgram(other)
    try again.applyServer(
      sent: [],
      response: Fixture.response(activeProgram: ActiveProgramRow(programId: seed, at: earlier)))
    #expect(try again.programs().activeId == other)
    #expect(try again.programs().activeAt == mine)
  }

  // MARK: A past session

  @Test func removeSessionQueuedOnce() throws {
    try actions.removeSession(workoutId: done)
    try actions.removeSession(workoutId: done)

    let at = Instant.string(Self.now)
    #expect(try queued() == [.workout(WorkoutChange(id: done, at: at, edit: .removed(true)))])
    let row = try #require(try store.history().workouts.first { $0.id == done })
    #expect(row.removed && row.removedAt == at)
  }

  @Test func removeOpenSessionRefused() throws {
    let open = Fixture.id(60)
    _ = try store.startWorkout(
      Fixture.start(open, at: 60), now: Fixture.t0.addingTimeInterval(3600))
    let before = try queued()

    #expect(throws: HistoryError.sessionOpen) { try actions.removeSession(workoutId: open) }
    #expect(throws: HistoryError.noSuchSession) {
      try actions.removeSession(workoutId: Fixture.id(200))
    }
    #expect(try queued() == before)
    #expect(try store.history().workouts.allSatisfy { !$0.removed })
  }

  @Test func correctPastSetOneValuesChange() throws {
    try actions.correct(setId: first, weightKg: 62.5, count: 7, rir: 1)

    let at = Instant.string(Self.now)
    let values = SetValues(weightKg: 62.5, reps: 7, seconds: .null, rir: 1)
    #expect(
      try queued()
        == [.set(SetChange(id: first, workoutId: done, at: at, edit: .values(values)))])
    let sets = try store.history().sets
    let corrected = try #require(sets.first { $0.id == first })
    #expect(corrected.weightKg == 62.5 && corrected.reps == 7 && corrected.rir == 1)
    #expect(corrected.fieldsAt == at)
    let untouched = try #require(sets.first { $0.id == second })
    #expect(untouched.weightKg == 60 && untouched.reps == 8 && untouched.rir == 2)
  }

  /// A sheet saved unchanged, on a phone that has not pulled another device's correction yet,
  /// writes nothing: a change stamped now would undo that correction on the server.
  @Test func correctWithTheStoredValuesWritesNothing() throws {
    let stored = try #require(try store.history().sets.first { $0.id == first })

    try actions.correct(
      setId: first, weightKg: stored.weightKg, count: try #require(stored.reps), rir: stored.rir)

    #expect(try queued().isEmpty)
    #expect(try store.history().sets.first { $0.id == first } == stored)
  }

  @Test func removePastSetLeavesOthers() throws {
    try actions.remove(setId: first)

    let at = Instant.string(Self.now)
    #expect(
      try queued() == [.set(SetChange(id: first, workoutId: done, at: at, edit: .removed(true)))])
    let sets = try store.history().sets
    #expect(sets.first { $0.id == first }?.removed == true)
    #expect(sets.first { $0.id == second }?.removed == false)
    #expect(try store.history().workouts.first { $0.id == done }?.removed == false)
  }

  /// A set of the session still open is the session screen's to change, never the history's.
  @Test func aSetOfTheOpenSessionIsRefused() throws {
    let open = Fixture.id(60)
    _ = try store.startWorkout(
      Fixture.start(open, at: 60), now: Fixture.t0.addingTimeInterval(3600))
    let set = try store.recordSet(
      Fixture.set(open, at: 61), at: Fixture.time(61), active: Fixture.active(open))
    let before = try queued()

    #expect(throws: HistoryError.noSuchSet) {
      try actions.correct(setId: set.id, weightKg: 70, count: 5, rir: 1)
    }
    #expect(throws: HistoryError.noSuchSet) { try actions.remove(setId: set.id) }
    #expect(throws: HistoryError.noSuchSet) { try actions.remove(setId: Fixture.id(300)) }
    #expect(try queued() == before)
  }

  /// A session ended at minute 50 with a warm-up and a timed set; the device still holds it
  /// open when `held`, as right after its end before the summary is left.
  private func warmupAndTimed(held: Bool = false) throws -> (session: String, warmup: String, timed: String) {
    let session = Fixture.id(40)
    _ = try store.startWorkout(Fixture.start(session, at: 40), now: Fixture.t0.addingTimeInterval(40 * 60))
    let warmup = try store.recordSet(
      SetInput(
        id: Fixture.id(41), workoutId: session, slotIndex: 0, position: 0,
        exerciseId: Fixture.slot.exerciseId, warmup: true,
        values: SetValues(weightKg: 40, reps: 8, seconds: .null, rir: nil), doneAt: Fixture.time(41)),
      at: Fixture.time(41), active: Fixture.active(session)
    ).id
    let timed = try store.recordSet(
      SetInput(
        id: Fixture.id(42), workoutId: session, slotIndex: 1, position: 3,
        exerciseId: Fixture.slot.exerciseId, warmup: false,
        values: SetValues(weightKg: 0, reps: nil, seconds: .value(30), rir: nil),
        doneAt: Fixture.time(42)),
      at: Fixture.time(42), active: Fixture.active(session)
    ).id
    try store.recordChanges(
      [.workout(WorkoutChange(id: session, at: Fixture.time(50), edit: .ended(Fixture.time(50))))],
      active: held ? .keep : .clear)
    // Sent, so a test reads only its own changes; a pull would close the session held open.
    if !held { try store.applyServer(sent: try store.outbox(limit: nil), response: Fixture.response()) }
    return (session, warmup, timed)
  }

  /// A warm-up keeps no RIR; a timed set takes the count as its seconds and keeps no RIR.
  @Test func correctPastWarmupAndTimedSet() throws {
    let (_, warmup, timed) = try warmupAndTimed()

    try actions.correct(setId: warmup, weightKg: 42.5, count: 6, rir: 2)
    try actions.correct(setId: timed, weightKg: 10, count: 45, rir: 1)

    let sets = try store.history().sets
    let w = try #require(sets.first { $0.id == warmup })
    #expect(w.weightKg == 42.5 && w.reps == 6 && w.rir == nil && w.seconds == nil)
    let t = try #require(sets.first { $0.id == timed })
    #expect(t.weightKg == 10 && t.seconds == 45 && t.reps == nil && t.rir == nil)
    #expect(try queued().count == 2)
  }

  /// A timed set saved as it is queues nothing, whatever reserve the sheet still holds.
  @Test func unchangedTimedSetWritesNothing() throws {
    let (_, _, timed) = try warmupAndTimed()

    try actions.correct(setId: timed, weightKg: 0, count: 30, rir: 2)

    #expect(try queued().isEmpty)
  }

  /// Once its session is deleted, a set is no longer the history's to change.
  @Test func aSetOfARemovedSessionIsRefused() throws {
    try actions.removeSession(workoutId: done)
    let before = try queued()

    #expect(throws: HistoryError.noSuchSet) {
      try actions.correct(setId: first, weightKg: 70, count: 5, rir: 1)
    }
    #expect(throws: HistoryError.noSuchSet) { try actions.remove(setId: second) }
    #expect(try queued() == before)
  }

  /// A session ended but still the one this device holds open stays the session screen's: it
  /// cannot be deleted, nor its sets changed, from the history.
  @Test func theActiveWorkoutIsRefused() throws {
    let (session, warmup, _) = try warmupAndTimed(held: true)
    let before = try queued()

    #expect(throws: HistoryError.sessionOpen) { try actions.removeSession(workoutId: session) }
    #expect(throws: HistoryError.noSuchSet) { try actions.remove(setId: warmup) }
    #expect(try queued() == before)
    #expect(try store.history().workouts.first { $0.id == session }?.removed == false)
  }

  // MARK: Offline

  @Test func offlineWritesSentOnce() async throws {
    // The first try finds no network; the next ones reach the server.
    let transport = ScriptedTransport { _, i in i == 0 ? .offline : Fixture.ok(cursor: "c\(i)") }
    let engine = SyncEngine(
      userId: "u1", store: store, transport: transport, onLanded: {})

    try actions.chooseProgram(other)
    try actions.correct(setId: first, weightKg: 62.5, count: 7, rir: 1)
    try actions.remove(setId: second)
    try actions.removeSession(workoutId: done)
    let written = try store.outbox(limit: nil).map { RawChange(bytes: $0.bytes) }
    #expect(written.count == 4)

    await engine.sync()
    #expect(try store.outbox(limit: nil).count == 4)
    await engine.sync()
    await engine.sync()

    let requests = await transport.requests
    let sent = requests.dropFirst().flatMap(\.changes)
    #expect(sent == written)
    #expect(try store.outbox(limit: nil).isEmpty)
    #expect(try store.programs().activeId == other)
    #expect(try store.history().workouts.first { $0.id == done }?.removed == true)
  }
}
