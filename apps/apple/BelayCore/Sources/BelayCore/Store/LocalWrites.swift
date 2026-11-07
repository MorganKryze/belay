import Foundation
import GRDB

// What the phone records. Each public write is one transaction over the rows, their changes in
// the queue and the open session: all of it is written, or none of it, so what the screen shows
// is always queued.

extension AccountStore {
  /// The changes applied and queued in order, with `active` written beside them. A change outside
  /// the contract is refused before anything is written: the server would refuse it.
  // A deliberate ceiling: no compaction, a note rewritten three times is three changes, all
  // idempotent. If a queue grows past a few hundred, fold the changes of one key before sending.
  public func recordChanges(_ changes: [Change], active: ActiveUpdate) throws {
    try Self.check(changes)
    try writer.write { db in
      for change in changes { try Self.record(db, change) }
      try Self.update(db, active: active)
    }
  }

  /// A set as a tick records it, with its change and the open session. A live set already at that
  /// place of the session (written by another device) is corrected instead of doubled.
  public func recordSet(_ input: SetInput, at: String, active: ActiveSession) throws -> SetChange {
    try writer.write { db in
      let there = try Self.sets(db, of: input.workoutId).first {
        !$0.removed && $0.slotIndex == input.slotIndex && $0.position == input.position
      }
      let change =
        if let there {
          SetChange(id: there.id, workoutId: input.workoutId, at: at, edit: .values(input.values))
        } else {
          SetChange(
            id: input.id, workoutId: input.workoutId, at: at,
            edit: .create(
              .init(
                slotIndex: input.slotIndex, position: input.position, exerciseId: input.exerciseId,
                warmup: input.warmup, values: input.values, doneAt: input.doneAt)))
        }
      try Self.check([.set(change)])
      try Self.record(db, .set(change))
      try Rows.putSingle(db, "activeSession", active)
      return change
    }
  }

  /// Moves the end of the rest in `workoutId`, or ends it with nil, in one write. The rest is this
  /// device's own, as on the web: the server holds none, so nothing is queued. Whether it was
  /// written: false when the device holds another session open, or none.
  public func moveRest(of workoutId: String, to end: String?) throws -> Bool {
    try writer.write { db in
      guard var active = try Rows.single(ActiveSession.self, db, "activeSession"),
        active.workoutId == workoutId
      else { return false }
      active.restEndsAt = end
      try Rows.putSingle(db, "activeSession", active)
      return true
    }
  }

  /// Starts a session, unless one is open already, here or on another device: then this device
  /// takes that one up and its id is returned, so two taps never open two. A session left behind
  /// is closed in the same write, or nobody would.
  public func startWorkout(_ asked: WorkoutStart, now: Date) throws -> String {
    try Self.check([.workout(asked.change)])
    return try writer.write { db in
      let workouts = try Rows.all(WorkoutRow.self, db, "workouts")
      let sets = try Rows.all(SetRow.self, db, "sets")
      let active = try Rows.single(ActiveSession.self, db, "activeSession")
      if let open = openWorkout(workouts, forgotten: (sets, now)) {
        if active?.workoutId != open.id {
          try Rows.putSingle(
            db, "activeSession", ActiveSession(workoutId: open.id, slotIndex: 0, restEndsAt: nil))
        }
        return open.id
      }
      for change in Self.forgottenChanges(workouts, sets: sets, now: now, active: active) {
        try Self.record(db, change)
      }
      try Self.record(db, .workout(asked.change))
      try Rows.putSingle(
        db, "activeSession", ActiveSession(workoutId: asked.id, slotIndex: 0, restEndsAt: nil))
      return asked.id
    }
  }

  /// Closes what a session left open is due, and the device forgets it as its open session.
  /// Called once a sync has landed completely: before, a set from another device may be missing.
  /// Whether anything was written.
  public func closeForgotten(now: Date) throws -> Bool {
    try writer.write { db in
      let active = try Rows.single(ActiveSession.self, db, "activeSession")
      let changes = Self.forgottenChanges(
        try Rows.all(WorkoutRow.self, db, "workouts"), sets: try Rows.all(SetRow.self, db, "sets"),
        now: now, active: active)
      if changes.isEmpty { return false }
      try Self.check(changes)
      for change in changes { try Self.record(db, change) }
      if let active, changes.contains(where: { $0.workoutId == active.workoutId }) {
        try Rows.clearSingle(db, "activeSession")
      }
      return true
    }
  }

  static func check(_ changes: [Change]) throws {
    // Neither kind is dated by the local day, so the clock does not sway the verdict.
    guard changes.allSatisfy({ isValid($0, now: Date()) }) else { throw StoreError.invalidChange }
  }

  /// Applied here and queued as the bytes it is sent as.
  private static func record(_ db: Database, _ written: Change) throws {
    var change = written
    if case .workout(var workout) = written, case .start(let start) = workout.edit {
      workout.edit = .start(try withSessionName(db, start))
      change = .workout(workout)
    }
    try applyLocal(db, change)
    try Rows.enqueue(db, change)
  }

  private static func update(_ db: Database, active: ActiveUpdate) throws {
    switch active {
    case .keep: return
    case .clear: try Rows.clearSingle(db, "activeSession")
    case .set(let session): try Rows.putSingle(db, "activeSession", session)
    }
  }

