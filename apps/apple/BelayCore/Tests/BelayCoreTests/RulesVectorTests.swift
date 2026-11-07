import Foundation
import Testing

@testable import BelayCore

// The session and schedule cases the shared TypeScript rules computed (`pnpm vectors`), each
// rule checked over every one of its cases.

private func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
  let url = try #require(
    Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Vectors"))
  return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
}

/// A measure as the rules name it: nil for repetitions.
private func measure(_ name: String) -> Measure? {
  name == "reps" ? nil : Measure(rawValue: name)
}

private func date(_ text: String) throws -> Date { try #require(Instant.date(text)) }

private struct HistoryVector: Decodable, Sendable {
  let workouts: [WorkoutRow]
  let sets: [SetRow]
  var history: History { History(workouts: workouts, sets: sets) }
}

private struct RulesFile: Decodable, Sendable {
  struct Bounds: Decodable, Sendable {
    let forgottenMs: Int
    let maxRotation: Int
  }
  struct WorkOrderCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let plan: [Slot]
    let result: [Turn]
    var testDescription: String { name }
  }
  struct NextTurnCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let plan: [Slot]
    let done: [String]
    let from: Turn?
    let result: Turn?
    var testDescription: String { name }
  }
  struct ProgressCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Result: Decodable, Sendable {
      let done: [String]
      let left: Int
      let last: Turn?
      let next: Turn?
    }
    let name: String
    let plan: [Slot]
    let sets: [SetRow]
    let result: Result
    var testDescription: String { name }
  }
  struct RestSecCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let plan: [Slot]
    let results: [Int]
    var testDescription: String { name }
  }
  struct RestEndsCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let plan: [Slot]
    let done: [String]
    let after: Turn
    let doneAt: String
    let result: String?
    var testDescription: String { name }
  }
  struct PrefillCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let history: String
    let exerciseId: String
    let setIndex: Int
    let measure: String
    let result: Load?
    var testDescription: String { name }
  }
  struct LastTimeCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Group: Decodable, Sendable, Equatable {
      let weightKg: Double
      let counts: [Int]
    }
    let name: String
    let history: String
    let exerciseId: String
    let measure: String
    let result: [Group]
    var testDescription: String { name }
  }
  struct LiveSetsCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let history: String
    let result: [String]
    var testDescription: String { name }
  }
  struct AutoCloseCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Result: Decodable, Sendable {
      let kind: String
      let endedAt: String?
    }
    let name: String
    let workout: WorkoutRow
    let sets: [SetRow]
    let now: String
    let result: Result
    var testDescription: String { name }
  }
  struct OpenCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Forgotten: Decodable, Sendable {
      let sets: [SetRow]
      let now: String
    }
    let name: String
    let workouts: [WorkoutRow]
    let forgotten: Forgotten?
    let result: String?
    var testDescription: String { name }
  }

  struct SummaryCase: Decodable, Sendable, CustomTestStringConvertible {
    struct Record: Decodable, Sendable, Equatable {
      let exerciseId: String
      let weightKg: Double
      let reps: Int?
      let seconds: Int?
    }
    struct Result: Decodable, Sendable {
      let durationMs: Int64
      let workSets: Int
      let warmupSets: Int
      let volumeKg: Double
      let records: [Record]
    }
    let name: String
    let history: String
    let workoutId: String
    let result: Result
    var testDescription: String { name }
  }

  let bounds: Bounds
  let histories: [String: HistoryVector]
  let workOrder: [WorkOrderCase]
  let nextTurn: [NextTurnCase]
  let sessionProgress: [ProgressCase]
  let restSecAfter: [RestSecCase]
  let restEndsAt: [RestEndsCase]
  let prefill: [PrefillCase]
  let lastTime: [LastTimeCase]
  let liveSets: [LiveSetsCase]
  let autoClose: [AutoCloseCase]
  let openWorkout: [OpenCase]
  let summary: [SummaryCase]

  static func load() throws -> RulesFile { try BelayCoreTests.load("rules") }

  func history(_ name: String) throws -> History { try #require(histories[name]).history }
}

/// The session a rule picks, by its letter and the session it comes from.
private struct Pick: Decodable, Sendable, Equatable {
  let code: String
  let sessionId: String
}
private func pick(_ template: LetteredTemplate?) -> Pick? {
  template.map { Pick(code: $0.code, sessionId: $0.sessionId) }
}

