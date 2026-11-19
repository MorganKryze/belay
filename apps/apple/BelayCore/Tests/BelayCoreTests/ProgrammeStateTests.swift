import Foundation
import Testing

@testable import BelayCore

// Séances' Programme segment: the week on fixed days, the sessions in the order they come with
// one mark at most, the rhythm, and nothing but the empty program when none is active.

@Suite struct ProgrammeStateTests {
  private func state(
    _ workouts: [WorkoutRow] = [], programs: StoredPrograms = Days.rotation, now: Date
  ) -> ProgrammeState {
    programmeState(
      history: History(workouts: workouts, sets: []), programs: programs, activities: [],
      now: now, timeZone: Days.paris)
  }

  private let thursday = Days.at("2026-11-12T10:00")
  private let wednesday = Days.at("2026-11-11T10:00")

  private func marks(_ s: ProgrammeState) -> [String: SessionRowState.Mark?] {
    Dictionary(uniqueKeysWithValues: s.sessions.map { ($0.code, $0.mark) })
  }

  // MARK: Rotation

  /// A rotation draws no week; its sessions start from the next one, and the rhythm names its
  /// letters.
  @Test func rotationHasNoWeek() {
    let yesterday = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-11T10:00"))
    let s = state([yesterday], now: thursday)
    #expect(s.program?.id == Days.rotation.activeId)
    #expect(s.week == nil && s.perWeek == nil)
    #expect(s.rhythm == .rotation(letters: ["A", "B", "C"]))
    #expect(s.sessions.map(\.code) == ["B", "C", "A"])
    #expect(marks(s) == ["B": .next, "C": nil, "A": nil])
    let c = Days.session(Days.rotation, "C")
    let row = s.sessions[1]
    #expect(row.sessionId == Days.c && row.days == [])
    let plan = planFor(c, activities: [], date: "2026-11-12")
    #expect(row.exercises == plan.count && row.minutes == estimatedMinutes(plan))
  }

  /// The session done today is marked so; the next one keeps its own mark.
  @Test func doneTodayMarked() {
    let done = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-12T08:00"))
    #expect(marks(state([done], now: thursday)) == ["B": .next, "C": nil, "A": .doneToday])
  }

  /// The open session's row says it runs, and that mark wins over any other on the row.
  @Test func runningMarkWins() {
    let done = Days.workout("w1", "A", Days.a, start: Days.at("2026-11-11T08:00"))
    let open = Days.workout("w2", "B", Days.b, start: Days.at("2026-11-12T09:30"), minutes: nil)
    #expect(marks(state([done, open], now: thursday)) == ["B": .running, "C": nil, "A": nil])
    let again = Days.workout("w3", "A", Days.a, start: Days.at("2026-11-12T08:00"))
    let reopen = Days.workout("w4", "A", Days.a, start: Days.at("2026-11-12T09:30"), minutes: nil)
    #expect(marks(state([again, reopen], now: thursday))["A"] == .running)
  }

  // MARK: Fixed week

  /// Seven days, Monday first, each with its session or a rest, today circled; the counts and
  /// the rhythm follow the week.
  @Test func fixedWeekAndItsCounts() throws {
    let s = state(programs: Days.fixed, now: thursday)
    let week = try #require(s.week)
    #expect(week.map(\.day) == (9...15).map { "2026-11-\(String(format: "%02d", $0))" })
    #expect(week.map(\.weekday) == Array(0...6))
    #expect(week.map { $0.session?.code } == ["A", nil, "B", nil, "C", nil, nil])
    #expect(week.map(\.isToday) == [false, false, false, true, false, false, false])
    #expect(s.perWeek == PerWeek(sessions: 3, rest: 4))
    #expect(s.rhythm == .fixed(sessions: 3))
    #expect(s.sessions.map(\.code) == ["C", "A", "B"])
    #expect(s.sessions.map(\.days) == [[4], [0], [2]])
  }

  /// On a rest day the next session day is tomorrow: « Demain »; on its own day, the next.
  @Test func tomorrowOrNextOnFixedDays() {
    #expect(marks(state(programs: Days.fixed, now: thursday)) == ["C": .tomorrow, "A": nil, "B": nil])
    #expect(marks(state(programs: Days.fixed, now: wednesday)) == ["B": .next, "C": nil, "A": nil])
    let monday = Days.at("2026-11-09T10:00")
    #expect(marks(state(programs: Days.fixed, now: monday))["A"] == .next)
  }

  /// Today's session done: marked done today, and the next session day leads.
  @Test func fixedDoneTodayMarked() {
    let done = Days.workout("w1", "B", Days.b, start: Days.at("2026-11-11T08:00"))
    let s = state([done], programs: Days.fixed, now: wednesday)
    #expect(s.sessions.map(\.code) == ["C", "A", "B"])
    #expect(marks(s) == ["C": .next, "A": nil, "B": .doneToday])
  }

  // MARK: No program

  @Test func noProgram() {
    let s = state(programs: Days.noProgram, now: thursday)
    #expect(s.program == nil && s.week == nil && s.perWeek == nil && s.sessions.isEmpty)
    #expect(s.rhythm == .rotation(letters: []))
  }

  /// A removed active program is no program.
  @Test func removedProgramIsNone() {
    var p = Days.rotation
    p.programs[0].removed = true
    #expect(state(programs: p, now: thursday).program == nil)
  }
}
