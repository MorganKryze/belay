public import Foundation
import GRDB
import os

// Brings Apple Health in line with the store: the plan decides which workouts and weigh-ins to
// write or remove, Health answers object by object, and only what it confirmed is recorded, so a
// run cut short starts again where it was. Then the efforts the person is done with go to the
// workouts Health holds, and after a landed sync the scale's weigh-ins and the week's steps come
// in. Health itself stays behind `HealthWriting`, so all of this runs in tests. Activities are
// never written to Health: only sessions and weigh-ins are.

/// Whether iOS lets the app write one type. It never tells whether the app may read.
public enum HealthPermission: Sendable, Equatable { case undetermined, denied, allowed }

/// What iOS allows: Health on this device at all, then writing workouts, their effort and
/// weigh-ins.
public struct HealthAccess: Sendable, Equatable {
  public var available: Bool
  public var workouts: HealthPermission
  public var effort: HealthPermission
  public var weighIns: HealthPermission

  public init(
    available: Bool, workouts: HealthPermission, effort: HealthPermission,
    weighIns: HealthPermission = .undetermined
  ) {
    self.available = available
    self.workouts = workouts
    self.effort = effort
    self.weighIns = weighIns
  }
}

/// Health's answer to one object.
public enum HealthOutcome: String, Sendable { case written, removed, overlap, denied, unavailable, failed }

public enum HealthType: Sendable, Hashable { case workouts, effort, bodyMass, stepCount }

/// The request made when a switch goes on. A request naming a type only to read takes back the
/// right to write it, so it always names every written type; workouts are read for the overlap
/// check, body mass and the step count for the imports.
public enum HealthAccessRequest {
  public static let share: Set<HealthType> = [.workouts, .effort, .bodyMass]
  public static let read: Set<HealthType> = [.workouts, .bodyMass, .stepCount]
}

/// Apple Health as the run uses it. Times in ms since the epoch.
public protocol HealthWriting: Sendable {
  func access() async -> HealthAccess
  func authorize() async throws
  /// Saves the workout of `w` under `syncId`, replacing one of a lower version.
  func save(_ w: HealthObject, syncId: String) async -> HealthOutcome
  /// Deletes this app's workout, or effort score (`healthEffortSyncId`), under `syncId`; none
  /// left to delete is `.removed` too.
  func delete(syncId: String) async -> HealthOutcome
  /// Whether another source's workout covers at least half of the span.
  func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool
  /// Relates one effort score, saved under `effortSyncId`, to this app's workout under `syncId`.
  /// A score already saved under `effortSyncId` goes first, so a try that failed halfway, or one
  /// the store did not record, never leaves a second score in Health.
  func relateEffort(score: Int, syncId: String, effortSyncId: String) async -> HealthOutcome
  /// Saves a weigh-in as a body-mass sample at `at` under `syncId`, replacing one of a lower
  /// version.
  func saveWeighIn(kg: Double, at: Int64, syncId: String, version: Int64) async -> HealthOutcome
  /// Deletes this app's weigh-in under `syncId`; none left to delete is `.removed` too.
  func deleteWeighIn(syncId: String) async -> HealthOutcome
  /// Body-mass samples from `since` that Health received after `anchor` (nil: from the start),
  /// with the place to go on from. Nil when Health could not be read.
  func readWeighIns(anchor: String?, since: Int64) async
    -> (samples: [HealthSample], anchor: String)?
  /// Each day's step total (`YYYY-MM-DD` in `timeZone`), as Health sums it across the iPhone and
  /// the watch; nil for a day with no samples. Nil when Health could not be read.
  func readDaySteps(days: [String], timeZone: TimeZone) async -> [String: Double?]?
}

/// The effort score of a session: one per session, so a retry replaces it. Like its workout's
/// (`sessionKey`, as the web writes it), it needs no account's tag: a session's id is unique.
public func healthEffortSyncId(_ id: String) -> String { "belay-effort-\(id)" }

/// What the record keeps once Health answered; nil leaves the object for the next run.
func afterOutcome(_ o: HealthObject, _ outcome: HealthOutcome, kept: HealthWritten?)
  -> HealthWritten?
{
  let version = kept?.version ?? 0
  switch (outcome, o) {
  case (.written, .workout(_, let startedAt, let endedAt, let written)):
    return .workout(version: written, startedAt: startedAt, endedAt: endedAt)
  case (.written, .weighing(_, _, let kg, _, let written)):
    return .weighing(version: written, kg: kg)
  case (.removed, _): return .removed(version: version)
  case (.overlap, .workout(_, let startedAt, let endedAt, _)):
    return .skipped(version: version, startedAt: startedAt, endedAt: endedAt)
  default: return nil
  }
}

private let log = Logger(subsystem: "cloud.libresoftware.belay", category: "health")