private struct ScheduleFile: Decodable, Sendable {
  struct ClimbedCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let activities: [ActivityRow]
    let date: String
    let result: Bool
    var testDescription: String { name }
  }
  struct PlanForCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let session: String
    let activities: [ActivityRow]
    let date: String
    let result: [Slot]
    var testDescription: String { name }
  }
  struct EstimateCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let slots: [Slot]
    let minutes: Int
    let workSets: Int
    var testDescription: String { name }
  }
  struct WithSeedCase: Decodable, Sendable, CustomTestStringConvertible {
    /// What a device may have stored: any part left out, the active pointer null or left out.
    struct Stored: Decodable, Sendable {
      let activeId: Nullable<String>
      let activeAt: String?
      let programs: [ProgramRow]?
      let sessions: [ProgramSessionRow]?
      let slots: [ProgramSlotRow]?
    }
    let name: String
    let stored: Stored
    let result: StoredPrograms
    var testDescription: String { name }
  }
  struct RotationCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let stored: StoredPrograms
    let result: [LetteredTemplate]
    var testDescription: String { name }
  }
  struct NextCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let workouts: [WorkoutRow]
    let rotation: [LetteredTemplate]
    let activeAt: String?
    let result: Pick?
    var testDescription: String { name }
  }
  struct PlannedCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let timeZone: String
    let stored: StoredPrograms
    let workouts: [WorkoutRow]
    let today: String
    let result: Pick?
    var testDescription: String { name }
  }

  let templates: [String: LetteredTemplate]
  let climbedThisWeek: [ClimbedCase]
  let planFor: [PlanForCase]
  let estimates: [EstimateCase]
  let withSeed: [WithSeedCase]
  let rotationOf: [RotationCase]
  let nextInRotation: [NextCase]
  let plannedNext: [PlannedCase]

  static func load() throws -> ScheduleFile { try BelayCoreTests.load("schedule") }
}

struct RulesVectorTests {
  @Test func bounds() throws {
    let bounds = try RulesFile.load().bounds
    #expect(forgottenMs == bounds.forgottenMs)
    #expect(maxRotation == bounds.maxRotation)
  }

  @Test(arguments: try RulesFile.load().workOrder)
  fileprivate func workOrder(_ c: RulesFile.WorkOrderCase) {
    #expect(BelayCore.workOrder(c.plan) == c.result)
  }

  @Test(arguments: try RulesFile.load().nextTurn)
  fileprivate func nextTurn(_ c: RulesFile.NextTurnCase) {
    #expect(BelayCore.nextTurn(c.plan, done: Set(c.done), from: c.from) == c.result)
  }

  @Test(arguments: try RulesFile.load().sessionProgress)
  fileprivate func sessionProgress(_ c: RulesFile.ProgressCase) {
    let progress = BelayCore.sessionProgress(c.plan, sets: c.sets)
    #expect(progress.done == Set(c.result.done))
    #expect(progress.left == c.result.left)
    #expect(progress.last == c.result.last)
    #expect(progress.next == c.result.next)
  }

  @Test(arguments: try RulesFile.load().restSecAfter)
  fileprivate func restSecAfter(_ c: RulesFile.RestSecCase) {
    #expect(c.plan.indices.map { BelayCore.restSecAfter(c.plan, slotIndex: $0) } == c.results)
  }

  @Test(arguments: try RulesFile.load().restEndsAt)
  fileprivate func restEndsAt(_ c: RulesFile.RestEndsCase) {
    let end = BelayCore.restEndsAt(c.plan, done: Set(c.done), after: c.after, doneAt: c.doneAt)
    #expect(end == c.result)
  }

  @Test(arguments: try RulesFile.load().prefill)
  fileprivate func prefill(_ c: RulesFile.PrefillCase) throws {
    let history = try RulesFile.load().history(c.history)
    let load = BelayCore.prefill(
      history, exerciseId: c.exerciseId, setIndex: c.setIndex, measure: measure(c.measure))
    #expect(load == c.result)
  }

  @Test(arguments: try RulesFile.load().lastTime)
  fileprivate func lastTime(_ c: RulesFile.LastTimeCase) throws {
    let history = try RulesFile.load().history(c.history)
    let groups = BelayCore.lastTime(history, exerciseId: c.exerciseId, measure: measure(c.measure))
    #expect(groups.map { .init(weightKg: $0.weightKg, counts: $0.counts) } == c.result)
  }

