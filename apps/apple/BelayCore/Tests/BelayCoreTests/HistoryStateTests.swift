import Foundation
import Testing

@testable import BelayCore

// Historique: the sessions kept and ended, newest first, grouped by week from Monday on the local
// day; and a past session's exercises with their sets.

@Suite struct HistoryStateTests {
  static let zones = [
    "Europe/Paris", "America/Los_Angeles", "Asia/Tokyo", "Pacific/Kiritimati", "UTC",
  ]

  // MARK: Weeks

  /// A Sunday night and the Monday after fall in two weeks in every zone, across Europe's clock
  /// change (25 October) and America's (1 November).
  @Test(arguments: zones)
  func weeksStartOnMondayAcrossClockChanges(zone: String) {
    let tz = TimeZone(identifier: zone)!
    let starts = [
      "2026-10-25T23:30", "2026-10-26T00:30", "2026-11-01T23:30", "2026-11-02T00:30",
    ]
    let workouts = starts.enumerated().map { i, text in
      Days.workout("w\(i)", "A", Days.a, start: Days.at(text, tz))
    }
    let weeks = historyWeeks(
      History(workouts: workouts, sets: []), efforts: [], now: Days.at("2026-11-04T12:00", tz),
      timeZone: tz)
    #expect(weeks.map(\.start) == ["2026-11-02", "2026-10-26", "2026-10-19"])
    #expect(weeks.map(\.end) == ["2026-11-08", "2026-11-01", "2026-10-25"])
    #expect(weeks.map(\.isCurrent) == [true, false, false])
    #expect(weeks.map { $0.rows.map(\.workoutId) } == [["w3"], ["w2", "w1"], ["w0"]])
    #expect(weeks.map(\.count) == [1, 2, 1])
    #expect(weeks.map(\.durationMs) == [50, 100, 50].map { $0 * 60_000 })
    #expect(weeks[1].rows.map(\.day) == ["2026-11-01", "2026-10-26"])
    #expect(weeks.map(\.id) == weeks.map(\.start))
  }

  /// Removed sessions and the one still open are not history; a week left with none is not shown.
  @Test func removedAndOpenLeftOut() {
    let workouts = [
      Days.workout("kept", "A", Days.a, start: Days.at("2026-11-10T10:00")),
      Days.workout("gone", "B", Days.b, start: Days.at("2026-11-11T10:00"), removed: true),
      Days.workout("open", "C", Days.c, start: Days.at("2026-11-12T09:00"), minutes: nil),
      Days.workout("goneWeek", "A", Days.a, start: Days.at("2026-11-03T10:00"), removed: true),
    ]
    let weeks = historyWeeks(
      History(workouts: workouts, sets: []), efforts: [], now: Days.at("2026-11-12T10:00"),
      timeZone: Days.paris)
    #expect(weeks.map { $0.rows.map(\.workoutId) } == [["kept"]])
  }

  /// « Cette semaine » only for the week holding today; an earlier week alone is not current.
  @Test func onlyThisWeekIsCurrent() {
    let old = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-03T10:00"))
    let weeks = historyWeeks(
      History(workouts: [old], sets: []), efforts: [], now: Days.at("2026-11-12T10:00"),
      timeZone: Days.paris)
    #expect(weeks.map(\.isCurrent) == [false])
    #expect(historyWeeks(History(workouts: [], sets: []), efforts: [], now: .now, timeZone: .gmt).isEmpty)
  }