/// One run for the account of `store`, whose `ownerOf` is `owner`, where the person is in
/// `timeZone`. Off, or Health unavailable: not one call that writes. `imports` after a landed sync
/// only: the phone then holds what the other devices wrote, so a day's steps typed on the web is
/// seen before Health's figure could replace it (R4). The caller runs one at a time (`HealthRuns`);
/// cancelled, the run stops before the next object. Returns how many weigh-ins and days of
/// steps it imported, which the sync then sends.
@discardableResult
public func runHealth(
  store: AccountStore, writer: any HealthWriting, owner: String, now: Date,
  timeZone: TimeZone = .current, imports: Bool = false
) async -> Int {
  do {
    return try await HealthRun(
      store: store, writer: writer, owner: owner, now: now, timeZone: timeZone
    ).run(imports: imports)
  } catch {
    log.error("health run stopped: \(AccountStore.logLabel(error), privacy: .public)")
    return 0
  }
}

private struct HealthRun {
  let store: AccountStore
  let writer: any HealthWriting
  let owner: String
  let now: Date
  let timeZone: TimeZone

  func run(imports: Bool) async throws -> Int {
    let settings = try store.healthSettings()
    guard settings.on else { return 0 }
    let access = await writer.access()
    guard access.available else { return 0 }
    let written = try await write(settings: settings, access: access)
    if access.effort == .allowed {
      try await relateEfforts(settings: settings, written: written)
    }
    guard imports, !Task.isCancelled else { return 0 }
    let weighIns = try await importWeighIns()
    guard !Task.isCancelled else { return weighIns }
    // The weigh-ins are stored by now: a failed steps write must not hide them from the sync.
    do {
      return weighIns + (try await importSteps())
    } catch {
      log.error("steps import stopped: \(AccountStore.logLabel(error), privacy: .public)")
      return weighIns
    }
  }

  /// The plan, object by object; what Health holds once it answered.
  private func write(settings: HealthSettings, access: HealthAccess) async throws
    -> [String: HealthWritten]
  {
    let history = try store.history()
    var written = try store.healthWritten()
    let plan = planHealth(
      HealthPlanInput(
        workouts: history.workouts, sets: history.sets, on: true,
        turnedOnAt: settings.turnedOnAt, written: written, allowed: access.workouts == .allowed,
        now: Instant.milliseconds(now), owner: owner, weights: try store.weights(),
        allowedWeighIns: access.weighIns == .allowed,
        timeZone: timeZone))
    // A type whose writing iOS withdrew during the run: the rest of it waits for a run that
    // finds it back.
    var refused = false
    var refusedWeighIns = false
    for object in plan {
      // Turned off meanwhile, or off and on again, or the account signed out: nothing more of
      // this plan goes.
      guard !Task.isCancelled, try store.healthSettings().writes == settings.writes else {
        return written
      }
      let (id, key) = Self.ids(object)
      let syncId = sessionKey(id)
      let outcome: HealthOutcome
      switch object {
      case .weighing(_, let date, let kg, let at, let version):
        guard !refusedWeighIns else { continue }
        outcome = await writer.saveWeighIn(
          kg: kg, at: at, syncId: weighingSyncId(owner: owner, date: date), version: version)
      case .weighingRemoved(_, let date):
        guard !refusedWeighIns else { continue }
        outcome = await writer.deleteWeighIn(syncId: weighingSyncId(owner: owner, date: date))
      case .workout, .workoutRemoved:
        guard !refused else { continue }
        guard
          let answer = try await writeWorkout(
            object, id: id, syncId: syncId, held: written[key], access)
        else { continue }
        outcome = answer
      }
      if let kept = afterOutcome(object, outcome, kept: written[key]) {
        if case .workout = kept {
          try store.recordWorkoutWritten(workoutId: id, kept)
        } else {
          try store.recordHealthWritten(key, kept)
        }
        written[key] = kept
      }
      if outcome == .denied {
        log.info("health refused a type")
        switch object {
        case .weighing, .weighingRemoved: refusedWeighIns = true
        case .workout, .workoutRemoved: refused = true
        }
      }
      if outcome == .failed || outcome == .unavailable {
        log.info("health answered \(outcome.rawValue, privacy: .public)")
      }
    }
    return written
  }

