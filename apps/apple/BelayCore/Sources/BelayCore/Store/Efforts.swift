import Foundation
public import GRDB

/// How hard a session felt, given on its summary: a floor from 1 to 5, or none. The server keeps
/// no such field, so it stays on this phone and is never queued. `settled` once the summary is
/// left, so a later step (the export to Health) only takes efforts the person is done with;
/// `relatedAt` when that step took it.
public struct SessionEffort: Codable, Sendable, Equatable {
  public let workoutId: String
  public var floor: Int?
  public var settled: Bool
  public var relatedAt: String?

  public init(workoutId: String, floor: Int?, settled: Bool, relatedAt: String?) {
    self.workoutId = workoutId
    self.floor = floor
    self.settled = settled
    self.relatedAt = relatedAt
  }

  public static let floors = 1...5
}

extension AccountStore {
  /// Gives, changes or clears (nil) the effort of `workoutId`. A floor off 1...5 writes nothing.
  public func giveEffort(workoutId: String, floor: Int?) throws {
    if let floor, !SessionEffort.floors.contains(floor) { throw StoreError.invalidEffort }
    try update(workoutId) { $0.floor = floor }
  }

  /// The summary was left: the effort, given or not, is final.
  public func settleEffort(workoutId: String) throws {
    try update(workoutId) { $0.settled = true }
  }

  public func markEffortRelated(workoutId: String, at: String) throws {
    try update(workoutId) { $0.relatedAt = at }
  }

  public func effort(workoutId: String) throws -> SessionEffort? {
    try writer.read { try Self.effort($0, workoutId: workoutId) }
  }

  public func efforts() throws -> [SessionEffort] {
    try writer.read(Self.efforts)
  }

  public static func effort(_ db: Database, workoutId: String) throws -> SessionEffort? {
    try Data.fetchOne(db, sql: "SELECT row FROM efforts WHERE workoutId = ?", arguments: [workoutId])
      .map { try Rows.decode(SessionEffort.self, $0) }
  }

  public static func efforts(_ db: Database) throws -> [SessionEffort] {
    try Data.fetchAll(db, sql: "SELECT row FROM efforts ORDER BY workoutId")
      .map { try Rows.decode(SessionEffort.self, $0) }
  }

  /// One write: the row read, changed and put back, so two edits never lose each other.
  private func update(_ workoutId: String, _ change: @Sendable (inout SessionEffort) -> Void) throws {
    try writer.write { db in
      var effort =
        try Self.effort(db, workoutId: workoutId)
        ?? SessionEffort(workoutId: workoutId, floor: nil, settled: false, relatedAt: nil)
      change(&effort)
      try db.execute(
        sql: "INSERT OR REPLACE INTO efforts (workoutId, row) VALUES (?, ?)",
        arguments: [workoutId, Rows.encode(effort)])
    }
  }
}
