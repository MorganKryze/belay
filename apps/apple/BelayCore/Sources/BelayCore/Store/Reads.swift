import Foundation
import GRDB

// What the screens and the sync read. Each read has a form on a `Database`, so `observe` can
// follow several of them as one consistent value.

extension AccountStore {
  /// The queue in the order written, the first `limit` entries when given. An entry this build
  /// cannot read, written by a later one after a move back, is left out and left queued as
  /// written: that build sends it once installed again. Sent from here it could make the server
  /// refuse the whole request, and dropped it would be lost.
  public static func outbox(_ db: Database, limit: Int?) throws -> [OutboxEntry] {
    var entries: [OutboxEntry] = []
    let rows = try Row.fetchCursor(db, sql: "SELECT id, bytes FROM outbox ORDER BY id")
    while entries.count < limit ?? .max, let row = try rows.next() {
      let bytes: Data = row["bytes"]
      guard let change = try? ChangeJSON.decode(bytes) else { continue }
      entries.append(OutboxEntry(id: row["id"], bytes: bytes, change: change))
    }
    return entries
  }

  /// Where the pull stands: "0" before the first answer.
  public static func cursor(_ db: Database) throws -> String {
    try String.fetchOne(db, sql: "SELECT value FROM meta WHERE key = 'cursor'") ?? "0"
  }

  /// Every session and set, removed ones included: the shared rules leave those out.
  public static func history(_ db: Database) throws -> History {
    History(
      workouts: try Rows.all(WorkoutRow.self, db, "workouts"),
      sets: try Rows.all(SetRow.self, db, "sets"))
  }

  /// One past session, read from its own rows: opening it does not decode every session kept.
  public static func pastSession(_ db: Database, workoutId: String) throws -> PastSession? {
    guard let workout = try Rows.get(WorkoutRow.self, db, "workouts", id: workoutId) else { return nil }
    let sets = try Data.fetchAll(
      db, sql: "SELECT row FROM sets WHERE json_extract(CAST(row AS TEXT), '$.workoutId') = ? ORDER BY id",
      arguments: [workoutId]
    ).map { try Rows.decode(SetRow.self, $0) }
    let effort = try Self.effort(db, workoutId: workoutId)
    return BelayCore.pastSession(
      History(workouts: [workout], sets: sets), workoutId: workoutId, efforts: effort.map { [$0] } ?? [])
  }

  /// The programs as the screens read them: what this device holds, over the starting rows.
  public static func programs(_ db: Database) throws -> StoredPrograms {
    let pointer = try Rows.single(ActiveProgramRow.self, db, "activeProgram")
    return withSeed(
      activeId: pointer.map { .value($0.programId) } ?? .absent, activeAt: pointer?.at,
      programs: try Rows.all(ProgramRow.self, db, "programs"),
      sessions: try Rows.all(ProgramSessionRow.self, db, "programSessions"),
      slots: try Rows.all(ProgramSlotRow.self, db, "programSlots"))
  }

  /// The activities still in place, by day.
  public static func activities(_ db: Database) throws -> [ActivityRow] {
    try Rows.all(ActivityRow.self, db, "activities").filter { !$0.removed }
      .sorted { ($0.date, $0.id) < ($1.date, $1.id) }
  }

  public static func activeSession(_ db: Database) throws -> ActiveSession? {
    try Rows.single(ActiveSession.self, db, "activeSession")
  }

  /// The refusals the person has not read about yet, in the order they came. One a later build
  /// stored and this one cannot read stays as a trace but is not listed: no screen could say what
  /// it was.
  public static func rejected(_ db: Database) throws -> [RejectedEntry] {
    try Row.fetchAll(db, sql: "SELECT id, bytes, reason FROM rejected ORDER BY id").compactMap {
      row in
      guard let change = try? ChangeJSON.decode(row["bytes"]) else { return nil }
      return RejectedEntry(id: row["id"], change: change, reason: row["reason"])
    }
  }

  public func outbox(limit: Int?) throws -> [OutboxEntry] {
    try writer.read { try Self.outbox($0, limit: limit) }
  }

  public func cursor() throws -> String { try writer.read(Self.cursor) }
  public func history() throws -> History { try writer.read(Self.history) }
  public func pastSession(workoutId: String) throws -> PastSession? {
    try writer.read { try Self.pastSession($0, workoutId: workoutId) }
  }
  public func programs() throws -> StoredPrograms { try writer.read(Self.programs) }
  public func activities() throws -> [ActivityRow] { try writer.read(Self.activities) }
  public func activeSession() throws -> ActiveSession? { try writer.read(Self.activeSession) }
  public func rejected() throws -> [RejectedEntry] { try writer.read(Self.rejected) }
}
