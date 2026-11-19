public import Foundation
import GRDB

/// Why a history action wrote nothing.
public enum HistoryError: Error, Sendable, Equatable {
  /// The program is removed, or this account does not hold it.
  case notLive
  /// The session is still open: the session screen ends it or drops it.
  case sessionOpen
  /// No session of that id, or one already removed.
  case noSuchSession
  /// No live set of that id in an ended session.
  case noSuchSet
}

/// What the Séances tab writes outside a session: the active program, and a past session or one
/// of its sets. Each action is one write of the store that reads the rows as stored at that
/// moment, applies the change and queues it, so a sync landing in between is never overwritten.
public struct HistoryActions: Sendable {
  let store: AccountStore
  let now: @Sendable () -> Date

  public init(store: AccountStore, now: @escaping @Sendable () -> Date) {
    self.store = store
    self.now = now
  }

  /// Makes a live program the active one. Choosing the one already active writes nothing.
  public func chooseProgram(_ programId: String) throws {
    try store.writer.write { db in
      let programs = try AccountStore.programs(db)
      guard programs.programs.contains(where: { $0.id == programId && !$0.removed }) else {
        throw HistoryError.notLive
      }
      guard let change = chooseActive(programs, programId: programId, at: Instant.string(now()))
      else { return }
      try AccountStore.write(db, [.activeProgram(change)])
    }
  }

  /// Deletes an ended session, its sets with it as the server reads them. Deleting one already
  /// gone writes nothing.
  public func removeSession(workoutId: String) throws {
    try store.writer.write { db in
      guard let row = try Rows.get(WorkoutRow.self, db, "workouts", id: workoutId) else {
        throw HistoryError.noSuchSession
      }
      if row.removed { return }
      let active = try Rows.single(ActiveSession.self, db, "activeSession")
      guard row.endedAt != nil, active?.workoutId != workoutId else {
        throw HistoryError.sessionOpen
      }
      try AccountStore.write(
        db,
        [.workout(WorkoutChange(id: workoutId, at: Instant.string(now()), edit: .removed(true)))])
    }
  }

  /// A past set's load, count and RIR, which change together. A timed set takes `count` as its
  /// seconds; a warm-up or a timed set keeps no RIR.
  public func correct(setId: String, weightKg: Double, count: Int, rir: Int?) throws {
    try store.writer.write { db in
      let set = try Self.pastSet(db, setId)
      let timed = set.seconds != nil
      let values = SetValues(
        weightKg: weightKg, reps: timed ? nil : count, seconds: timed ? .value(count) : .null,
        rir: set.warmup || timed ? nil : rir)
      // A sheet saved unchanged, on a device that has not pulled yet: a change stamped now
      // would overwrite a newer correction from another device.
      if values
        == SetValues(
          weightKg: set.weightKg, reps: set.reps,
          seconds: set.seconds.map { .value($0) } ?? .null, rir: set.rir)
      {
        return
      }
      try AccountStore.write(
        db,
        [
          .set(
            SetChange(
              id: set.id, workoutId: set.workoutId, at: Instant.string(now()),
              edit: .values(values)))
        ])
    }
  }

  /// A past set goes; the others of its session stay.
  public func remove(setId: String) throws {
    try store.writer.write { db in
      let set = try Self.pastSet(db, setId)
      try AccountStore.write(
        db,
        [
          .set(
            SetChange(
              id: set.id, workoutId: set.workoutId, at: Instant.string(now()),
              edit: .removed(true)))
        ])
    }
  }

  /// A live set of an ended, kept session that this device does not hold open: the open
  /// session's sets are the session screen's.
  private static func pastSet(_ db: Database, _ setId: String) throws -> SetRow {
    guard let set = try Rows.get(SetRow.self, db, "sets", id: setId), !set.removed,
      let workout = try Rows.get(WorkoutRow.self, db, "workouts", id: set.workoutId),
      workout.endedAt != nil, !workout.removed,
      try Rows.single(ActiveSession.self, db, "activeSession")?.workoutId != workout.id
    else { throw HistoryError.noSuchSet }
    return set
  }
}