  @Test(arguments: try RulesFile.load().liveSets)
  fileprivate func liveSets(_ c: RulesFile.LiveSetsCase) throws {
    let history = try RulesFile.load().history(c.history)
    #expect(BelayCore.liveSets(history).map(\.id) == c.result)
  }

  @Test(arguments: try RulesFile.load().autoClose)
  fileprivate func autoClose(_ c: RulesFile.AutoCloseCase) throws {
    let expected: Closing =
      switch c.result.kind {
      case "end": .end(endedAt: try #require(c.result.endedAt))
      case "remove": .remove
      default: .keep
      }
    #expect(BelayCore.autoClose(c.workout, sets: c.sets, now: try date(c.now)) == expected)
  }

  @Test(arguments: try RulesFile.load().summary)
  fileprivate func summary(_ c: RulesFile.SummaryCase) throws {
    let history = try RulesFile.load().history(c.history)
    let workout = try #require(history.workouts.first { $0.id == c.workoutId })
    let totals = BelayCore.summary(workout, sets: BelayCore.liveSets(history), history: history)
    #expect(totals.durationMs == c.result.durationMs)
    #expect(totals.workSets == c.result.workSets)
    #expect(totals.warmupSets == c.result.warmupSets)
    #expect(totals.volumeKg == c.result.volumeKg)
    #expect(
      totals.records.map {
        .init(exerciseId: $0.exerciseId, weightKg: $0.load.weightKg, reps: $0.load.reps, seconds: $0.load.seconds)
      } == c.result.records)
  }

  @Test(arguments: try RulesFile.load().openWorkout)
  fileprivate func openWorkout(_ c: RulesFile.OpenCase) throws {
    let forgotten = try c.forgotten.map { (sets: $0.sets, now: try date($0.now)) }
    #expect(BelayCore.openWorkout(c.workouts, forgotten: forgotten)?.id == c.result)
  }

  @Test(arguments: try ScheduleFile.load().climbedThisWeek)
  fileprivate func climbedThisWeek(_ c: ScheduleFile.ClimbedCase) {
    #expect(BelayCore.climbedThisWeek(c.activities, date: c.date) == c.result)
  }

  @Test(arguments: try ScheduleFile.load().planFor)
  fileprivate func planFor(_ c: ScheduleFile.PlanForCase) throws {
    let session = try #require(try ScheduleFile.load().templates[c.session])
    #expect(BelayCore.planFor(session, activities: c.activities, date: c.date) == c.result)
  }

  @Test(arguments: try ScheduleFile.load().estimates)
  fileprivate func estimates(_ c: ScheduleFile.EstimateCase) {
    #expect(estimatedMinutes(c.slots) == c.minutes)
    #expect(plannedWorkSets(c.slots) == c.workSets)
  }

  @Test(arguments: try ScheduleFile.load().withSeed)
  fileprivate func withSeed(_ c: ScheduleFile.WithSeedCase) {
    let s = c.stored
    let merged = BelayCore.withSeed(
      activeId: s.activeId, activeAt: s.activeAt, programs: s.programs ?? [],
      sessions: s.sessions ?? [], slots: s.slots ?? [])
    #expect(merged == c.result)
  }

  @Test(arguments: try ScheduleFile.load().rotationOf)
  fileprivate func rotationOf(_ c: ScheduleFile.RotationCase) {
    #expect(BelayCore.rotationOf(c.stored) == c.result)
  }

  @Test(arguments: try ScheduleFile.load().nextInRotation)
  fileprivate func nextInRotation(_ c: ScheduleFile.NextCase) {
    let next = BelayCore.nextInRotation(c.workouts, rotation: c.rotation, activeAt: c.activeAt)
    #expect(pick(next) == c.result)
  }

  @Test(arguments: try ScheduleFile.load().plannedNext)
  fileprivate func plannedNext(_ c: ScheduleFile.PlannedCase) throws {
    let zone = try #require(TimeZone(identifier: c.timeZone))
    let next = BelayCore.plannedNext(
      c.workouts, programs: c.stored, rotation: BelayCore.rotationOf(c.stored), today: c.today,
      timeZone: zone)
    #expect(pick(next) == c.result)
  }
}
