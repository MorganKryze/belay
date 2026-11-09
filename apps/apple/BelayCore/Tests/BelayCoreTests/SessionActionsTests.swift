import Foundation
import GRDB
import Testing

@testable import BelayCore

// Every session action is one write that reads the session as stored at that moment: two taps
// for one set leave one set, a sync landing in between is seen, and what stays on this device is
// never queued.

/// A clock the tests move by hand.
final class TestClock: @unchecked Sendable {
  private let lock = NSLock()
  private var date: Date

  init(_ date: Date) { self.date = date }

  var now: Date { lock.withLock { date } }

  func advance(seconds: TimeInterval) { lock.withLock { date += seconds } }
}

/// A session open on an in-memory store, with a clock the tests move.
struct Seance {
  static let squat = "belay:back-squat"
  static let bench = "ds:0025"
  static let curl = "ds:curl"
  static let hang = "belay:dead-hang"

  static let library: ExerciseLibrary = {
    let index = Data(
      #"""
      [["belay:back-squat","Back squat",[],[],"barbell",2.5,"reps"],
       ["ds:0025","Barbell bench press",[],[],"barbell",2.5,"reps"],
       ["ds:curl","Curl",[],[],"dumbbell",2,"reps"],
       ["belay:dead-hang","Dead hang",[],[],"bodyweight",2.5,"seconds"]]
      """#.utf8)
    // The index above is written by hand and reads.
    return try! ExerciseLibrary(indexJSON: index)
  }()

  static func slot(
    _ exerciseId: String = squat, sets: Int = 3, warmups: Int = 0, rest: Int = 120,
    group: String? = nil
  ) -> Slot {
    let timed = exerciseId == hang
    return Slot(
      exerciseId: exerciseId, sets: sets, repRange: timed ? [30, 60] : [8, 12],
      rirTarget: [1, 2], restSec: rest, warmupSets: warmups, isMain: true, groupKey: group,
      measure: timed ? .seconds : nil)
  }

  let store: AccountStore
  let clock = TestClock(Fixture.t0)
  let actions: SessionActions
  let workoutId: String

  init(_ plan: [Slot] = [slot()], store: AccountStore? = nil, past: [(String, Double, Int)] = [])
    throws
  {
    self.store = try store ?? AccountStore.inMemory(userId: "u1")
    for (i, (exerciseId, kg, count)) in past.enumerated() {
      try Self.finished(self.store, exerciseId: exerciseId, kg: kg, count: count, daysAgo: i + 1)
    }
    let clock = clock
    actions = SessionActions(
      store: self.store, library: Self.library, now: { clock.now },
      newId: { UUIDv7.make(at: $0) })
    workoutId = Fixture.id()
    _ = try self.store.startWorkout(
      WorkoutStart(
        id: workoutId, at: Fixture.time(0),
        start: .init(
          sessionCode: "A", sessionId: .absent, sessionName: .absent, plan: plan,
          startedAt: Fixture.time(0))),
      now: Fixture.t0)
  }

  /// A finished session `daysAgo` days back holding one work set of `exerciseId`.
  static func finished(
    _ store: AccountStore, exerciseId: String, kg: Double, count: Int, daysAgo: Int
  ) throws {
    let minutes = Double(-daysAgo * 24 * 60)
    let id = Fixture.id(minutes)
    let timed = exerciseId == hang
    let start = WorkoutStart(
      id: id, at: Fixture.time(minutes),
      start: .init(
        sessionCode: "A", sessionId: .absent, sessionName: .absent,
        plan: [slot(exerciseId)], startedAt: Fixture.time(minutes)))
    let set = SetChange(
      id: Fixture.id(minutes + 1), workoutId: id, at: Fixture.time(minutes + 1),
      edit: .create(
        .init(
          slotIndex: 0, position: 3, exerciseId: exerciseId, warmup: false,
          values: SetValues(
            weightKg: kg, reps: timed ? nil : count, seconds: timed ? .value(count) : .null,
            rir: nil),
          doneAt: Fixture.time(minutes + 1))))
    try store.recordChanges(
      [
        .workout(start.change), .set(set),
        .workout(
          WorkoutChange(
            id: id, at: Fixture.time(minutes + 2), edit: .ended(Fixture.time(minutes + 2)))),
      ], active: .keep)
  }

  var workout: WorkoutRow {
    get throws { try #require(try store.history().workouts.first { $0.id == workoutId }) }
  }

  var sets: [SetRow] {
    get throws { try store.history().sets.filter { $0.workoutId == workoutId && !$0.removed } }
  }

  var active: ActiveSession? { get throws { try store.activeSession() } }

  var queued: Int { get throws { try store.outbox(limit: nil).count } }

  var lastChange: Change? { get throws { try store.outbox(limit: nil).last?.change } }

  func state(_ marks: SessionMarks = SessionMarks()) throws -> SessionState {
    sessionState(
      history: try store.history(), active: try #require(try active), now: clock.now,
      library: Self.library, bar: .gym, marks: marks)
  }

  /// A set as another device's sync lands it.
  func landed(slotIndex: Int = 0, position: Int, kg: Double = 60, reps: Int = 8) throws -> String {
    let id = UUIDv7.make(at: clock.now)
    let doneAt = Instant.string(clock.now)
    let change = SetChange(
      id: id, workoutId: workoutId, at: doneAt,
      edit: .create(
        .init(
          slotIndex: slotIndex, position: position, exerciseId: Self.squat, warmup: false,
          values: SetValues(weightKg: kg, reps: reps, seconds: .null, rir: nil), doneAt: doneAt)))
    try store.recordChanges([.set(change)], active: .keep)
    return id
  }
}

@Suite struct SessionActionsTests {
  @Test func logNextTwiceLeavesOneSet() throws {
    let s = try Seance()
    let place = SetPlace(slotIndex: 0, position: 3)
    let first = try #require(try s.actions.logNext(count: 8, weightKg: 60, expecting: place))
    let second = try #require(try s.actions.logNext(count: 7, weightKg: nil, expecting: place))
    guard case .create = first.edit, case .values(let values) = second.edit else {
      Issue.record("a creation, then a correction")
      return
    }
    #expect(second.id == first.id)
    #expect(values.reps == 7)
    #expect(try s.sets.count == 1)

    // Two taps at once, from the screen and the lock screen: still one set.
    let t = try Seance()
    DispatchQueue.concurrentPerform(iterations: 2) { _ in
      _ = try? t.actions.logNext(count: 8, weightKg: 60, expecting: place)
    }
    #expect(try t.sets.count == 1)
  }

  @Test func logNextTakesWarmupsFirst() throws {
    let s = try Seance([Seance.slot(warmups: 2)], past: [(Seance.squat, 100, 8)])
    for _ in 0..<3 { try s.actions.logNext(count: nil, weightKg: nil, expecting: nil) }
    let logged = try s.sets.sorted { $0.position < $1.position }
    #expect(logged.map(\.position) == [0, 1, 3])
    #expect(logged.map(\.warmup) == [true, true, false])
    #expect(logged.map(\.weightKg) == [50, 75, 100])
    #expect(logged.map(\.reps) == [5, 3, 8])
  }

  @Test func warmupStartsNoRest() throws {
    let s = try Seance(
      [Seance.slot(sets: 1), Seance.slot(Seance.bench, warmups: 1)],
      past: [(Seance.bench, 80, 8)])
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    let rest = try #require(try s.active?.restEndsAt)
    s.clock.advance(seconds: 10)
    let warmup = try #require(try s.actions.logNext(count: nil, weightKg: nil, expecting: nil))
    guard case .create(let create) = warmup.edit else {
      Issue.record("a creation")
      return
    }
    #expect(create.warmup)
    #expect(create.values.rir == nil)
    #expect(try s.active?.restEndsAt == rest)
  }

  @Test func answerRIRTargetsItsSet() throws {
    let s = try Seance()
    let mine = try #require(try s.actions.logNext(count: 8, weightKg: 60, expecting: nil))
    s.clock.advance(seconds: 5)
    let theirs = try s.landed(position: 4)
    try s.actions.answerRIR(setId: mine.id, rir: 2)
    let sets = try s.sets
    #expect(sets.first { $0.id == mine.id }?.rir == 2)
    #expect(sets.first { $0.id == theirs }?.rir == nil)
    guard case .set(let change) = try s.lastChange, case .values(let v) = change.edit else {
      Issue.record("a values change")
      return
    }
    #expect(change.id == mine.id && v.rir == 2)
  }

  @Test func correctWritesOneValuesChange() throws {
    let s = try Seance()
    let set = try #require(try s.actions.logNext(count: 8, weightKg: 60, expecting: nil))
    let before = try s.queued
    try s.actions.correct(setId: set.id, weightKg: 62.5, count: 9, rir: 1)
    #expect(try s.queued == before + 1)
    #expect(
      try s.lastChange
        == .set(
          SetChange(
            id: set.id, workoutId: s.workoutId, at: Fixture.time(0),
            edit: .values(SetValues(weightKg: 62.5, reps: 9, seconds: .null, rir: 1)))))
  }

  @Test func removeReopensTheTurn() throws {
    let s = try Seance()
    let set = try #require(try s.actions.logNext(count: 8, weightKg: 60, expecting: nil))
    try s.actions.skipRest()
    try s.actions.remove(setId: set.id)
    #expect(try s.sets.isEmpty)
    guard case .due(let due) = try s.state().phase else {
      Issue.record("the set is due again")
      return
    }
    #expect(due.place == SetPlace(slotIndex: 0, position: 3))
  }

  @Test func leaveOutNextMovesOpenSession() throws {
    let s = try Seance([Seance.slot(), Seance.slot(Seance.bench)])
    let before = try s.queued
    try s.actions.leaveOut(slotIndex: 0, true)
    #expect(try s.active?.slotIndex == 1)
    #expect(try s.workout.plan[0].skipped == true)
    #expect(try s.queued == before + 1)
    try s.actions.leaveOut(slotIndex: 0, false)
    #expect(try s.workout.plan[0].skipped == false)
    #expect(try s.active?.slotIndex == 0)
  }

  @Test func appendRefusedAtThirty() throws {
    let s = try Seance(Array(repeating: Seance.slot(sets: 1), count: Bounds.maxSlots))
    #expect(throws: PlanError.full) { try s.actions.addExercise(Seance.curl) }
    #expect(try s.workout.plan.count == Bounds.maxSlots)
  }

  @Test func addSetPastPlanUpTo49() throws {
    let s = try Seance([Seance.slot(sets: 1)])
    try s.actions.addSet(slotIndex: 0)
    #expect(try s.active?.added == SetPlace(slotIndex: 0, position: 4))
    try s.actions.logNext(count: nil, weightKg: nil, expecting: nil)
    try s.actions.logNext(count: nil, weightKg: nil, expecting: nil)
    #expect(try s.sets.map(\.position).sorted() == [3, 4])
    // Kept out of the planned count.
    #expect(sessionProgress(try s.workout.plan, sets: try s.sets).left == 0)

    for _ in 5...Bounds.maxPosition { try s.actions.addSet(slotIndex: 0) }
    #expect(try s.active?.added?.position == Bounds.maxPosition)
    #expect(throws: SessionError.noPositionLeft) { try s.actions.addSet(slotIndex: 0) }
  }

  @Test func addSetTwiceAddsTwo() throws {
    let s = try Seance([Seance.slot(sets: 1)])
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    try s.actions.addSet(slotIndex: 0)
    try s.actions.addSet(slotIndex: 0)
    #expect(try s.actions.logNext(count: 8, weightKg: 60, expecting: nil) != nil)
    #expect(try s.actions.logNext(count: 8, weightKg: 60, expecting: nil) != nil)
    #expect(try s.sets.map(\.position).sorted() == [3, 4, 5])
    #expect(try s.actions.logNext(count: 8, weightKg: 60, expecting: nil) == nil)
    s.clock.advance(seconds: 600)
    #expect(try s.state().bars == [.done, .done, .done])
  }

  @Test func addSetKeepsTheLoadChosen() throws {
    let s = try Seance([Seance.slot(sets: 1)])
    try s.actions.choose(weightKg: 70, count: 10)
    try s.actions.addSet(slotIndex: 0)
    #expect(try s.active?.draft == SetDraft(slotIndex: 0, position: 3, weightKg: 70, count: 10))
    // The set added is due first; the planned set keeps what was chosen for it.
    try s.actions.logNext(count: 8, weightKg: 60, expecting: SetPlace(slotIndex: 0, position: 4))
    let set = try #require(try s.actions.logNext(count: nil, weightKg: nil, expecting: nil))
    guard case .create(let create) = set.edit else {
      Issue.record("a creation")
      return
    }
    #expect(create.position == 3)
    #expect(create.values.weightKg == 70 && create.values.reps == 10)
  }

  @Test func planEditsComposeInOrder() throws {
    let s = try Seance([Seance.slot(), Seance.slot(Seance.bench)])
    try s.actions.replace(slotIndex: 0, with: Seance.hang)
    try s.actions.leaveOut(slotIndex: 1, true)
    try s.actions.addExercise(Seance.curl)
    let plan = try s.workout.plan
    #expect(plan.map(\.exerciseId) == [Seance.hang, Seance.bench, Seance.curl])
    #expect(plan[0].measure == .seconds && plan[0].repRange == [30, 60])
    #expect(plan[1].skipped == true)
    #expect(plan[2].added == true)
  }

  @Test func planNeverShrinks() throws {
    let s = try Seance([Seance.slot(), Seance.slot(Seance.bench)])
    try s.actions.leaveOut(slotIndex: 0, true)
    try s.actions.replace(slotIndex: 1, with: Seance.curl)
    #expect(try s.workout.plan.count == 2)
    // A plan edit carries the whole plan; none is ever shorter than the one stored.
    for entry in try s.store.outbox(limit: nil) {
      if case .workout(let c) = entry.change, case .plan(let plan) = c.edit {
        #expect(plan.count == 2)
      }
    }
  }

  @Test func noteEmptiedLeavesOthers() throws {
    let s = try Seance([Seance.slot(), Seance.slot(Seance.bench)])
    try s.actions.noteExercise(slotIndex: 0, text: "genoux")
    try s.actions.noteExercise(slotIndex: 1, text: "prise large")
    try s.actions.noteExercise(slotIndex: 0, text: "  ")
    #expect(try s.workout.exerciseNotes == ["1": "prise large"])
  }

  @Test func sessionNoteKeptAndCleared() throws {
    let s = try Seance()
    try s.actions.noteSession(workoutId: s.workoutId, text: "Bonne séance")
    #expect(try s.workout.note == "Bonne séance")
    try s.actions.noteSession(workoutId: s.workoutId, text: " ")
    #expect(try s.workout.note == nil)
  }

  @Test func pauseKeepsOnDevice() throws {
    let s = try Seance()
    let before = try s.queued
    s.clock.advance(seconds: 60)
    try s.actions.pause()
    #expect(try s.active?.pausedAt == Fixture.time(1))
    #expect(try s.queued == before)
  }

  @Test func tickAfterPauseKeepsPausedAt() throws {
    let s = try Seance()
    s.clock.advance(seconds: 60)
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    s.clock.advance(seconds: 30)
    try s.actions.pause()
    // The cover's tick only reads; the writes it can make while paused leave the pause in place.
    s.clock.advance(seconds: 300)
    let frozen = try s.state()
    try s.actions.choose(weightKg: 62.5, count: nil)
    _ = try s.actions.addRest(seconds: 30)
    s.clock.advance(seconds: 300)
    #expect(try s.active?.pausedAt == Fixture.time(1.5))
    let later = try s.state()
    #expect(later.paused)
    #expect(later.elapsedMs == frozen.elapsedMs)
  }

  @Test func resumeMovesStartAndRestInOneWrite() throws {
    let s = try Seance()
    s.clock.advance(seconds: 60)
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    #expect(try s.active?.restEndsAt == Fixture.time(3))
    s.clock.advance(seconds: 60)
    try s.actions.pause()
    s.clock.advance(seconds: 300)
    let before = try s.queued

    // A failed write leaves the pause, the start and the rest as they were.
    try Fixture.refuseInserts(into: "outbox", in: s.store)
    #expect(throws: (any Error).self) { try s.actions.resume() }
    #expect(try s.active?.pausedAt == Fixture.time(2))
    #expect(try s.active?.restEndsAt == Fixture.time(3))
    #expect(try s.workout.startedAt == Fixture.time(0))
    try s.store.writer.write { try $0.execute(sql: "DROP TRIGGER refuse_outbox") }

    try s.actions.resume()
    #expect(try s.workout.startedAt == Fixture.time(5))
    #expect(try s.active?.restEndsAt == Fixture.time(8))
    #expect(try s.active?.pausedAt == nil)
    #expect(try s.queued == before + 1)
  }

  @Test func pauseEndedBySet() throws {
    let s = try Seance()
    s.clock.advance(seconds: 120)
    try s.actions.pause()
    s.clock.advance(seconds: 120)
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    #expect(try s.active?.pausedAt == nil)
    #expect(try s.workout.startedAt == Fixture.time(2))
  }

  @Test func pauseEndedBySyncedSet() throws {
    let s = try Seance()
    s.clock.advance(seconds: 600)
    try s.actions.pause()
    s.clock.advance(seconds: 600)
    _ = try s.landed(position: 3)
    s.clock.advance(seconds: 60)
    // The cover reads the pause as over at the set's time, before any write here.
    let state = try s.state()
    #expect(!state.paused)
    #expect(state.elapsedMs == 660_000)
    // The next write settles it there: the start leaves out only the ten minutes paused.
    try s.actions.resume()
    #expect(try s.workout.startedAt == Fixture.time(10))
    #expect(try s.active?.pausedAt == nil)
  }

  @Test func finishAfterSyncedSetsKeepsTheirTime() throws {
    let s = try Seance()
    s.clock.advance(seconds: 600)
    try s.actions.pause()
    s.clock.advance(seconds: 600)
    _ = try s.landed(position: 3)
    s.clock.advance(seconds: 1200)
    _ = try s.landed(position: 4)
    #expect(try s.actions.finish() == s.workoutId)
    let w = try s.workout
    #expect(w.startedAt == Fixture.time(10))
    #expect(summary(w, sets: try s.sets, history: try s.store.history()).durationMs == 1_800_000)
  }

  @Test func finishWhilePausedLeavesPauseOut() throws {
    let s = try Seance()
    s.clock.advance(seconds: 600)
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    try s.actions.pause()
    s.clock.advance(seconds: 1200)
    #expect(try s.actions.finish() == s.workoutId)
    let w = try s.workout
    #expect(w.endedAt == Fixture.time(30))
    #expect(summary(w, sets: try s.sets, history: try s.store.history()).durationMs == 600_000)
    #expect(try s.active == nil)
  }

  @Test func holdStopsAtHeldSeconds() throws {
    let s = try Seance([Seance.slot(Seance.hang)])
    try s.actions.startHold()
    #expect(try s.active?.chrono?.seconds == 30)
    s.clock.advance(seconds: 12)
    try s.actions.stopHold()
    #expect(try s.active?.chrono?.seconds == 12)
    let set = try #require(try s.actions.logNext(count: nil, weightKg: nil, expecting: nil))
    guard case .create(let create) = set.edit else {
      Issue.record("a creation")
      return
    }
    #expect(create.values.seconds == .value(12) && create.values.reps == nil)
    #expect(try s.active?.chrono == nil)
  }

  @Test func holdNeverLogsItself() throws {
    let s = try Seance([Seance.slot(Seance.hang)])
    try s.actions.startHold()
    s.clock.advance(seconds: 90)
    #expect(try s.sets.isEmpty)
    guard case .held(let held) = try s.state().phase else {
      Issue.record("held, waiting for ✓")
      return
    }
    #expect(held.seconds == 30)
  }

  @Test func draftSurvivesReopen() throws {
    let folder = try Fixture.folder()
    let origin = try #require(URL(string: "https://belay.example"))
    let s = try Seance(store: try AccountStore.open(userId: "u1", origin: origin, in: folder))
    try s.actions.choose(weightKg: 62.5, count: 10)
    try s.actions.pause()
    let before = try #require(try s.active)

    let reopened = try AccountStore.open(userId: "u1", origin: origin, in: folder)
    let after = try #require(try reopened.activeSession())
    #expect(after == before)
    #expect(after.draft == SetDraft(slotIndex: 0, position: 3, weightKg: 62.5, count: 10))
    #expect(after.pausedAt != nil)

    // A record written before these fields existed reads them as absent.
    try reopened.writer.write { db in
      try db.execute(
        sql: "UPDATE activeSession SET row = ?",
        arguments: [Data(#"{"workoutId":"\#(s.workoutId)","slotIndex":0}"#.utf8)])
    }
    #expect(
      try reopened.activeSession()
        == ActiveSession(workoutId: s.workoutId, slotIndex: 0, restEndsAt: nil))
  }

  @Test func stopEmptyRefusedWhenASetArrived() throws {
    let s = try Seance()
    _ = try s.landed(position: 3)
    #expect(throws: SessionError.notEmpty) { try s.actions.stopEmpty() }
    #expect(try s.workout.removed == false)
    #expect(try s.active != nil)
  }

  @Test func stopEmptyRemovesTheSession() throws {
    let s = try Seance()
    try s.actions.stopEmpty()
    #expect(try s.workout.removed)
    #expect(try s.active == nil)
  }

  @Test func nothingIsQueuedForDeviceState() throws {
    let s = try Seance([Seance.slot(), Seance.slot(Seance.hang)])
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    let before = try s.queued
    try s.actions.choose(weightKg: 65, count: 9)
    #expect(try s.actions.addRest(seconds: 30))
    try s.actions.skipRest()
    try s.actions.addSet(slotIndex: 0)
    try s.actions.pause()
    #expect(try s.queued == before)
  }
}
