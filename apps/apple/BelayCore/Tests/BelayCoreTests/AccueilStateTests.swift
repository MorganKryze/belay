import Foundation
import Testing

@testable import BelayCore

// Accueil's state, decided from the store and the local day: one state per day and store, read at
// an injected time in a given zone.

/// The starting program, its sessions and days, and sessions done, for the screen-state tests.
enum Days {
  static let paris = TimeZone(identifier: "Europe/Paris")!
  static let a = "00000000-0000-7000-8000-000000000001"
  static let b = "00000000-0000-7000-8000-000000000002"
  static let c = "00000000-0000-7000-8000-000000000003"

  /// The local time `text` (`YYYY-MM-DDTHH:mm`) names in `zone`.
  static func at(_ text: String, _ zone: TimeZone = paris) -> Date {
    let f = DateFormatter()
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = zone
    f.dateFormat = "yyyy-MM-dd'T'HH:mm"
    return f.date(from: text)!
  }

  /// The starting program in rotation (A, B, C).
  static let rotation = withSeed()

  /// No program active.
  static let noProgram = withSeed(activeId: .null)

  /// The starting program on fixed days: A on Monday, B on Wednesday, C on Friday.
  static var fixed: StoredPrograms {
    var p = withSeed()
    p.programs[0].schedule = Schedule(mode: .fixed, days: [a, nil, b, nil, c, nil, nil])
    return p
  }

  /// A session started at `start` as `session` (letter and id), ended `minutes` later, or open.
  static func workout(
    _ id: String, _ code: String, _ session: String, start: Date, minutes: Double? = 50,
    removed: Bool = false
  ) -> WorkoutRow {
    WorkoutRow(
      id: id, sessionCode: code, sessionId: .value(session), sessionName: .value("Name \(code)"),
      plan: [Fixture.slot, bench], planAt: nil, startedAt: Instant.string(start), startedAtAt: nil,
      endedAt: minutes.map { Instant.string(start.addingTimeInterval($0 * 60)) }, endedAtAt: nil,
      note: nil, noteAt: nil, exerciseNotes: [:], exerciseNotesAt: nil, removed: removed,
      removedAt: nil)
  }

  static let bench = Slot(
    exerciseId: "belay:bench", sets: 2, repRange: [6, 8], rirTarget: [1, 2], restSec: 90,
    warmupSets: 1, isMain: false, groupKey: nil)

  /// A set of `workoutId` at `slot` and `position` (warm-ups below `Bounds.maxWarmups`).
  static func set(
    _ id: String, _ workoutId: String, slot: Int = 0, position: Int = Bounds.maxWarmups,
    kg: Double = 60, reps: Int? = 8, seconds: Int? = nil, removed: Bool = false,
    at: Date = Fixture.t0
  ) -> SetRow {
    SetRow(
      id: id, workoutId: workoutId, slotIndex: slot, position: position,
      exerciseId: slot == 0 ? Fixture.slot.exerciseId : bench.exerciseId,
      warmup: position < Bounds.maxWarmups, weightKg: kg, reps: reps, seconds: seconds, rir: nil,
      doneAt: Instant.string(at), fieldsAt: Instant.string(at), removed: removed,
      removedAt: nil)
  }

  static func session(_ p: StoredPrograms, _ code: String) -> LetteredTemplate {
    rotationOf(p).first { $0.code == code }!
  }
}

@Suite struct AccueilStateTests {
  private func state(
    _ history: History = History(workouts: [], sets: []), programs: StoredPrograms = Days.rotation,
    efforts: [SessionEffort] = [], now: Date, zone: TimeZone = Days.paris
  ) -> AccueilState {
    accueilState(
      history: history, programs: programs, activities: [], efforts: efforts, now: now,
      timeZone: zone)
  }

  /// Thursday 12 November 2026, 10:00 in Paris: a rest day of the fixed week.
  private let thursday = Days.at("2026-11-12T10:00")
  private let wednesday = Days.at("2026-11-11T10:00")

