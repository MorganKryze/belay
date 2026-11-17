import Foundation
import Testing

@testable import BelayCore

// One Health run at a time for the open store: signing out stops it between two objects, and a
// trigger for the next account's store during it gives that store its own run after it.

/// Health whose first save waits until the test lets it go, recording what it saved.
private actor HeldHealth: HealthWriting {
  private(set) var saved: [String] = []
  private var held: CheckedContinuation<Void, Never>?
  private var saving: CheckedContinuation<Void, Never>?
  private var first = true

  func access() async -> HealthAccess {
    HealthAccess(available: true, workouts: .allowed, effort: .allowed)
  }

  func authorize() async throws {}

  func save(_ w: HealthObject, syncId: String) async -> HealthOutcome {
    if first {
      first = false
      saving?.resume()
      await withCheckedContinuation { held = $0 }
    }
    saved.append(syncId)
    return .written
  }

  func delete(syncId: String) async -> HealthOutcome { .removed }

  func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool { false }

  func relateEffort(score: Int, syncId: String, effortSyncId: String) async -> HealthOutcome {
    .written
  }

  func saveWeighIn(kg: Double, at: Int64, syncId: String, version: Int64) async -> HealthOutcome {
    .written
  }

  func deleteWeighIn(syncId: String) async -> HealthOutcome { .removed }

  func readWeighIns(anchor: String?, since: Int64) async -> (
    samples: [HealthSample], anchor: String
  )? { nil }

  func readDaySteps(days: [String], timeZone: TimeZone) async -> [String: Double?]? { nil }

  /// Returns once the first save is under way.
  func firstSaveStarted() async {
    if !first { return }
    await withCheckedContinuation { saving = $0 }
  }

  func letGo() { held?.resume() }
}

/// Health whose weigh-in read waits until the test lets it go, then hands out one reading.
private actor HeldReader: HealthWriting {
  private var held: CheckedContinuation<Void, Never>?
  private var reading: CheckedContinuation<Void, Never>?
  private var started = false

  func access() async -> HealthAccess {
    HealthAccess(available: true, workouts: .allowed, effort: .allowed, weighIns: .allowed)
  }

  func authorize() async throws {}

  func save(_ w: HealthObject, syncId: String) async -> HealthOutcome { .written }

  func delete(syncId: String) async -> HealthOutcome { .removed }

  func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool { false }

  func relateEffort(score: Int, syncId: String, effortSyncId: String) async -> HealthOutcome {
    .written
  }

  func saveWeighIn(kg: Double, at: Int64, syncId: String, version: Int64) async -> HealthOutcome {
    .written
  }

  func deleteWeighIn(syncId: String) async -> HealthOutcome { .removed }

  func readWeighIns(anchor: String?, since: Int64) async -> (
    samples: [HealthSample], anchor: String
  )? {
    started = true
    reading?.resume()
    await withCheckedContinuation { held = $0 }
    let at = Instant.milliseconds(Fixture.t0.addingTimeInterval(-3600))
    return ([HealthSample(startedAt: at, kg: 79.6, syncId: nil)], "anchor-1")
  }

  /// Returns once the read is under way.
  func readStarted() async {
    if started { return }
    await withCheckedContinuation { reading = $0 }
  }

  func letGo() { held?.resume() }

  func readDaySteps(days: [String], timeZone: TimeZone) async -> [String: Double?]? { nil }
}

@MainActor @Suite struct HealthRunsTests {
  let now = Fixture.t0.addingTimeInterval(2 * 3600)
  let a = Fixture.id(0)
  let b = Fixture.id(60)
  let c = Fixture.id(120)

  /// A store with the switch on and `ids` finished, each half an hour, an hour apart.
  private func store(_ userId: String, _ ids: [String]) throws -> AccountStore {
    let store = try AccountStore.inMemory(userId: userId)
    try store.setHealthOn(true, now: Fixture.t0.addingTimeInterval(-600))
    for (i, id) in ids.enumerated() {
      let start = Double(i * 60)
      _ = try store.startWorkout(
        Fixture.start(id, at: start), now: Fixture.t0.addingTimeInterval(start * 60))
      _ = try store.recordSet(
        Fixture.set(id, at: start + 1), at: Fixture.time(start + 1), active: Fixture.active(id))
      let end = Fixture.time(start + 30)
      try store.recordChanges(
        [.workout(WorkoutChange(id: id, at: end, edit: .ended(end)))], active: .clear)
    }
    return store
  }

  @Test func signingOutStopsTheRunBetweenObjects() async throws {
    let old = try store("user-1", [a, b])
    let health = HeldHealth()
    let now = now
    let runs = HealthRuns(writer: health, now: { now })

    runs.trigger(store: old, owner: ownerOf("user-1"))
    await health.firstSaveStarted()
    runs.cancel()
    await health.letGo()
    await runs.idle()

    let saved = await health.saved
    #expect(saved == [sessionKey(a)])
  }

  @Test func aTriggerForTheNextStoreDuringTheRunGivesItARun() async throws {
    let old = try store("user-1", [a, b])
    let new = try store("user-2", [c])
    let health = HeldHealth()
    let now = now
    let runs = HealthRuns(writer: health, now: { now })

    runs.trigger(store: old, owner: ownerOf("user-1"))
    await health.firstSaveStarted()
    runs.cancel()
    runs.trigger(store: new, owner: ownerOf("user-2"))
    await health.letGo()
    await runs.idle()

    let saved = await health.saved
    #expect(saved.count == 2)
    #expect(saved.last == sessionKey(c))
  }

  @Test func aTriggerDuringARunGivesOneMoreRun() async throws {
    let one = try store("user-1", [a])
    let health = HeldHealth()
    let now = now
    let runs = HealthRuns(writer: health, now: { now })

    runs.trigger(store: one, owner: ownerOf("user-1"))
    await health.firstSaveStarted()
    try one.recordChanges(
      [
        .workout(
          WorkoutChange(id: a, at: Fixture.time(40), edit: .ended(Fixture.time(35))))
      ], active: .keep)
    runs.trigger(store: one, owner: ownerOf("user-1"))
    runs.trigger(store: one, owner: ownerOf("user-1"))
    await health.letGo()
    await runs.idle()

    // The second run saves the edit the first one could not see; the third trigger adds nothing.
    let saved = await health.saved
    #expect(saved.count == 2)
  }

  @Test func signingOutDuringTheReadImportsNothing() async throws {
    let one = try store("user-1", [])
    try one.setHealthImportOn(true)
    let health = HeldReader()
    let now = now
    let runs = HealthRuns(writer: health, now: { now })
    var told = false
    runs.imported = { told = true }

    runs.trigger(store: one, owner: ownerOf("user-1"), imports: true)
    await health.readStarted()
    runs.cancel()
    await health.letGo()
    await runs.idle()

    #expect(try one.body().weights.isEmpty)
    #expect(!told)
  }
}
