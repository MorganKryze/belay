import Foundation
import GRDB

// The session's actions as writes. Each one is a single transaction that reads the open session,
// its sets and this device's record of it, decides, and writes the changes with their queue entry
// and the record: a sync or a lock-screen tap landing in between is always seen, never overwritten.

/// Why a session action wrote nothing.
public enum SessionError: Error, Sendable, Equatable {
  /// No session is open on this device.
  case noSession
  /// A set is stored: the session cannot be dropped as empty.
  case notEmpty
  /// The set is not one of the open session's live sets, or not one this action applies to.
  case noSuchSet
  case unknownExercise
  /// The slot is not in the plan.
  case noSuchSlot
  /// The slot already reaches the last position a set can take.
  case noPositionLeft
  /// The set due is not a timed one, or no hold runs.
  case noHold
}

/// What every action reads first, inside its write.
struct OpenSession {
  var workout: WorkoutRow
  var active: ActiveSession
  var history: History
  var sets: [SetRow] { ownSets(history, workoutId: workout.id) }
}

/// What the actions need besides the store.
struct SessionContext: Sendable {
  let library: ExerciseLibrary
  let bar: Plates
  let now: @Sendable () -> Date
  let newId: @Sendable (Date) -> String
}

extension AccountStore {
  /// One write over the open session; nil when none is open, or `workoutId` names another.
  func withOpenSession<T>(
    _ workoutId: String? = nil, _ body: (Database, inout OpenSession) throws -> T
  ) throws -> T? {
    try writer.write { db in
      guard let active = try Rows.single(ActiveSession.self, db, "activeSession"),
        workoutId == nil || active.workoutId == workoutId,
        let workout = try Rows.get(WorkoutRow.self, db, "workouts", id: active.workoutId)
      else { return nil }
      var open = OpenSession(workout: workout, active: active, history: try Self.history(db))
      try settlePause(db, &open.workout, &open.active, sets: open.sets)
      let result = try body(db, &open)
      try Rows.putSingle(db, "activeSession", open.active)
      return result
    }
  }

  /// Checked, applied and queued, in order.
  static func write(_ db: Database, _ changes: [Change]) throws {
    try check(changes)
    for change in changes { try record(db, change) }
  }

  // MARK: Logging

  /// Logs the set due, read here at the moment of the write. With `expecting`, a set already
  /// stored at that place is corrected instead of doubled, and another set due writes nothing.
  /// `lockScreen` refuses while paused or for a timed set, which the lock screen never offers.
  func logNext(
    count: Int?, weightKg: Double?, expecting: SetPlace?, workoutId: String? = nil,
    lockScreen: Bool = false, _ ctx: SessionContext
  ) throws -> SetChange? {
    try withOpenSession(workoutId) { db, open -> SetChange? in
      if lockScreen && open.active.pausedAt != nil { return nil }
      let now = ctx.now()
      let at = Instant.string(now)
      if let expecting,
        let there = open.sets.first(where: {
          $0.slotIndex == expecting.slotIndex && $0.position == expecting.position
        })
      {
        let values = SetValues(
          weightKg: weightKg ?? there.weightKg,
          reps: there.seconds == nil ? (count ?? there.reps) : nil,
          seconds: there.seconds == nil ? .null : .value(count ?? there.seconds ?? 0),
          rir: there.rir)
        let change = SetChange(
          id: there.id, workoutId: there.workoutId, at: at, edit: .values(values))
        try Self.write(db, [.set(change)])
        return change
      }
      guard
        let due = dueSet(
          history: open.history, workout: open.workout, active: open.active, library: ctx.library,
          bar: ctx.bar),
        expecting == nil || expecting == due.place, !(lockScreen && due.timed)
      else { return nil }
      let held = open.active.chrono.flatMap { $0.place == due.place ? $0.seconds : nil }
      let n = count ?? (due.timed ? held ?? due.count : due.count)
      let values = SetValues(
        weightKg: weightKg ?? due.weightKg, reps: due.timed ? nil : n,
        seconds: due.timed ? .value(n) : .null, rir: nil)
      let change = SetChange(
        id: ctx.newId(now), workoutId: open.workout.id, at: at,
        edit: .create(
          .init(
            slotIndex: due.place.slotIndex, position: due.place.position,
            exerciseId: due.exerciseId, warmup: due.warmup, values: values, doneAt: at)))
      // A set logged during a pause ends it at the set's time.
      try Self.write(
        db, resumeChange(&open.workout, &open.active, at: at) + [.set(change)])
      open.active.chrono = nil
      open.active.draft = nil
      // A warm-up starts no rest and leaves a running one alone.
      if !due.warmup {
        let plan = open.workout.plan
        let progress = sessionProgress(
          plan, sets: try Self.sets(db, of: open.workout.id).filter { !$0.removed })
        let turn = Turn(
          slotIndex: due.place.slotIndex, round: due.place.position - Bounds.maxWarmups)
        open.active.restEndsAt =
          due.added
          ? restAfterAdded(plan, slotIndex: turn.slotIndex, doneAt: at)
          : restEndsAt(plan, done: progress.done, after: turn, doneAt: at)
        open.active.slotIndex = progress.next?.slotIndex ?? due.place.slotIndex
      }
      return change
    }.flatMap { $0 }
  }