  // MARK: Nothing planned

  /// With no program, a person who never kept a session is welcomed; one who did is told nothing
  /// is planned. A removed session, or one still open, was never kept.
  @Test func firstUntilASessionIsKept() {
    #expect(state(programs: Days.noProgram, now: thursday) == .first)
    let removed = Days.workout(
      "w1", "A", Days.a, start: Days.at("2026-11-01T10:00"), removed: true)
    #expect(
      state(History(workouts: [removed], sets: []), programs: Days.noProgram, now: thursday)
        == .first)
    let kept = Days.workout("w2", "A", Days.a, start: Days.at("2026-11-01T10:00"))
    #expect(
      state(History(workouts: [kept], sets: []), programs: Days.noProgram, now: thursday) == .none)
  }

  // MARK: Next, due, rest

  @Test func nextInRotation() {
    guard case .next(let card) = state(now: thursday) else {
      Issue.record("next")
      return
    }
    let a = Days.session(Days.rotation, "A")
    #expect(card.code == "A" && card.sessionId == Days.a)
    #expect(card.exercises == a.slots.count + (a.noClimbing?.count ?? 0))
    #expect(card.minutes == estimatedMinutes(card.plan))
    let yesterday = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-11T10:00"))
    guard case .next(let after) = state(History(workouts: [yesterday], sets: []), now: thursday)
    else {
      Issue.record("next after A")
      return
    }
    #expect(after.code == "B")
  }

  /// The plan of the day counts session C's no-climbing slots in a week with no climb.
  @Test func nextCardSizesTheDaysPlan() {
    let c = Days.session(Days.rotation, "C")
    let done = Days.workout("w1", "B", Days.b, start: Days.at("2026-11-10T10:00"))
    guard case .next(let card) = state(History(workouts: [done], sets: []), now: thursday) else {
      Issue.record("next")
      return
    }
    #expect(card.code == "C")
    #expect(card.plan == planFor(c, activities: [], date: "2026-11-12"))
    #expect(card.exercises == c.slots.count + (c.noClimbing?.count ?? 0))
  }

  @Test func dueOnItsFixedDay() {
    #expect(
      state(programs: Days.fixed, now: wednesday)
        == .due(
          NextCard(
            Days.session(Days.fixed, "B"), plan: planFor(
              Days.session(Days.fixed, "B"), activities: [], date: "2026-11-11")),
          weekday: 2))
  }

  /// Only a fixed week has rest days: the same Thursday in rotation offers the next session.
  @Test func restOnlyOnAFixedWeek() {
    #expect(
      state(programs: Days.fixed, now: thursday)
        == .rest(next: NextLine(Days.session(Days.fixed, "C"), day: "2026-11-13")))
    guard case .next = state(programs: Days.rotation, now: thursday) else {
      Issue.record("no rest day in rotation")
      return
    }
  }

  // MARK: Done today

  @Test func doneTodayInRotationNamesTheNext() {
    let done = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-12T08:00"))
    let s = state(
      History(workouts: [done], sets: [Days.set("s1", "w1"), Days.set("s2", "w1", position: 0)]),
      now: thursday)
    #expect(
      s
        == .doneToday(
          DoneCard(
            workoutId: "w1", code: "A", name: "Name A", on: "2026-11-12", durationMs: 50 * 60_000,
            workSets: 1, effort: nil),
          next: NextLine(Days.session(Days.rotation, "B"), day: nil)))
  }

  @Test func doneTodayOnAFixedDayNamesTheNextDay() {
    let done = Days.workout("w1", "B", Days.b, start: Days.at("2026-11-11T08:00"))
    guard
      case .doneToday(let card, let next) = state(
        History(workouts: [done], sets: []), programs: Days.fixed, now: wednesday)
    else {
      Issue.record("done today")
      return
    }
    #expect(card.workoutId == "w1" && card.on == "2026-11-11")
    #expect(next == NextLine(Days.session(Days.fixed, "C"), day: "2026-11-13"))
  }

  /// Today's session done early, on the rest day before, is today's session done: never due
  /// again, and the card says the day it counted on.
  @Test func todaysSessionDoneEarlyCountsForToday() {
    let early = Days.workout("w1", "B", Days.b, start: Days.at("2026-11-10T18:00"))
    guard
      case .doneToday(let card, let next) = state(
        History(workouts: [early], sets: []), programs: Days.fixed, now: wednesday)
    else {
      Issue.record("done for today")
      return
    }
    #expect(card.on == "2026-11-10")
    #expect(next?.day == "2026-11-13")
  }

  /// With no program, a session done today still shows, with no next line.
  @Test func doneTodayWithNoProgram() {
    let done = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-12T08:00"))
    guard
      case .doneToday(_, let next) = state(
        History(workouts: [done], sets: []), programs: Days.noProgram, now: thursday)
    else {
      Issue.record("done today")
      return
    }
    #expect(next == nil)
  }

  /// The effort shows only when this phone holds a floor for that session, never another
  /// session's, even one stored before it.
  @Test(arguments: [(Int?.some(3), Int?.some(3)), (nil, nil)])
  func effortOnlyWhenHeld(floor: Int?, shown: Int?) {
    let done = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-12T08:00"))
    let held = [
      SessionEffort(workoutId: "other", floor: 5, settled: true, relatedAt: nil),
      SessionEffort(workoutId: "w1", floor: floor, settled: true, relatedAt: nil),
    ]
    for efforts in [held, []] {
      guard
        case .doneToday(let card, _) = state(
          History(workouts: [done], sets: []), efforts: efforts, now: thursday)
      else {
        Issue.record("done today")
        return
      }
      #expect(card.effort == (efforts.isEmpty ? nil : shown))
    }
  }

  // MARK: Running

  /// An open session leads over everything, even a session done earlier today.
  @Test func runningLeads() {
    let done = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-12T07:00"))
    let open = Days.workout("w2", "B", Days.b, start: Days.at("2026-11-12T09:30"), minutes: nil)
    let history = History(
      workouts: [done, open],
      sets: [
        Days.set("s1", "w2", at: thursday), Days.set("s0", "w2", position: 0, at: thursday),
        Days.set("s2", "w2", slot: 1, at: thursday),
      ])
    #expect(
      state(history, now: thursday)
        == .running(
          OpenCard(
            workoutId: "w2", code: "B", name: "Name B", startedAt: open.startedAt,
            setsPlanned: plannedWorkSets(open.plan), setsDone: 2)))
  }

  /// A session forgotten open past six hours is not running: it waits for the sync to close it.
  @Test func aForgottenSessionDoesNotRun() {
    let open = Days.workout("w2", "B", Days.b, start: Days.at("2026-11-11T09:30"), minutes: nil)
    guard case .next = state(History(workouts: [open], sets: []), now: thursday) else {
      Issue.record("not running")
      return
    }
  }

  // MARK: The day

  /// The day turns at local midnight: a session done late at night is done today until midnight,
  /// then the next one is offered, in each zone.
  @Test(arguments: ["Europe/Paris", "America/Los_Angeles"])
  func midnightTurnsDoneIntoNext(zone: String) {
    let tz = TimeZone(identifier: zone)!
    let done = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-11T22:30", tz), minutes: 40)
    let history = History(workouts: [done], sets: [])
    guard case .doneToday = state(history, now: Days.at("2026-11-11T23:59", tz), zone: tz) else {
      Issue.record("done before midnight")
      return
    }
    guard case .next(let card) = state(history, now: Days.at("2026-11-12T00:01", tz), zone: tz)
    else {
      Issue.record("next after midnight")
      return
    }
    #expect(card.code == "B")
  }
}
