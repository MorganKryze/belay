import Foundation
import GRDB

// The store's tables. A row is kept as JSON beside the keys it is found by, so a field needs no
// column. The JSON is the row as this build reads it, not as the server sent it: a field this
// build does not read is dropped, and a null may come back left out (reads take both as no
// value). Only a session's plan keeps the server's own JSON (WorkoutRow.planJSON).

enum Schema {
  /// Append only: a store already on a phone has run every earlier step and runs only the new
  /// ones. A step that starts keeping a new kind of row, or reading a new field of a kind already
  /// kept, sets the cursor back to "0": the rows stored before it never had that kind or that
  /// field, and would never come again. A start copies the stored slots into the session's plan,
  /// so a field missing there would be missing from that session's history for good.
  static var migrator: DatabaseMigrator {
    var migrator = DatabaseMigrator()
    migrator.registerMigration("v1") { db in
      for table in ["workouts", "programs", "programSessions", "programSlots", "activities"] {
        try db.create(table: table) { t in
          t.primaryKey("id", .text)
          t.column("row", .blob).notNull()
        }
      }
      try db.create(table: "sets") { t in
        t.primaryKey("id", .text)
        t.column("workoutId", .text).notNull().indexed()
        t.column("row", .blob).notNull()
      }
      // One row each, at key 1.
      for table in ["activeProgram", "activeSession"] {
        try db.create(table: table) { t in
          t.primaryKey("key", .integer).check { $0 == 1 }
          t.column("row", .blob).notNull()
        }
      }
      // AUTOINCREMENT: an id is never given twice, so an entry written while a request is out
      // never takes the id of one sent and dropped when the answer lands.
      try db.create(table: "outbox") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("bytes", .blob).notNull()
      }
      try db.create(table: "rejected") { t in
        t.autoIncrementedPrimaryKey("id")
        t.column("bytes", .blob).notNull()
        t.column("reason", .text).notNull()
      }
      try db.create(table: "meta") { t in
        t.primaryKey("key", .text)
        t.column("value", .text).notNull()
      }
    }
    // The effort given on a session's summary. The server has no field for it, so it lives on
    // this phone only and never enters the queue; the cursor stays where it is.
    migrator.registerMigration("v2") { db in
      try db.create(table: "efforts") { t in
        t.primaryKey("workoutId", .text)
        t.column("row", .blob).notNull()
      }
    }
    // Apple Health: the switch, at key 1, and what this phone wrote there, by session key. Both
    // belong to this phone and this account only, so neither is queued; the cursor stays.
    migrator.registerMigration("v3") { db in
      try db.create(table: "healthSettings") { t in
        t.primaryKey("key", .integer).check { $0 == 1 }
        t.column("row", .blob).notNull()
      }
      try db.create(table: "healthWritten") { t in
        t.primaryKey("key", .text)
        t.column("row", .blob).notNull()
      }
    }
    return migrator
  }
}

/// Row storage: each kind's JSON by id.
enum Rows {
  static func encode<T: Encodable>(_ value: T) throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    return try encoder.encode(value)
  }

  static func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
    try JSONDecoder().decode(type, from: data)
  }

  static func get<T: Decodable>(_ type: T.Type, _ db: Database, _ table: String, id: String)
    throws -> T?
  {
    try Data.fetchOne(db, sql: "SELECT row FROM \(table) WHERE id = ?", arguments: [id])
      .map { try decode(type, $0) }
  }

  static func all<T: Decodable>(_ type: T.Type, _ db: Database, _ table: String) throws -> [T] {
    try Data.fetchAll(db, sql: "SELECT row FROM \(table) ORDER BY id").map { try decode(type, $0) }
  }

  static func put<T: Encodable>(_ db: Database, _ table: String, id: String, _ row: T) throws {
    try db.execute(
      sql: "INSERT OR REPLACE INTO \(table) (id, row) VALUES (?, ?)", arguments: [id, encode(row)])
  }

  static func delete(_ db: Database, _ table: String, id: String) throws {
    try db.execute(sql: "DELETE FROM \(table) WHERE id = ?", arguments: [id])
  }

  static func putSet(_ db: Database, _ row: SetRow) throws {
    try db.execute(
      sql: "INSERT OR REPLACE INTO sets (id, workoutId, row) VALUES (?, ?, ?)",
      arguments: [row.id, row.workoutId, encode(row)])
  }

  static func single<T: Decodable>(_ type: T.Type, _ db: Database, _ table: String) throws -> T? {
    try Data.fetchOne(db, sql: "SELECT row FROM \(table) WHERE key = 1").map {
      try decode(type, $0)
    }
  }

  static func putSingle<T: Encodable>(_ db: Database, _ table: String, _ row: T) throws {
    try db.execute(
      sql: "INSERT OR REPLACE INTO \(table) (key, row) VALUES (1, ?)", arguments: [encode(row)])
  }

  static func clearSingle(_ db: Database, _ table: String) throws {
    try db.execute(sql: "DELETE FROM \(table)")
  }

  static func enqueue(_ db: Database, _ change: Change) throws {
    try db.execute(
      sql: "INSERT INTO outbox (bytes) VALUES (?)", arguments: [ChangeJSON.encode(change)])
  }
}