  private func writeWorkout(
    _ object: HealthObject, id: String, syncId: String, held kept: HealthWritten?,
    _ access: HealthAccess
  ) async throws -> HealthOutcome? {
    switch object {
    case .workout(_, let startedAt, let endedAt, _):
      // Only a session Health does not hold yet is looked at: one already written follows its
      // edits, or skipping it would leave the old workout in Health for good.
      let held = if case .workout = kept { true } else { false }
      if !held, await writer.overlaps(startedAt: startedAt, endedAt: endedAt) { return .overlap }
      return await writer.save(object, syncId: syncId)
    case .workoutRemoved:
      let outcome = await writer.delete(syncId: syncId)
      // The effort score goes too, or it would stay in Health with no workout: tried for any
      // effort the phone holds, since one related whose mark failed sits there unmarked. Health
      // keeping it leaves the removal unrecorded, so the next run tries both again; with effort
      // access withdrawn no delete can succeed, so the removal is recorded rather than retried
      // forever.
      if outcome == .removed, access.effort == .allowed, try store.effort(workoutId: id) != nil,
        await writer.delete(syncId: healthEffortSyncId(id)) != .removed
      {
        return nil
      }
      return outcome
    case .weighing, .weighingRemoved:
      return nil
    }
  }

  /// After a landed sync, with the import on: the scale's weigh-ins since the import's place fill
  /// the days with none. A read that fails or that iOS refused takes nothing.
  private func importWeighIns() async throws -> Int {
    let settings = try store.healthSettings()
    guard settings.on, settings.importOn,
      let read = await writer.readWeighIns(anchor: settings.anchor, since: healthEarliest)
    else { return 0 }
    // Signed out while Health was read: the store is no longer the person's to write to.
    guard !Task.isCancelled else { return 0 }
    return try store.importWeighIns(
      read.samples, anchor: read.anchor, from: settings.anchor, now: now, timeZone: timeZone)
  }

  /// After a landed sync, with the steps import on: Health's totals for today and the 6 days
  /// before. A read that fails takes nothing. Returns how many days it wrote.
  private func importSteps() async throws -> Int {
    guard try store.healthSettings().stepsOn else { return 0 }
    let today = toISODate(now, timeZone: timeZone)
    let days = (0..<stepsDays).reversed().map { Day.add(today, -$0) }
    guard let totals = await writer.readDaySteps(days: days, timeZone: timeZone),
      !Task.isCancelled
    else { return 0 }
    return try store.importSteps(
      days.map { StepsTotal(date: $0, total: totals[$0] ?? nil) }, now: now, timeZone: timeZone)
  }

  /// Each effort the person is done with, given a floor, whose workout Health holds: one score of
  /// the floor × 2, once. An effort without a written workout stays on the phone.
  private func relateEfforts(settings: HealthSettings, written: [String: HealthWritten])
    async throws
  {
    for effort in try store.efforts() where effort.settled && effort.relatedAt == nil {
      guard let floor = effort.floor, case .workout = written[sessionKey(effort.workoutId)]
      else { continue }
      guard !Task.isCancelled, try store.healthSettings().writes == settings.writes else { return }
      let outcome = await writer.relateEffort(
        score: floor * 2, syncId: sessionKey(effort.workoutId),
        effortSyncId: healthEffortSyncId(effort.workoutId))
      if outcome == .written {
        try store.markEffortRelated(workoutId: effort.workoutId, at: Instant.string(now))
      } else if outcome == .denied {
        return
      }
    }
  }

  private static func ids(_ object: HealthObject) -> (id: String, key: String) {
    switch object {
    case .workout(let id, _, _, _), .workoutRemoved(let id): (id, sessionKey(id))
    case .weighing(_, let date, _, _, _), .weighingRemoved(_, let date): (date, weighingKey(date))
    }
  }
}

/// Today and the 6 days before (R4): older steps are not imported.
let stepsDays = 7

extension AccountStore {
  /// Writes the days `stepsToWrite` picks from Health's totals, each with its queued change and
  /// the note that this phone wrote it, in one write that reads the days as they stand: a value
  /// pulled while Health was read is never replaced. Turned off meanwhile, nothing is taken.
  /// Returns how many days it wrote.
  func importSteps(_ totals: [StepsTotal], now: Date, timeZone: TimeZone) throws -> Int {
    try writer.write { db in
      let settings = try Rows.single(HealthSettings.self, db, "healthSettings") ?? .off
      guard settings.on, settings.stepsOn else { return 0 }
      var rows: [String: Int?] = [:]
      for total in totals {
        if let row = try BodyRows.steps(db, date: total.date) { rows[total.date] = row.steps }
      }
      var own: [String: Int] = [:]
      for row in try Row.fetchAll(db, sql: "SELECT date, value FROM stepsWritten") {
        own[row["date"]] = row["value"]
      }
      let at = Instant.string(now)
      let writes = stepsToWrite(days: totals, rows: rows, own: own)
      try Self.writeBody(
        db, writes.map { .steps(StepsChange(date: $0.date, value: $0.value, at: at)) }, now: now,
        timeZone: timeZone)
      for write in writes {
        try BodyRows.putStepsWritten(db, date: write.date, value: write.value)
      }
      return writes.count
    }
  }
}
