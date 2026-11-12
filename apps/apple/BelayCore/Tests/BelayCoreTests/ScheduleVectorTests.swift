import BelayCore
import Foundation
import Testing

// The schedule rules Accueil and Séances read, checked over the cases the shared TypeScript rules
// computed (`pnpm vectors`). Imported without `@testable`, so each rule is checked as the app
// calls it.

/// A session a rule picks, by its letter and the session it comes from.
private struct Picked: Codable, Sendable, Equatable {
  let code: String
  let sessionId: String
}
private func picked(_ template: LetteredTemplate?) -> Picked? {
  template.map { Picked(code: $0.code, sessionId: $0.sessionId) }
}

/// A day's plan, flat as the vectors write it: its kind, its session and workout, the next
/// session and, off rotation, that session's day.
private struct PlanResult: Decodable, Sendable, Equatable {
  var kind: String
  var session: Picked?
  var workout: String?
  var on: String?
  var next: Picked?
  var nextDay: String?

  init(kind: String, session: Picked? = nil, workout: String? = nil, on: String? = nil,
    next: Picked?, nextDay: String? = nil)
  {
    self.kind = kind
    self.session = session
    self.workout = workout
    self.on = on
    self.next = next
    self.nextDay = nextDay
  }

  init(_ plan: DayPlan) {
    switch plan {
    case .rotation(let next):
      self.init(kind: "rotation", next: picked(next))
    case .due(let session, let next):
      self.init(
        kind: "due", session: picked(session), next: picked(next.session), nextDay: next.day)
    case .done(let session, let workout, let on, let next):
      self.init(
        kind: "done", session: picked(session), workout: workout.id, on: on,
        next: picked(next.session), nextDay: next.day)
    case .rest(let next):
      self.init(kind: "rest", next: picked(next.session), nextDay: next.day)
    }
  }
}

private struct ReadFile: Decodable, Sendable {
  struct DayPlanCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let timeZone: String
    let program: String
    let activeAt: String?
    let workouts: [WorkoutRow]
    let today: String
    let result: PlanResult
    var testDescription: String { name }
  }
  struct FixedWeekCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Days: Decodable, Sendable {
      let sessionId: String
      let days: [Int]
    }
    struct Result: Decodable, Sendable {
      let week: [Picked?]
      let sessionDays: Int
      let daysOf: [Days]
    }
    let name: String
    let program: String
    let result: Result?
    var testDescription: String { name }
  }
  struct WeekOrderCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Card: Decodable, Sendable, Equatable {
      let session: Picked
      let next: String?
      let days: [Int]
    }
    let name: String
    let timeZone: String
    let program: String
    let workouts: [WorkoutRow]
    let today: String
    let result: [Card]?
    var testDescription: String { name }
  }
  struct HistoryVector: Decodable, Sendable {
    let workouts: [WorkoutRow]
    let sets: [SetRow]
    var history: History { History(workouts: workouts, sets: sets) }
  }
  struct FinishedOnCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Result: Decodable, Sendable {
      let workout: String
      let durationMs: Int
      let workSets: Int
    }
    let name: String
    let timeZone: String
    let history: HistoryVector
    let day: String
    let result: Result?
    var testDescription: String { name }
  }
  struct WorkSetsCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let history: HistoryVector
    let workoutId: String
    let result: Int
    var testDescription: String { name }
  }
  struct LastFinishedCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let workouts: [WorkoutRow]
    let session: Picked
    let result: String?
    var testDescription: String { name }
  }
  struct ProgramOrderCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let stored: StoredPrograms
    let result: [String]
    var testDescription: String { name }
  }
  struct ChooseActiveCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Change: Decodable, Sendable, Equatable {
      let kind: String
      let programId: String
      let at: String
    }
    let name: String
    let stored: StoredPrograms
    let programId: String
    let at: String
    let result: [Change]?
    var testDescription: String { name }
  }

  let programs: [String: StoredPrograms]
  let dayPlan: [DayPlanCase]
  let fixedWeek: [FixedWeekCase]
  let weekOrder: [WeekOrderCase]
  let finishedOn: [FinishedOnCase]
  let workSetsOf: [WorkSetsCase]
  let lastFinished: [LastFinishedCase]
  let programOrder: [ProgramOrderCase]
  let chooseActive: [ChooseActiveCase]

  /// The file runs to a few megabytes, so every test reads it once.
  private static let cached = Result { () throws -> ReadFile in
    guard let url = Bundle.module.url(
      forResource: "schedule", withExtension: "json", subdirectory: "Vectors")
    else { throw MissingVectors() }
    return try JSONDecoder().decode(ReadFile.self, from: Data(contentsOf: url))
  }
  static func load() throws -> ReadFile { try cached.get() }

  /// A case's program, with its own activation time.
  func stored(_ name: String, activeAt: String?) throws -> StoredPrograms {
    var p = try #require(programs[name])
    p.activeAt = activeAt
    return p
  }
}