  /// Each row carries its session, its length, its volume (the summary's) and the effort only
  /// when this phone holds a floor for it.
  @Test func rowFigures() {
    let w = Days.workout("w1", "B", Days.b, start: Days.at("2026-11-10T10:00"))
    let other = Days.workout("w2", "A", Days.a, start: Days.at("2026-11-09T10:00"))
    let sets = [
      Days.set("s1", "w1", kg: 100, reps: 5), Days.set("s2", "w1", slot: 1, kg: 40, reps: 10),
      Days.set("s0", "w1", position: 0, kg: 60, reps: 5), Days.set("sx", "w1", position: 4, removed: true),
      Days.set("t1", "w1", slot: 1, position: 4, kg: 0, reps: nil, seconds: 30),
    ]
    let efforts = [
      SessionEffort(workoutId: "w1", floor: 4, settled: true, relatedAt: nil),
      SessionEffort(workoutId: "w2", floor: nil, settled: true, relatedAt: nil),
    ]
    let weeks = historyWeeks(
      History(workouts: [w, other], sets: sets), efforts: efforts,
      now: Days.at("2026-11-12T10:00"), timeZone: Days.paris)
    let rows = weeks[0].rows
    #expect(
      rows[0]
        == HistoryRow(
          workoutId: "w1", code: "B", name: "Name B", sessionId: Days.b, day: "2026-11-10",
          startedAt: w.startedAt, durationMs: 50 * 60_000, volumeKg: 900, effort: 4))
    #expect(rows[1].effort == nil && rows[1].volumeKg == 0)
  }

  /// Years of sessions group at once: 1 000 sessions, 3 sets each, under 50 ms.
  @Test func thousandSessionsUnderFiftyMilliseconds() {
    let start = Days.at("2020-01-06T10:00")
    var workouts: [WorkoutRow] = []
    var sets: [SetRow] = []
    for i in 0..<1_000 {
      let id = "w\(i)"
      workouts.append(Days.workout(id, "A", Days.a, start: start.addingTimeInterval(Double(i) * 172_800)))
      for k in 0..<3 { sets.append(Days.set("\(id)-\(k)", id, position: Bounds.maxWarmups + k)) }
    }
    let history = History(workouts: workouts.shuffled(), sets: sets.shuffled())
    var weeks: [HistoryWeek] = []
    // This thread's processor time, the best of five runs: the other suites run beside this one,
    // and the wall clock would measure them, not the grouping.
    let took = (0..<5).map { _ in
      threadTime {
        weeks = historyWeeks(
          history, efforts: [], now: Days.at("2026-11-12T10:00"), timeZone: Days.paris)
      }
    }.min()!
    #expect(weeks.reduce(0) { $0 + $1.count } == 1_000)
    #expect(took < .milliseconds(50), "took \(took)")
  }

  private func threadTime(_ body: () -> Void) -> Duration {
    var from = timespec()
    var to = timespec()
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &from)
    body()
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &to)
    return .seconds(to.tv_sec - from.tv_sec) + .nanoseconds(to.tv_nsec - from.tv_nsec)
  }

  // MARK: A past session

  /// The exercises in plan order, each with its warm-ups first, then its work sets in order; a
  /// removed set is not shown.
  @Test func pastSessionInPlanOrderWarmupsFirst() throws {
    let w = Days.workout("w1", "B", Days.b, start: Days.at("2026-11-10T10:00"))
    let sets = [
      Days.set("b1", "w1", slot: 1, position: 3, kg: 40, reps: 10),
      Days.set("a2", "w1", position: 4, kg: 100, reps: 5),
      Days.set("a1", "w1", position: 3, kg: 100, reps: 5),
      Days.set("m2", "w1", position: 1, kg: 60, reps: 5),
      Days.set("m1", "w1", position: 0, kg: 40, reps: 5),
      Days.set("ax", "w1", position: 5, removed: true),
      Days.set("other", "w2", position: 3),
    ]
    let effort = SessionEffort(workoutId: "w1", floor: 2, settled: true, relatedAt: nil)
    let past = try #require(pastSession(History(workouts: [w], sets: sets), workoutId: "w1", effort: effort))
    #expect(past.workoutId == "w1" && past.code == "B" && past.name == "Name B")
    #expect(past.startedAt == w.startedAt)
    #expect(past.durationMs == 50 * 60_000 && past.workSets == 3 && past.volumeKg == 1_400)
    #expect(past.effort == 2)
    #expect(past.exercises.map(\.slotIndex) == [0, 1])
    #expect(past.exercises.map(\.exerciseId) == [Fixture.slot.exerciseId, Days.bench.exerciseId])
    #expect(past.exercises[0].sets.map(\.setId) == ["m1", "m2", "a1", "a2"])
    #expect(past.exercises[0].sets.map(\.warmup) == [true, true, false, false])
    #expect(past.exercises[0].sets.map(\.number) == [1, 2, 1, 2])
    #expect(past.exercises[1].sets.map(\.setId) == ["b1"])
  }

  /// A timed set reads in seconds; an exercise with no set left is not shown.
  @Test func pastSessionTimedAndEmptyExercises() throws {
    let w = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-10T10:00"))
    let sets = [Days.set("t1", "w1", slot: 1, kg: 0, reps: nil, seconds: 30)]
    let past = try #require(pastSession(History(workouts: [w], sets: sets), workoutId: "w1", effort: nil))
    #expect(past.exercises.map(\.slotIndex) == [1])
    #expect(past.exercises[0].sets[0].seconds == 30 && past.exercises[0].sets[0].reps == nil)
    #expect(past.effort == nil)
  }

  /// Only a session kept and ended opens: not one removed, still open or unknown.
  @Test func pastSessionOnlyWhenKeptAndEnded() {
    let removed = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-10T10:00"), removed: true)
    let open = Days.workout("w2", "A", Days.a, start: Days.at("2026-11-12T09:00"), minutes: nil)
    let h = History(workouts: [removed, open], sets: [])
    #expect(pastSession(h, workoutId: "w1", effort: nil) == nil)
    #expect(pastSession(h, workoutId: "w2", effort: nil) == nil)
    #expect(pastSession(h, workoutId: "none", effort: nil) == nil)
  }
}
