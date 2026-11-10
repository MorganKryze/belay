import Foundation
public import GRDB

/// The Santé switch of this account on this phone: off until the person turns it on, and when
/// they last did, in ms since the epoch. Only sessions ended after that moment are new to Health.
public struct HealthSettings: Codable, Sendable, Equatable {
  public var on: Bool
  public var turnedOnAt: Int64?

  public init(on: Bool, turnedOnAt: Int64?) {
    self.on = on
    self.turnedOnAt = turnedOnAt
  }

  public static let off = HealthSettings(on: false, turnedOnAt: nil)
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

  /// What Health holds for `key` (a `sessionKey`) once it answered.
  public func recordHealthWritten(_ key: String, _ value: HealthWritten) throws {
    try writer.write { db in
      try db.execute(
        sql: "INSERT OR REPLACE INTO healthWritten (key, row) VALUES (?, ?)",
        arguments: [key, Rows.encode(value)])
    }
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