private struct MissingVectors: Error {}

struct ScheduleVectorTests {
  @Test(arguments: try ReadFile.load().dayPlan)
  fileprivate func dayPlan(_ c: ReadFile.DayPlanCase) throws {
    let zone = try #require(TimeZone(identifier: c.timeZone))
    let p = try ReadFile.load().stored(c.program, activeAt: c.activeAt)
    let plan = BelayCore.dayPlan(
      c.workouts, p, rotation: rotationOf(p), today: c.today, timeZone: zone)
    #expect(PlanResult(plan) == c.result)
  }

  @Test(arguments: try ReadFile.load().fixedWeek)
  fileprivate func fixedWeek(_ c: ReadFile.FixedWeekCase) throws {
    let p = try #require(try ReadFile.load().programs[c.program])
    let week = BelayCore.fixedWeek(p, rotation: rotationOf(p))
    #expect(week?.map(picked) == c.result?.week)
    guard let week, let result = c.result else { return }
    #expect(sessionDays(week) == result.sessionDays)
    for d in result.daysOf {
      #expect(daysOf(week, sessionId: d.sessionId) == d.days)
    }
  }

  @Test(arguments: try ReadFile.load().weekOrder)
  fileprivate func weekOrder(_ c: ReadFile.WeekOrderCase) throws {
    let zone = try #require(TimeZone(identifier: c.timeZone))
    let p = try #require(try ReadFile.load().programs[c.program])
    let cards = BelayCore.weekOrder(
      c.workouts, p, rotation: rotationOf(p), today: c.today, timeZone: zone)
    #expect(
      cards?.map { .init(session: picked($0.session)!, next: $0.next, days: $0.days) } == c.result)
  }

  @Test(arguments: try ReadFile.load().finishedOn)
  fileprivate func finishedOn(_ c: ReadFile.FinishedOnCase) throws {
    let zone = try #require(TimeZone(identifier: c.timeZone))
    let done = BelayCore.finishedOn(c.history.history, day: c.day, timeZone: zone)
    #expect(done?.workout.id == c.result?.workout)
    #expect(done?.durationMs == c.result?.durationMs)
    #expect(done?.workSets == c.result?.workSets)
  }

  @Test(arguments: try ReadFile.load().workSetsOf)
  fileprivate func workSetsOf(_ c: ReadFile.WorkSetsCase) {
    #expect(BelayCore.workSetsOf(c.history.history, workoutId: c.workoutId) == c.result)
  }

  @Test(arguments: try ReadFile.load().lastFinished)
  fileprivate func lastFinished(_ c: ReadFile.LastFinishedCase) {
    let session = LetteredTemplate(
      code: c.session.code, slots: [], sessionId: c.session.sessionId, name: nil)
    #expect(BelayCore.lastFinished(c.workouts, session: session)?.id == c.result)
  }

  @Test(arguments: try ReadFile.load().programOrder)
  fileprivate func programOrder(_ c: ReadFile.ProgramOrderCase) {
    #expect(BelayCore.programOrder(c.stored).map(\.id) == c.result)
  }

  @Test(arguments: try ReadFile.load().chooseActive)
  fileprivate func chooseActive(_ c: ReadFile.ChooseActiveCase) {
    let change = BelayCore.chooseActive(c.stored, programId: c.programId, at: c.at)
    #expect(
      change.map { [.init(kind: "activeProgram", programId: $0.programId, at: $0.at)] }
        == c.result)
  }
}