  /// A set past the plan rests as its slot plans.
  private func restAfterAdded(_ plan: [Slot], slotIndex: Int, doneAt: String) -> String? {
    let restSec = restSecAfter(plan, slotIndex: slotIndex)
    guard restSec > 0, let ms = Instant.milliseconds(doneAt) else { return nil }
    return Instant.string(ms: ms + Int64(restSec) * 1000)
  }

  /// What a resume at `at` writes: the start moved past the pause, the rest and a chrono moved
  /// with it on the record, changed in place. Nothing while the session runs.
  private func resumeChange(_ workout: inout WorkoutRow, _ active: inout ActiveSession, at: String)
    -> [Change]
  {
    guard active.pausedAt != nil else { return [] }
    let next = resumed(startedAt: workout.startedAt, active: active, at: at)
    active = next.active
    workout.startedAt = next.startedAt
    return [.workout(WorkoutChange(id: workout.id, at: at, edit: .startedAt(next.startedAt)))]
  }

  /// A pause a set has ended since, synced or logged here, is resumed at that set's time before
  /// anything else is decided, so neither a resume nor the end takes the time trained out.
  private func settlePause(
    _ db: Database, _ workout: inout WorkoutRow, _ active: inout ActiveSession, sets: [SetRow]
  ) throws {
    guard let pausedAt = active.pausedAt,
      let endedBy = pauseEndedBy(pausedAt: pausedAt, doneAts: sets.map(\.doneAt))
    else { return }
    try Self.write(db, resumeChange(&workout, &active, at: endedBy))
  }

  // MARK: A set done

  private func liveSet(_ open: OpenSession, _ setId: String) throws -> SetRow {
    guard let set = open.sets.first(where: { $0.id == setId }) else {
      throw SessionError.noSuchSet
    }
    return set
  }

