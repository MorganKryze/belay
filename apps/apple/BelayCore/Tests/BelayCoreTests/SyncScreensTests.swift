import Foundation
import GRDB
import Synchronization
import Testing

@testable import BelayCore

// What another device did reaches the screens: once the engine lands a pull, each screen's
// observed read gives the new value within a second.

/// The last value an observation gave, readable from the test while the observation runs.
final class Latest<T: Sendable>: Sendable {
  private let value = Mutex<T?>(nil)
  func set(_ new: T) { value.withLock { $0 = new } }
  var now: T? { value.withLock { $0 } }
}

/// Follows `fetch` on `store` from now on, keeping its last value.
func follow<T: Sendable>(
  _ store: AccountStore, _ fetch: @escaping @Sendable (Database) throws -> T
) -> (Latest<T>, Task<Void, Never>) {
  let latest = Latest<T>()
  let task = Task {
    do {
      for try await value in store.observe(fetch) { latest.set(value) }
    } catch {
      Issue.record("the observation failed: \(error)")
    }
  }
  return (latest, task)
}

/// Whether `condition` holds within `limit`, checked every millisecond.
func within(_ limit: Duration, _ condition: () -> Bool) async throws -> Bool {
  let clock = ContinuousClock()
  let end = clock.now.advanced(by: limit)
  while clock.now < end {
    if condition() { return true }
    try await Task.sleep(for: .milliseconds(1))
  }
  return condition()
}

@Suite struct SyncScreensTests {
  let store: AccountStore
  /// Ended on this phone the day before, then deleted on the web.
  let kept = Fixture.id(0)
  /// Done on the web this morning.
  let fresh = Fixture.id(1)
  /// A program on the account, activated on the web.
  let program = ProgramRow(
    id: Fixture.id(7), name: "Mine", nameAt: nil,
    schedule: Schedule(mode: .rotation, days: [nil, nil, nil, nil, nil, nil, nil]),
    scheduleAt: nil, removed: false, removedAt: nil)
  let push: ProgramSessionRow
  static let now = Fixture.t0.addingTimeInterval(24 * 3600)
  static let utc = TimeZone(identifier: "UTC")!

  init() throws {
    store = try AccountStore.inMemory(userId: "u1")
    push = ProgramSessionRow(
      id: Fixture.id(8), name: "Push", nameAt: nil, programId: program.id, position: 0,
      placeAt: nil, removed: false, removedAt: nil)
    let slot = ProgramSlotRow(
      id: Fixture.id(9), sessionId: push.id, position: 0, positionAt: nil,
      exerciseId: Fixture.slot.exerciseId, measure: nil, exerciseAt: nil, repRange: [8, 12],
      repsAt: nil, sets: 3, setsAt: nil, rirTarget: [1, 2], rirAt: nil, restSec: 120, restAt: nil,
      warmupSets: 0, warmupsAt: nil, isMain: true, mainAt: nil, groupKey: nil, groupAt: nil,
      rule: nil, ruleAt: nil, removed: false, removedAt: nil)
    _ = try store.startWorkout(Fixture.start(kept), now: Fixture.t0)
    _ = try store.recordSet(
      Fixture.set(kept, at: 1), at: Fixture.time(1), active: Fixture.active(kept))
    try store.recordChanges(
      [.workout(WorkoutChange(id: kept, at: Fixture.time(30), edit: .ended(Fixture.time(30))))],
      active: .clear)
    try store.applyServer(
      sent: try store.outbox(limit: nil),
      response: Fixture.response(programs: [program], programSessions: [push], programSlots: [slot]))
  }

  /// The three reads the screens follow: Accueil's state, the history's weeks and the two past
  /// sessions, each as its screen reads it.
  private struct Screens: Sendable, Equatable {
    var accueil: AccueilState
    var weeks: [HistoryWeek]
    var kept: PastSession?
    var fresh: PastSession?
  }

  @Test func aPullFromAnotherDeviceReachesEachScreenWithinASecond() async throws {
    let (kept, fresh) = (kept, fresh)
    let (screens, watch) = follow(store) { db in
      let history = try AccountStore.history(db)
      let efforts = try AccountStore.efforts(db)
      return Screens(
        accueil: accueilState(
          history: history, programs: try AccountStore.programs(db),
          activities: try AccountStore.activities(db), efforts: efforts, now: Self.now,
          timeZone: Self.utc),
        weeks: historyWeeks(history, efforts: efforts, now: Self.now, timeZone: Self.utc),
        kept: try AccountStore.pastSession(db, workoutId: kept),
        fresh: try AccountStore.pastSession(db, workoutId: fresh))
    }
    defer { watch.cancel() }
    #expect(try await within(.seconds(1)) { screens.now?.kept != nil })
    let before = try #require(screens.now)
    #expect(before.weeks.flatMap(\.rows).map(\.workoutId) == [kept])
    #expect(before.fresh == nil)
    guard case .next = before.accueil else {
      Issue.record("Accueil before the pull: \(before.accueil)")
      return
    }

    // The web deleted yesterday's session, kept one this morning and activated its program.
    let day = 24.0 * 60
    let deleted = Fixture.workoutRow(kept, ended: Fixture.time(30), removed: true)
    let done = Fixture.workoutRow(fresh, startedAt: day - 60, ended: Fixture.time(day - 30))
    let set = SetRow(
      id: Fixture.id(day - 50), workoutId: fresh, slotIndex: 0, position: 3,
      exerciseId: Fixture.slot.exerciseId, warmup: false, weightKg: 70, reps: 8, seconds: nil,
      rir: 2, doneAt: Fixture.time(day - 50), fieldsAt: Fixture.time(day - 50), removed: false,
      removedAt: nil)
    let pointer = ActiveProgramRow(programId: program.id, at: Fixture.time(day - 90))
    let transport = ScriptedTransport { _, _ in
      var answer = Fixture.response(cursor: "2", workouts: [deleted, done], sets: [set])
      answer.activeProgram = pointer
      return .ok(answer)
    }
    await SyncEngine(userId: "u1", store: store, transport: transport, onLanded: {}).sync()
    #expect(try store.cursor() == "2")

    let landed = try await within(.seconds(1)) {
      guard let now = screens.now else { return false }
      guard case .doneToday(let card, let next) = now.accueil else { return false }
      return card.workoutId == fresh && next?.sessionId == push.id
        && now.weeks.flatMap(\.rows).map(\.workoutId) == [fresh]
        && now.kept == nil && now.fresh?.workSets == 1
    }
    #expect(landed, "the screens after the pull: \(String(describing: screens.now))")
  }
}
