import Foundation
import GRDB

// The body entries in the store, keyed as the server keys them: a weigh-in, a day's measures and
// a day's intake by day, a supplement's box by supplement and day, an annotation by id. Each
// field merges on its own time, as on the server.

/// The body rows by their keys.
enum BodyRows {
  static func weight(_ db: Database, date: String) throws -> WeightRow? {
    try byDate(WeightRow.self, db, "weights", date)
  }

  static func measure(_ db: Database, date: String) throws -> MeasureRow? {
    try byDate(MeasureRow.self, db, "measures", date)
  }

  static func intake(_ db: Database, date: String) throws -> IntakeRow? {
    try byDate(IntakeRow.self, db, "intake", date)
  }

  static func log(_ db: Database, supplementId: String, date: String) throws
    -> SupplementLogRow?
  {
    try Data.fetchOne(
      db, sql: "SELECT row FROM supplementLogs WHERE supplementId = ? AND date = ?",
      arguments: [supplementId, date]
    ).map { try Rows.decode(SupplementLogRow.self, $0) }
  }

  static func annotation(_ db: Database, id: String) throws -> AnnotationRow? {
    try Rows.get(AnnotationRow.self, db, "annotations", id: id)
  }

  static func put(_ db: Database, _ row: WeightRow) throws {
    try putByDate(db, "weights", row.date, row)
  }

  static func put(_ db: Database, _ row: MeasureRow) throws {
    try putByDate(db, "measures", row.date, row)
  }

  static func put(_ db: Database, _ row: IntakeRow) throws {
    try putByDate(db, "intake", row.date, row)
  }

  static func put(_ db: Database, _ row: SupplementLogRow) throws {
    try db.execute(
      sql: "INSERT OR REPLACE INTO supplementLogs (supplementId, date, row) VALUES (?, ?, ?)",
      arguments: [row.supplementId, row.date, Rows.encode(row)])
  }

  static func all<T: Decodable>(_ type: T.Type, _ db: Database, _ table: String) throws -> [T] {
    try Data.fetchAll(db, sql: "SELECT row FROM \(table) ORDER BY date").map {
      try Rows.decode(type, $0)
    }
  }

  private static func byDate<T: Decodable>(
    _ type: T.Type, _ db: Database, _ table: String, _ date: String
  ) throws -> T? {
    try Data.fetchOne(db, sql: "SELECT row FROM \(table) WHERE date = ?", arguments: [date])
      .map { try Rows.decode(type, $0) }
  }

  private static func putByDate<T: Encodable>(
    _ db: Database, _ table: String, _ date: String, _ row: T
  ) throws {
    try db.execute(
      sql: "INSERT OR REPLACE INTO \(table) (date, row) VALUES (?, ?)",
      arguments: [date, Rows.encode(row)])
  }
}

extension MeasureRow {
  init(empty date: String) {
    self.init(
      date: date, waistCm: nil, waistAt: nil, neckCm: nil, neckAt: nil, hipCm: nil, hipAt: nil)
  }

  /// A field's value and time.
  subscript(field: MeasureField) -> (cm: Double?, at: String?) {
    get {
      switch field {
      case .waist: (waistCm, waistAt)
      case .neck: (neckCm, neckAt)
      case .hip: (hipCm, hipAt)
      }
    }
    set {
      switch field {
      case .waist: (waistCm, waistAt) = newValue
      case .neck: (neckCm, neckAt) = newValue
      case .hip: (hipCm, hipAt) = newValue
      }
    }
  }
}

extension IntakeRow {
  init(empty date: String) {
    self.init(date: date, kcal: nil, kcalAt: nil, proteinG: nil, proteinAt: nil)
  }

  /// A field's value and time.
  subscript(field: IntakeField) -> (value: Int?, at: String?) {
    get {
      switch field {
      case .kcal: (kcal, kcalAt)
      case .protein: (proteinG, proteinAt)
      }
    }
    set {
      switch field {
      case .kcal: (kcal, kcalAt) = newValue
      case .protein: (proteinG, proteinAt) = newValue
      }
    }
  }
}