  func answerRIR(setId: String, rir: Int, _ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { db, open in
        let set = try liveSet(open, setId)
        guard !set.warmup, set.seconds == nil else { throw SessionError.noSuchSet }
        let values = SetValues(weightKg: set.weightKg, reps: set.reps, seconds: .null, rir: rir)
        try Self.write(
          db,
          [
            .set(
              SetChange(
                id: set.id, workoutId: set.workoutId, at: Instant.string(ctx.now()),
                edit: .values(values)))
          ])
      })
  }

  func correct(setId: String, weightKg: Double, count: Int, rir: Int?, _ ctx: SessionContext)
    throws
  {
    try requireOpen(
      withOpenSession { db, open in
        let set = try liveSet(open, setId)
        let timed = set.seconds != nil
        let values = SetValues(
          weightKg: weightKg, reps: timed ? nil : count, seconds: timed ? .value(count) : .null,
          rir: set.warmup || timed ? nil : rir)
        try Self.write(
          db,
          [
            .set(
              SetChange(
                id: set.id, workoutId: set.workoutId, at: Instant.string(ctx.now()),
                edit: .values(values)))
          ])
      })
  }

  /// The set goes; its turn is due again by the shared rule.
  func remove(setId: String, _ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { db, open in
        let set = try liveSet(open, setId)
        try Self.write(
          db,
          [
            .set(
              SetChange(
                id: set.id, workoutId: set.workoutId, at: Instant.string(ctx.now()),
                edit: .removed(true)))
          ])
      })
  }

  // MARK: Device state: the rest, the draft, the chrono, the pause. Nothing is queued.

  /// The running rest made longer; whether one ran.
  func addRest(seconds: Int, workoutId: String? = nil, _ ctx: SessionContext) throws -> Bool {
    try withOpenSession(workoutId) { _, open in
      let at = restClock(pausedAt: open.active.pausedAt, now: ctx.now(), stops: .all)
      guard let end = open.active.restEndsAt.flatMap(Instant.date), end > at else { return false }
      open.active.restEndsAt = Instant.string(end.addingTimeInterval(TimeInterval(seconds)))
      return true
    } ?? false
  }

  func skipRest(_ ctx: SessionContext) throws {
    try requireOpen(withOpenSession { _, open in open.active.restEndsAt = nil })
  }

  /// The load or count chosen for the set due, kept until it is logged.
  func choose(weightKg: Double?, count: Int?, _ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { _, open in
        guard
          let due = dueSet(
            history: open.history, workout: open.workout, active: open.active,
            library: ctx.library, bar: ctx.bar)
        else { return }
        let old = open.active.draft?.place == due.place ? open.active.draft : nil
        open.active.draft = SetDraft(
          slotIndex: due.place.slotIndex, position: due.place.position,
          weightKg: weightKg ?? old?.weightKg, count: count ?? old?.count)
      })
  }

  func startHold(_ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { _, open in
        guard
          let due = dueSet(
            history: open.history, workout: open.workout, active: open.active,
            library: ctx.library, bar: ctx.bar), due.timed
        else { throw SessionError.noHold }
        open.active.chrono = Chrono(
          slotIndex: due.place.slotIndex, position: due.place.position, seconds: due.count,
          endsAt: Instant.string(ctx.now().addingTimeInterval(TimeInterval(due.count))))
      })
  }

  /// The hold stops where it stands: the seconds held are what ✓ will log.
  func stopHold(_ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { _, open in
        guard var chrono = open.active.chrono, let end = Instant.date(chrono.endsAt) else {
          throw SessionError.noHold
        }
        let now = ctx.now()
        if end > now {
          let left = Int(end.timeIntervalSince(now).rounded(.up))
          chrono.seconds = max(0, chrono.seconds - left)
          chrono.endsAt = Instant.string(now)
          open.active.chrono = chrono
        }
      })
  }

  func pause(_ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { _, open in
        if open.active.pausedAt == nil { open.active.pausedAt = Instant.string(ctx.now()) }
      })
  }

  /// The start moves later by the time paused and the rest with it, in this one write.
  func resume(_ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { db, open in
        try Self.write(db, resumeChange(&open.workout, &open.active, at: Instant.string(ctx.now())))
      })
  }

  // MARK: The session's plan, built on the plan stored at this write

  private func writePlan(_ db: Database, _ open: inout OpenSession, _ plan: [Slot], at: String)
    throws
  {
    precondition(plan.count >= open.workout.plan.count, "a plan edit never takes a slot out")
    try Self.write(db, [.workout(WorkoutChange(id: open.workout.id, at: at, edit: .plan(plan)))])
    open.workout.plan = plan
  }

  private func slot(_ open: OpenSession, _ slotIndex: Int) throws {
    guard open.workout.plan.indices.contains(slotIndex) else { throw SessionError.noSuchSlot }
  }

  func replace(slotIndex: Int, with exerciseId: String, _ ctx: SessionContext) throws {
    guard let exercise = ctx.library.exercise(exerciseId) else {
      throw SessionError.unknownExercise
    }
    try requireOpen(
      withOpenSession { db, open in
        try slot(open, slotIndex)
        try writePlan(
          db, &open, replaceSlot(open.workout.plan, at: slotIndex, with: exercise),
          at: Instant.string(ctx.now()))
        if open.active.draft?.slotIndex == slotIndex { open.active.draft = nil }
        if open.active.chrono?.slotIndex == slotIndex { open.active.chrono = nil }
      })
  }

  /// Left out or put back; when it was up next, the session moves on to the next live turn.
  func leaveOut(slotIndex: Int, _ out: Bool, _ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { db, open in
        try slot(open, slotIndex)
        let plan = skipSlot(open.workout.plan, at: slotIndex, skipped: out)
        try writePlan(db, &open, plan, at: Instant.string(ctx.now()))
        if out {
          if open.active.draft?.slotIndex == slotIndex { open.active.draft = nil }
          if open.active.chrono?.slotIndex == slotIndex { open.active.chrono = nil }
        }
        if open.active.slotIndex == slotIndex || !out {
          open.active.slotIndex =
            sessionProgress(plan, sets: open.sets).next?.slotIndex ?? open.active.slotIndex
        }
      })
  }

  /// Throws `PlanError.full` when the plan holds the most slots it can.
  func addExercise(_ exerciseId: String, _ ctx: SessionContext) throws {
    guard let exercise = ctx.library.exercise(exerciseId) else {
      throw SessionError.unknownExercise
    }
    try requireOpen(
      withOpenSession { db, open in
        try writePlan(
          db, &open, try appendSlot(open.workout.plan, exercise), at: Instant.string(ctx.now()))
      })
  }

  /// One set past the plan, due next; it stays on this device until it is logged, so the
  /// planned count never grows.
  func addSet(slotIndex: Int, _ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { _, open in
        try slot(open, slotIndex)
        let planned = Bounds.maxWarmups + open.workout.plan[slotIndex].sets - 1
        let pending = open.active.draft.flatMap {
          $0.slotIndex == slotIndex ? $0.position : nil
        }
        let last =
          (open.sets.filter { $0.slotIndex == slotIndex }.map(\.position) + [
            planned, pending ?? planned,
          ]).max() ?? planned
        guard last < Bounds.maxPosition else { throw SessionError.noPositionLeft }
        open.active.draft = SetDraft(
          slotIndex: slotIndex, position: last + 1, weightKg: nil, count: nil)
        open.active.slotIndex = slotIndex
      })
  }

  // MARK: Notes

  /// An emptied note leaves the notes; the others stay.
  func noteExercise(slotIndex: Int, text: String, _ ctx: SessionContext) throws {
    try requireOpen(
      withOpenSession { db, open in
        try slot(open, slotIndex)
        var notes = open.workout.exerciseNotes
        let note = fitNote(text)
        notes[String(slotIndex)] =
          note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : note
        try Self.write(
          db,
          [
            .workout(
              WorkoutChange(
                id: open.workout.id, at: Instant.string(ctx.now()), edit: .exerciseNotes(notes)))
          ])
      })
  }

  /// The session's note, open or finished; blank clears it.
  func noteSession(workoutId: String, text: String, _ ctx: SessionContext) throws {
    let note = fitNote(text)
    let value = note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : note
    try recordChanges(
      [.workout(WorkoutChange(id: workoutId, at: Instant.string(ctx.now()), edit: .note(value)))],
      active: .keep)
  }

  // MARK: The end

  /// Ended now, a pause left out of its time; the device forgets it as open.
  func finish(_ ctx: SessionContext) throws -> String {
    let id = try writer.write { db -> String? in
      guard var active = try Rows.single(ActiveSession.self, db, "activeSession"),
        var workout = try Rows.get(WorkoutRow.self, db, "workouts", id: active.workoutId)
      else { return nil }
      let at = Instant.string(ctx.now())
      try settlePause(
        db, &workout, &active, sets: try Self.sets(db, of: workout.id).filter { !$0.removed })
      try Self.write(
        db,
        resumeChange(&workout, &active, at: at) + [
          .workout(WorkoutChange(id: workout.id, at: at, edit: .ended(at)))
        ])
      try Rows.clearSingle(db, "activeSession")
      return workout.id
    }
    guard let id else { throw SessionError.noSession }
    return id
  }

  /// The session removed, unless a set is stored by now, here or synced.
  func stopEmpty(_ ctx: SessionContext) throws {
    let done = try writer.write { db -> Bool in
      guard let active = try Rows.single(ActiveSession.self, db, "activeSession") else {
        return false
      }
      if try Self.sets(db, of: active.workoutId).contains(where: { !$0.removed }) {
        throw SessionError.notEmpty
      }
      try Self.write(
        db,
        [
          .workout(
            WorkoutChange(id: active.workoutId, at: Instant.string(ctx.now()), edit: .removed(true))
          )
        ])
      try Rows.clearSingle(db, "activeSession")
      return true
    }
    if !done { throw SessionError.noSession }
  }

  private func requireOpen(_ result: Void?) throws {
    if result == nil { throw SessionError.noSession }
  }
}
