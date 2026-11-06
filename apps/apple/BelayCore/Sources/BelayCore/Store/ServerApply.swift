import Foundation
import GRDB

// What the server's answer does to the store, in one transaction, so a closed app never keeps
// half of it.

extension AccountStore {
  /// After a 200: drops exactly the changes that were sent, keeps a trace of the refused ones and
  /// takes back what they showed, takes the server's rows, then puts back on top the changes
  /// queued meanwhile unless the server holds a later write, and keeps the cursor. Kinds the
  /// store does not keep are not even read.
  public func applyServer(sent: [OutboxEntry], response: SyncResponse) throws {
    try writer.write { db in
      for entry in sent {
        try db.execute(sql: "DELETE FROM outbox WHERE id = ?", arguments: [entry.id])
      }
      // One after the other, in the answer's order: two changes of one row each read it, then
      // write it.
      for refusal in response.rejected {
        guard sent.indices.contains(refusal.index) else { continue }
        let entry = sent[refusal.index]
        try db.execute(
          sql: "INSERT INTO rejected (bytes, reason) VALUES (?, ?)",
          arguments: [entry.bytes, refusal.reason])
        try Self.revert(db, entry.change)
      }
      for row in response.workouts { try Rows.put(db, "workouts", id: row.id, row) }
      for row in response.sets { try Rows.putSet(db, row) }
      // Absent from an older server's answer: nothing to take.
      for row in response.programs ?? [] { try Rows.put(db, "programs", id: row.id, row) }
      for row in response.programSessions ?? [] {
        try Rows.put(db, "programSessions", id: row.id, row)
      }
      for row in response.programSlots ?? [] { try Rows.put(db, "programSlots", id: row.id, row) }
      if let pointer = response.activeProgram { try Rows.putSingle(db, "activeProgram", pointer) }
      for row in response.activities { try Rows.put(db, "activities", id: row.id, row) }
      // Only after the rows: a change queued while the request was out is newer than what the
      // server sent, and must stay what the screen shows.
      for entry in try Self.outbox(db, limit: nil) {
        if isNewer(entry.change.at, try Self.localAt(db, entry.change)) {
          try Self.applyLocal(db, entry.change)
        }
      }
      // The open session was finished or removed on another device: this one lets it go.
      if let active = try Rows.single(ActiveSession.self, db, "activeSession") {
        let session = try Rows.get(WorkoutRow.self, db, "workouts", id: active.workoutId)
        if session == nil || session?.endedAt != nil || session?.removed == true {
          try Rows.clearSingle(db, "activeSession")
        }
      }
      try db.execute(
        sql: "INSERT OR REPLACE INTO meta (key, value) VALUES ('cursor', ?)",
        arguments: [response.cursor])
    }
  }

  /// What a refused change put on screen goes, unless something later replaced it. The server
  /// sends back what it holds for that row, if anything, in the same answer.
  static func revert(_ db: Database, _ change: Change) throws {
    guard try localAt(db, change) == change.at else { return }
    switch change {
    case .workout(let c):
      // A refused start takes its session away; a refused field goes back to unwritten. A
      // refused plan or start time keeps the value shown until the server's row replaces it.
      if case .start = c.edit { return try Rows.delete(db, "workouts", id: c.id) }
      guard var row = try Rows.get(WorkoutRow.self, db, "workouts", id: c.id) else { return }
      switch c.edit {
      case .start: return
      case .plan: row.planAt = nil
      case .startedAt: row.startedAtAt = nil
      case .ended: (row.endedAt, row.endedAtAt) = (nil, nil)
      case .note: (row.note, row.noteAt) = (nil, nil)
      case .exerciseNotes: (row.exerciseNotes, row.exerciseNotesAt) = ([:], nil)
      case .removed: (row.removed, row.removedAt) = (false, nil)
      }
      try Rows.put(db, "workouts", id: c.id, row)
    case .set(let c):
      switch c.edit {
      case .create: try Rows.delete(db, "sets", id: c.id)
      // A refused correction is replaced by the stored set, which the server sends back.
      case .values: return
      case .removed:
        guard var row = try Rows.get(SetRow.self, db, "sets", id: c.id) else { return }
        (row.removed, row.removedAt) = (false, nil)
        try Rows.putSet(db, row)
      }
    }
  }
}

extension Change {
  /// When the change was written.
  var at: String {
    switch self {
    case .workout(let c): c.at
    case .set(let c): c.at
    }
  }
}
