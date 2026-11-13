import Foundation
public import GRDB

/// Health on this phone for this account: the Santé switch, off until the person turns it on, and
/// when they last did, in ms since the epoch (only sessions and weigh-ins after it are new to
/// Health); the import's switch, whether its card was offered, and its place in Health's
/// body-mass history with the days it filled. A record from before the import decodes with the
/// import off and no place.
public struct HealthSettings: Codable, Sendable, Equatable {
  public var on: Bool
  public var turnedOnAt: Int64?
  public var importOn: Bool
  /// The import's card was shown and answered: it never shows again.
  public var offered: Bool
  /// Where the next read of Health goes on from; nil reads the whole history.
  public var anchor: String?
  /// By date.
  public var filled: [String: Filled]

  public init(
    on: Bool, turnedOnAt: Int64?, importOn: Bool = false, offered: Bool = false,
    anchor: String? = nil, filled: [String: Filled] = [:]
  ) {
    self.on = on
    self.turnedOnAt = turnedOnAt
    self.importOn = importOn
    self.offered = offered
    self.anchor = anchor
    self.filled = filled
  }

  private enum CodingKeys: String, CodingKey {
    case on, turnedOnAt, importOn, offered, anchor, filled
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    self.init(
      on: try c.decode(Bool.self, forKey: .on),
      turnedOnAt: try c.decodeIfPresent(Int64.self, forKey: .turnedOnAt),
      importOn: try c.decodeIfPresent(Bool.self, forKey: .importOn) ?? false,
      offered: try c.decodeIfPresent(Bool.self, forKey: .offered) ?? false,
      anchor: try c.decodeIfPresent(String.self, forKey: .anchor),
      filled: try c.decodeIfPresent([String: Filled].self, forKey: .filled) ?? [:])
  }

  public static let off = HealthSettings(on: false, turnedOnAt: nil)

  /// What the write run depends on: the import's place moving does not stop it.
  var writes: (on: Bool, turnedOnAt: Int64?) { (on, turnedOnAt) }
}

extension AccountStore {
  public func healthSettings() throws -> HealthSettings {
    try writer.read { try Rows.single(HealthSettings.self, $0, "healthSettings") ?? .off }
  }

  /// Turning it on starts from `now`; turning on a switch already on changes nothing. Off keeps
  /// the record of what was written, so a later turn-on still updates and deletes it.
  public func setHealthOn(_ on: Bool, now: Date) throws {
    try writer.write { db in
      var settings = try Rows.single(HealthSettings.self, db, "healthSettings") ?? .off
      if on && !settings.on { settings.turnedOnAt = Instant.milliseconds(now) }
      settings.on = on
      try Rows.putSingle(db, "healthSettings", settings)
    }
  }

  /// The import's switch. On starts a new read from the whole history, keeping the days it filled
  /// before; either way its card has had its answer.
  public func setHealthImportOn(_ on: Bool) throws {
    try writer.write { db in
      var settings = try Rows.single(HealthSettings.self, db, "healthSettings") ?? .off
      if on && !settings.importOn { settings.anchor = nil }
      settings.importOn = on
      settings.offered = true
      try Rows.putSingle(db, "healthSettings", settings)
    }
  }

  /// The import's card answered « Pas maintenant »: it never shows again.
  public func setHealthImportOffered() throws {
    try writer.write { db in
      var settings = try Rows.single(HealthSettings.self, db, "healthSettings") ?? .off
      settings.offered = true
      try Rows.putSingle(db, "healthSettings", settings)
    }
  }

  /// Writes the readings' days and the import's new place in one write, each weigh-in with its
  /// queued change (`importChoice`). `from` is the place the read began at: turned off, or off
  /// and on again, while Health was read, nothing is taken and the new place stands. Returns how
  /// many weigh-ins were written.
  ///
  /// One read and one write hold the whole history, ~3 650 days for ten years of daily readings:
  /// a deliberate ceiling; the way past it is a paged read.
  public func importWeighIns(
    _ samples: [HealthSample], anchor: String, from: String?, now: Date, timeZone: TimeZone
  ) throws -> Int {
    try writer.write { db in
      var settings = try Rows.single(HealthSettings.self, db, "healthSettings") ?? .off
      guard settings.on, settings.importOn, settings.anchor == from else { return 0 }
      let today = toISODate(now, timeZone: timeZone)
      let foreign = samples.filter { !$0.isBelays }
      let floor = toISODate(Date(ms: healthEarliest), timeZone: timeZone)
      let days = earliestPerDay(foreign, fromDay: floor, timeZone: timeZone)
      var rows: [String: WeightRow] = [:]
      for date in days.keys { rows[date] = try BodyRows.weight(db, date: date) }
      let changes = importChoice(
        days, rows: rows, filled: settings.filled, today: today, now: now, timeZone: timeZone)
      try Self.writeBody(db, changes.map(Change.weight), now: now, timeZone: timeZone)
      for change in changes {
        settings.filled[change.date] = Filled(
          at: change.at, startedAt: days[change.date]?.startedAt ?? 0)
      }
      // The place is kept even when nothing was new, so the next read does not go through the
      // same samples again. A first read that saw nothing keeps no place: with read access
      // refused, Health shows Belay's own samples only, and a place past them would skip what it
      // hid. A reading waiting for its day keeps the old place until it comes.
      let stays =
        importWaits(days, today: today, now: now) || (foreign.isEmpty && settings.anchor == nil)
      if !stays { settings.anchor = anchor }
      try Rows.putSingle(db, "healthSettings", settings)
      return changes.count
    }
  }

  /// Every day's weigh-in, a deleted day's included.
  public func weights() throws -> [WeightRow] {
    try writer.read { try BodyRows.all(WeightRow.self, $0, "weights") }
  }

  /// What Health holds for `key` (a `sessionKey` or a `weighingKey`) once it answered.
  public func recordHealthWritten(_ key: String, _ value: HealthWritten) throws {
    try writer.write { try Self.putHealthWritten($0, key, value) }
  }

  /// A session's workout Health saved. A save replaces the workout object, and the effort related
  /// to the one replaced does not follow, so in the same write the effort is no longer related:
  /// the run relates it to the new workout.
  public func recordWorkoutWritten(workoutId: String, _ value: HealthWritten) throws {
    try writer.write { db in
      try Self.putHealthWritten(db, sessionKey(workoutId), value)
      guard var effort = try Self.effort(db, workoutId: workoutId), effort.relatedAt != nil
      else { return }
      effort.relatedAt = nil
      try db.execute(
        sql: "UPDATE efforts SET row = ? WHERE workoutId = ?",
        arguments: [Rows.encode(effort), workoutId])
    }
  }

  private static func putHealthWritten(_ db: Database, _ key: String, _ value: HealthWritten)
    throws
  {
    try db.execute(
      sql: "INSERT OR REPLACE INTO healthWritten (key, row) VALUES (?, ?)",
      arguments: [key, Rows.encode(value)])
  }

  public func healthWritten() throws -> [String: HealthWritten] {
    try writer.read { db in
      var written: [String: HealthWritten] = [:]
      for row in try Row.fetchAll(db, sql: "SELECT key, row FROM healthWritten") {
        written[row["key"]] = try Rows.decode(HealthWritten.self, row["row"])
      }
      return written
    }
  }

  /// What Health holds for `key`, read inside an observation.
  public static func healthWritten(_ db: Database, key: String) throws -> HealthWritten? {
    try Data.fetchOne(db, sql: "SELECT row FROM healthWritten WHERE key = ?", arguments: [key])
      .map { try Rows.decode(HealthWritten.self, $0) }
  }
}