extension AccountStore {
  /// Checked against the person's today, applied and queued, in order. A session kind never
  /// comes here: `write` checks those.
  static func writeBody(_ db: Database, _ changes: [Change], now: Date, timeZone: TimeZone)
    throws
  {
    guard changes.allSatisfy({ $0.isBody && isValid($0, now: now, timeZone: timeZone) }) else {
      throw StoreError.invalidChange
    }
    for change in changes { try record(db, change) }
  }

  /// `localAt` for a body entry: the time of the field it writes; nil, never written here.
  static func bodyLocalAt(_ db: Database, _ change: Change) throws -> String? {
    switch change {
    case .weight(let c): return try BodyRows.weight(db, date: c.date)?.at
    case .measure(let c): return try BodyRows.measure(db, date: c.date)?[c.field].at
    case .intake(let c): return try BodyRows.intake(db, date: c.date)?[c.field].at
    case .supplementLog(let c):
      return try BodyRows.log(db, supplementId: c.supplementId, date: c.date)?.at
    case .annotation(let c):
      let row = try BodyRows.annotation(db, id: c.id)
      switch c.edit {
      case .fields: return row?.fieldsAt
      case .removed: return row?.removedAt
      }
    case .workout, .set, .activeProgram: return nil
    }
  }

  /// `applyLocal` for a body entry.
  static func applyBody(_ db: Database, _ change: Change) throws {
    switch change {
    case .weight(let c):
      try BodyRows.put(db, WeightRow(date: c.date, weightKg: c.weightKg, at: c.at))
    case .measure(let c):
      var row = try BodyRows.measure(db, date: c.date) ?? MeasureRow(empty: c.date)
      row[c.field] = (c.value, c.at)
      try BodyRows.put(db, row)
    case .intake(let c):
      var row = try BodyRows.intake(db, date: c.date) ?? IntakeRow(empty: c.date)
      row[c.field] = (c.value, c.at)
      try BodyRows.put(db, row)
    case .supplementLog(let c):
      try BodyRows.put(
        db, SupplementLogRow(supplementId: c.supplementId, date: c.date, taken: c.taken, at: c.at))
    case .annotation(let c):
      let row = try BodyRows.annotation(db, id: c.id)
      switch c.edit {
      case .fields(let date, let type, let label):
        try Rows.put(
          db, "annotations", id: c.id,
          AnnotationRow(
            id: c.id, date: date, type: type, label: label, fieldsAt: c.at,
            removed: row?.removed ?? false, removedAt: row?.removedAt))
      case .removed(let removed):
        guard var row else { return }
        (row.removed, row.removedAt) = (removed, c.at)
        try Rows.put(db, "annotations", id: c.id, row)
      }
    case .workout, .set, .activeProgram: return
    }
  }

  /// `revert` for a body entry, once `localAt` showed the refused write is still the one held:
  /// the field goes back to unwritten, and the server sends what it holds, if anything.
  static func revertBody(_ db: Database, _ change: Change) throws {
    switch change {
    case .weight(let c):
      try db.execute(sql: "DELETE FROM weights WHERE date = ?", arguments: [c.date])
    case .measure(let c):
      guard var row = try BodyRows.measure(db, date: c.date) else { return }
      row[c.field] = (nil, nil)
      try BodyRows.put(db, row)
    case .intake(let c):
      guard var row = try BodyRows.intake(db, date: c.date) else { return }
      row[c.field] = (nil, nil)
      try BodyRows.put(db, row)
    case .supplementLog(let c):
      try db.execute(
        sql: "DELETE FROM supplementLogs WHERE supplementId = ? AND date = ?",
        arguments: [c.supplementId, c.date])
    case .annotation(let c):
      switch c.edit {
      case .fields: try Rows.delete(db, "annotations", id: c.id)
      case .removed:
        guard var row = try BodyRows.annotation(db, id: c.id) else { return }
        (row.removed, row.removedAt) = (false, nil)
        try Rows.put(db, "annotations", id: c.id, row)
      }
    case .workout, .set, .activeProgram: return
    }
  }
}

extension Change {
  /// A body entry, dated by the person's day.
  var isBody: Bool {
    switch self {
    case .weight, .measure, .intake, .supplementLog, .annotation: true
    case .workout, .set, .activeProgram: false
    }
  }
}
