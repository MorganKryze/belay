public import Foundation
import os

// Brings Apple Health in line with the store: the plan decides which workouts to write or
// remove, Health answers object by object, and only what it confirmed is recorded, so a run cut
// short starts again where it was. Then the efforts the person is done with go to the workouts
// Health holds. Health itself stays behind `HealthWriting`, so all of this runs in tests.

/// Whether iOS lets the app write one type. It never tells whether the app may read.
public enum HealthPermission: Sendable, Equatable { case undetermined, denied, allowed }

/// What iOS allows: Health on this device at all, then writing workouts and writing their effort.
public struct HealthAccess: Sendable, Equatable {
  public var available: Bool
  public var workouts: HealthPermission
  public var effort: HealthPermission

  public init(available: Bool, workouts: HealthPermission, effort: HealthPermission) {
    self.available = available
    self.workouts = workouts
    self.effort = effort
  }
}

/// Health's answer to one object.
public enum HealthOutcome: String, Sendable { case written, removed, overlap, denied, unavailable, failed }

public enum HealthType: Sendable, Hashable { case workouts, effort }

/// The one request made when the switch goes on. A request naming a type only to read takes back
/// the right to write it, so it always names both written types; workouts are read for the
/// overlap check.
public enum HealthAccessRequest {
  public static let share: Set<HealthType> = [.workouts, .effort]
  public static let read: Set<HealthType> = [.workouts]
}

/// Apple Health as the run uses it. Times in ms since the epoch.
public protocol HealthWriting: Sendable {
  func access() async -> HealthAccess
  func authorize() async throws
  /// Saves the workout of `w` under `syncId`, replacing one of a lower version.
  func save(_ w: HealthObject, syncId: String) async -> HealthOutcome
  /// Deletes this app's workout under `syncId`; none left to delete is `.removed` too.
  func delete(syncId: String) async -> HealthOutcome
  /// Whether another source's workout covers at least half of the span.
  func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool
  /// Relates one effort score, saved under `effortSyncId`, to this app's workout under `syncId`.
  /// A score already saved under `effortSyncId` goes first, so a try that failed halfway, or one
  /// the store did not record, never leaves a second score in Health.
  func relateEffort(score: Int, syncId: String, effortSyncId: String) async -> HealthOutcome
}

/// Health keeps one store for every app and account on the phone, so the identifier of a
/// session's workout carries the account's tag (`ownerOf`) before the session's id.
public func healthSyncId(_ id: String, owner: String) -> String {
  "belay-session-\(owner)-\(id)"
}

/// The effort score of a session, under the same tag: one per session, so a retry replaces it.
public func healthEffortSyncId(_ id: String, owner: String) -> String {
  "belay-effort-\(owner)-\(id)"
}

/// What the record keeps once Health answered; nil leaves the object for the next run.
func afterOutcome(_ o: HealthObject, _ outcome: HealthOutcome, kept: HealthWritten?)
  -> HealthWritten?
{
  let version = kept?.version ?? 0
  switch (outcome, o) {
  case (.written, .workout(_, let startedAt, let endedAt, let written)):
    return .workout(version: written, startedAt: startedAt, endedAt: endedAt)
  case (.removed, _): return .removed(version: version)
  case (.overlap, .workout(_, let startedAt, let endedAt, _)):
    return .skipped(version: version, startedAt: startedAt, endedAt: endedAt)
  default: return nil
  }
}

private let log = Logger(subsystem: "cloud.libresoftware.belay", category: "health")

/// One run for the account of `store`, whose `ownerOf` is `owner`. Off, or Health unavailable:
/// not one call that writes. The caller runs one at a time (`HealthRuns`); cancelled, the run
/// stops before the next object.
public func runHealth(store: AccountStore, writer: any HealthWriting, owner: String, now: Date)
  async
{
  do {
    try await HealthRun(store: store, writer: writer, owner: owner, now: now).run()
  } catch {
    log.error("health run stopped: \(AccountStore.logLabel(error), privacy: .public)")
  }
}

private struct HealthRun {
  let store: AccountStore
  let writer: any HealthWriting
  let owner: String
  let now: Date

  func run() async throws {
    let settings = try store.healthSettings()
    guard settings.on else { return }
    let access = await writer.access()
    guard access.available else { return }
    let history = try store.history()
    var written = try store.healthWritten()
    let plan = planHealth(
      HealthPlanInput(
        workouts: history.workouts, sets: history.sets, on: true,
        turnedOnAt: settings.turnedOnAt, written: written, allowed: access.workouts == .allowed,
        now: Instant.milliseconds(now), owner: owner))
    for object in plan {
      // Turned off meanwhile, or off and on again, or the account signed out: nothing more of
      // this plan goes.
      guard !Task.isCancelled, try store.healthSettings() == settings else { return }
      let (id, key) = Self.ids(object)
      let syncId = healthSyncId(id, owner: owner)
      let outcome: HealthOutcome
      switch object {
      case .workout(_, let startedAt, let endedAt, _):
        // Only a session Health does not hold yet is looked at: one already written follows its
        // edits, or skipping it would leave the old workout in Health for good.
        let held = if case .workout = written[key] { true } else { false }
        if !held, await writer.overlaps(startedAt: startedAt, endedAt: endedAt) {
          outcome = .overlap
        } else {
          outcome = await writer.save(object, syncId: syncId)
        }
      case .workoutRemoved:
        outcome = await writer.delete(syncId: syncId)
      }
      if let kept = afterOutcome(object, outcome, kept: written[key]) {
        if case .workout = kept {
          try store.recordWorkoutWritten(workoutId: id, kept)
        } else {
          try store.recordHealthWritten(key, kept)
        }
        written[key] = kept
      }
      // Write access withdrawn in iOS: the rest waits for a run that finds it back.
      if outcome == .denied {
        log.info("health refused workouts")
        break
      }
      if outcome == .failed || outcome == .unavailable {
        log.info("health answered \(outcome.rawValue, privacy: .public)")
      }
    }
    guard access.effort == .allowed else { return }
    try await relateEfforts(settings: settings, written: written)
  }

  /// Each effort the person is done with, given a floor, whose workout Health holds: one score of
  /// the floor × 2, once. An effort without a written workout stays on the phone.
  private func relateEfforts(settings: HealthSettings, written: [String: HealthWritten])
    async throws
  {
    for effort in try store.efforts() where effort.settled && effort.relatedAt == nil {
      guard let floor = effort.floor, case .workout = written[sessionKey(effort.workoutId)]
      else { continue }
      guard !Task.isCancelled, try store.healthSettings() == settings else { return }
      let outcome = await writer.relateEffort(
        score: floor * 2, syncId: healthSyncId(effort.workoutId, owner: owner),
        effortSyncId: healthEffortSyncId(effort.workoutId, owner: owner))
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
    }
  }
}
