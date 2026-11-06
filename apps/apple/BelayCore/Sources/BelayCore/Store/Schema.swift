import Foundation
import GRDB

// The store's tables. A row is kept as the JSON the server writes for it, beside the keys it is
// found by: a field left out stays left out, a null stays null, and a field a later server adds to
// a kept kind needs no new column.

enum Schema {
  /// Append only: a store already on a phone has run every earlier step and runs only the new
  /// ones. A step that starts keeping a new kind of row sets the cursor back to "0", or the rows
  /// of that kind received before would never come again.
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