  /// A start keeps the name its program session holds here at that instant, so the session done
  /// never follows a later rename. Null: the session had none; a start with no session keeps none.
  private static func withSessionName(_ db: Database, _ start: WorkoutChange.Start) throws
    -> WorkoutChange.Start
  {
    guard let sessionId = start.sessionId.value else { return start }
    let name = try Rows.get(ProgramSessionRow.self, db, "programSessions", id: sessionId)?.name
    var named = start
    // A stored name always passed the same rule; if one did not, the start still goes through.
    named.sessionName = name.map { isSessionName($0) ? .value($0) : .null } ?? .null
    return named
  }

  /// What closes the sessions left open. One is ended at its last set. A session without a set is
  /// removed only when this device holds it: elsewhere its sets may simply not have arrived yet,
  /// and a removal outranks them all.
  private static func forgottenChanges(
    _ workouts: [WorkoutRow], sets: [SetRow], now: Date, active: ActiveSession?
  ) -> [Change] {
    let at = Instant.string(now)
    return workouts.compactMap { w in
      if w.endedAt != nil || w.removed { return nil }
      switch autoClose(w, sets: sets, now: now) {
      case .end(let endedAt):
        return .workout(WorkoutChange(id: w.id, at: at, edit: .ended(endedAt)))
      case .remove where active?.workoutId == w.id:
        return .workout(WorkoutChange(id: w.id, at: at, edit: .removed(true)))
      default: return nil
      }
    }
  }

  static func sets(_ db: Database, of workoutId: String) throws -> [SetRow] {
    try Data.fetchAll(
      db, sql: "SELECT row FROM sets WHERE workoutId = ? ORDER BY id", arguments: [workoutId]
    ).map { try Rows.decode(SetRow.self, $0) }
  }

  /// The time of the field a change writes, as this device holds it; nil: never written here.
  static func localAt(_ db: Database, _ change: Change) throws -> String? {
    switch change {
    case .workout(let c):
      let row = try Rows.get(WorkoutRow.self, db, "workouts", id: c.id)
      switch c.edit {
      // Written once: a start never overwrites a session.
      case .start: return row == nil ? nil : c.at
      case .plan: return row?.planAt
      case .startedAt: return row?.startedAtAt
      case .ended: return row?.endedAtAt
      case .note: return row?.noteAt
      case .exerciseNotes: return row?.exerciseNotesAt
      case .removed: return row?.removedAt
      }
    case .set(let c):
      let row = try Rows.get(SetRow.self, db, "sets", id: c.id)
      switch c.edit {
      case .create: return row == nil ? nil : c.at
      case .values: return row?.fieldsAt
      case .removed: return row?.removedAt
      }
    }
  }

  /// Writes what a change says into this device's copy, the way the server merges it.
  static func applyLocal(_ db: Database, _ change: Change) throws {
    switch change {
    case .workout(let c):
      let row = try Rows.get(WorkoutRow.self, db, "workouts", id: c.id)
      if case .start(let start) = c.edit {
        guard row == nil else { return }
        let created = WorkoutRow(
          id: c.id, sessionCode: start.sessionCode, sessionId: start.sessionId,
          sessionName: start.sessionName, plan: start.plan, planAt: nil,
          startedAt: start.startedAt, startedAtAt: nil, endedAt: nil, endedAtAt: nil, note: nil,
          noteAt: nil, exerciseNotes: [:], exerciseNotesAt: nil, removed: false, removedAt: nil)
        return try Rows.put(db, "workouts", id: c.id, created)
      }
      guard var row else { return }
      switch c.edit {
      case .start: return
      case .plan(let plan): (row.plan, row.planAt) = (plan, c.at)
      case .startedAt(let time): (row.startedAt, row.startedAtAt) = (time, c.at)
      case .ended(let time): (row.endedAt, row.endedAtAt) = (time, c.at)
      case .note(let note): (row.note, row.noteAt) = (note, c.at)
      case .exerciseNotes(let notes): (row.exerciseNotes, row.exerciseNotesAt) = (notes, c.at)
      case .removed(let removed): (row.removed, row.removedAt) = (removed, c.at)
      }
      try Rows.put(db, "workouts", id: c.id, row)
    case .set(let c):
      let row = try Rows.get(SetRow.self, db, "sets", id: c.id)
      if case .create(let create) = c.edit {
        guard row == nil else { return }
        let v = create.values
        return try Rows.putSet(
          db,
          SetRow(
            id: c.id, workoutId: c.workoutId, slotIndex: create.slotIndex,
            position: create.position, exerciseId: create.exerciseId, warmup: create.warmup,
            weightKg: v.weightKg, reps: v.reps, seconds: v.seconds.value, rir: v.rir,
            doneAt: create.doneAt, fieldsAt: c.at, removed: false, removedAt: nil))
      }
      guard var row else { return }
      switch c.edit {
      case .create: return
      case .values(let v):
        (row.weightKg, row.reps, row.seconds, row.rir) = (
          v.weightKg, v.reps, v.seconds.value, v.rir
        )
        row.fieldsAt = c.at
      case .removed(let removed): (row.removed, row.removedAt) = (removed, c.at)
      }
      try Rows.putSet(db, row)
    }
  }
}

extension Change {
  /// The session a change belongs to.
  var workoutId: String {
    switch self {
    case .workout(let c): c.id
    case .set(let c): c.workoutId
    }
  }
}
