import Foundation
import GRDB

// What the screens and the sync read. Each read has a form on a `Database`, so `observe` can
// follow several of them as one consistent value.

extension AccountStore {
  /// The queue in the order written, the first `limit` entries when given.
  public static func outbox(_ db: Database, limit: Int?) throws -> [OutboxEntry] {
    try Row.fetchAll(
      db, sql: "SELECT id, bytes FROM outbox ORDER BY id LIMIT ?", arguments: [limit ?? -1]
    ).map { row in
      let bytes: Data = row["bytes"]
      return OutboxEntry(id: row["id"], bytes: bytes, change: try ChangeJSON.decode(bytes))
    }
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

  /// The refusals the person has not read about yet, in the order they came.
  public static func rejected(_ db: Database) throws -> [RejectedEntry] {
    try Row.fetchAll(db, sql: "SELECT id, bytes, reason FROM rejected ORDER BY id").map { row in
      RejectedEntry(
        id: row["id"], change: try ChangeJSON.decode(row["bytes"]), reason: row["reason"])
    }
  }

  public func outbox(limit: Int?) throws -> [OutboxEntry] {
    try writer.read { try Self.outbox($0, limit: limit) }
  }

  public func cursor() throws -> String { try writer.read(Self.cursor) }
  public func history() throws -> History { try writer.read(Self.history) }
  public func programs() throws -> StoredPrograms { try writer.read(Self.programs) }
  public func activities() throws -> [ActivityRow] { try writer.read(Self.activities) }
  public func activeSession() throws -> ActiveSession? { try writer.read(Self.activeSession) }
  public func rejected() throws -> [RejectedEntry] { try writer.read(Self.rejected) }
}
