import Foundation
import Testing

@testable import BelayCore

// Corps's state and its « Aujourd'hui » rows, decided from the body entries and the local day:
// Friday 13 November 2026 at 10:00 in Paris, its week from Monday the 9th.

/// Body entries for the screen-state tests.
enum Bodies {
  static let today = "2026-11-13"
  static let now = Days.at("2026-11-13T10:00")
  static let creatine = "00000000-0000-7000-8000-0000000000c1"
  static let omega = "00000000-0000-7000-8000-0000000000c2"

  /// One weigh-in on each of `dates`, at `kg`.
  static func weights(_ dates: [String], kg: Double = 80) -> [WeightRow] {
    dates.map { WeightRow(date: $0, weightKg: kg, at: "\($0)T07:00:00.000Z") }
  }

  static func body(
    weights: [WeightRow] = [], measures: [MeasureRow] = [], intake: [IntakeRow] = [],
    supplements: [SupplementRow] = [], logs: [SupplementLogRow] = [],
    annotations: [AnnotationRow] = [], target: TargetRow? = nil, profile: ProfileRow? = nil
  ) -> BodyRead {
    BodyRead(
      weights: weights, measures: measures, intake: intake, supplements: supplements, logs: logs,
      annotations: annotations, target: target, profile: profile)
  }

  static func supplement(_ id: String, _ name: String, kind: SupplementKind, removed: Bool = false)
    -> SupplementRow
  {
    SupplementRow(
      id: id, name: name, nameAt: Fixture.time(0), kind: kind, removed: removed, removedAt: nil)
  }

  /// A box ticked, as the store reads them: taken ones only.
  static func taken(_ supplementId: String, _ date: String) -> SupplementLogRow {
    SupplementLogRow(supplementId: supplementId, date: date, taken: true, at: Fixture.time(0))
  }

  static func measure(_ date: String, waist: Double? = nil, neck: Double? = nil, hip: Double? = nil)
    -> MeasureRow
  {
    MeasureRow(
      date: date, waistCm: waist, waistAt: nil, neckCm: neck, neckAt: nil, hipCm: hip, hipAt: nil)
  }

  static func annotation(_ id: String, _ date: String, _ type: AnnotationKind, label: String? = nil)
    -> AnnotationRow
  {
    AnnotationRow(
      id: id, date: date, type: type, label: label, fieldsAt: Fixture.time(0), removed: false,
      removedAt: nil)
  }

  /// Two complete weeks before this one, 81.0 then 80.4 kg, a 0.74 % loss; this week from Monday,
  /// four at 80.0 kg.
  static let usualWeights =
    weights(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"], kg: 81)
    + weights(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"], kg: 80.4)
    + weights(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"], kg: 80)
}

@Suite struct CorpsStateTests {
  private func state(_ body: BodyRead, health: HealthSettings = .off) -> (CorpsState, TodayRows) {
    corpsState(body, health: health, now: Bodies.now, timeZone: Days.paris)
  }

  @Test func firstWithNoWeighIn() {
    #expect(state(Bodies.body()).0 == .first)
  }

  @Test func usualAtFourInTheLastSevenDays() throws {
    guard case .usual(let card) = state(Bodies.body(weights: Bodies.usualWeights)).0 else {
      Issue.record("expected usual")
      return
    }
    #expect(card.averageKg == 80)
    let loss = try #require(card.lossPct)
    #expect(abs(loss - 0.6 / 81 * 100) < 1e-9)
    #expect(card.inRange == true)
    #expect(card.range == defaultTarget)
  }

  @Test func usualFromTheSeventhDayBack() {
    let body = Bodies.body(
      weights: Bodies.weights(["2026-11-07", "2026-11-11", "2026-11-12", "2026-11-13"]))
    guard case .usual = state(body).0 else {
      Issue.record("expected usual")
      return
    }
  }

  @Test func earlyWhenTheFourthIsEightDaysBack() {
    let body = Bodies.body(
      weights: Bodies.weights(["2026-11-06", "2026-11-11", "2026-11-12", "2026-11-13"]))
    guard case .early(let count, _) = state(body).0 else {
      Issue.record("expected early")
      return
    }
    #expect(count == 1)
  }

  @Test func earlyCountsTheLastSevenDaysNotEveryWeighIn() {
    // Twelve in October, three this week: the average waits for a fourth within seven days.
    let october = (1...12).map { String(format: "2026-10-%02d", $0) }
    let body = Bodies.body(
      weights: Bodies.weights(october + ["2026-11-11", "2026-11-12", "2026-11-13"]))
    let month = trendSeries(body, span: .month, now: Bodies.now, timeZone: Days.paris)
    #expect(state(body).0 == .early(count: 1, points: month.points))
  }

  @Test func earlyCountsWhatIsStillNeededAtZeroOneAndTwo() {
    let cases: [([String], Int)] = [
      (["2026-10-01"], 4),
      (["2026-10-01", "2026-11-13"], 3),
      (["2026-10-01", "2026-11-12", "2026-11-13"], 2),
    ]
    for (dates, needed) in cases {
      guard case .early(let count, _) = state(Bodies.body(weights: Bodies.weights(dates))).0 else {
        Issue.record("expected early for \(dates)")
        continue
      }
      #expect(count == needed)
    }
  }

  @Test func earlyPointsAreTheMonthsWeighIns() {
    let body = Bodies.body(weights: Bodies.weights(["2026-09-01", "2026-11-12", "2026-11-13"]))
    #expect(
      state(body).0
        == .early(count: 2, points: [
          Point(date: "2026-11-12", value: 80), Point(date: "2026-11-13", value: 80),
        ]))
  }

  @Test func weighInAfterTodayDoesNotCount() {
    // A weigh-in dated tomorrow, after a time zone change, waits for its day.
    let body = Bodies.body(
      weights: Bodies.weights(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14"]))
    guard case .early(let count, _) = state(body).0 else {
      Issue.record("expected early")
      return
    }
    #expect(count == 1)
  }

  @Test func outOfTheRangeSaysSo() {
    let target = TargetRow(minPct: 0.25, maxPct: 0.5, at: Fixture.time(0))
    guard case .usual(let card) = state(Bodies.body(weights: Bodies.usualWeights, target: target)).0
    else {
      Issue.record("expected usual")
      return
    }
    #expect(card.inRange == false)
    #expect(card.range == TargetRange(minPct: 0.25, maxPct: 0.5))
  }

  @Test func noLossBeforeTwoCompleteWeeks() {
    let body = Bodies.body(
      weights: Bodies.weights(["2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]))
    guard case .usual(let card) = state(body).0 else {
      Issue.record("expected usual")
      return
    }
    #expect(card.lossPct == nil)
    #expect(card.inRange == nil)
  }

  @Test func fromHealthOnlyForADayTheImportFilledUntouched() {
    let stamp = "2026-11-12T23:00:00.000Z"
    let row = WeightRow(date: Bodies.today, weightKg: 79.9, at: stamp)
    var health = HealthSettings(on: true, turnedOnAt: 0, importOn: true)
    health.filled = [Bodies.today: Filled(at: stamp, startedAt: 0)]
    let imported = state(Bodies.body(weights: [row]), health: health).1.weighIn
    #expect(imported == TodayWeighIn(kg: 79.9, fromHealth: true))

    // Typed over since: the person's own weigh-in.
    var edited = row
    edited.at = "2026-11-13T08:00:00.000Z"
    #expect(state(Bodies.body(weights: [edited]), health: health).1.weighIn.fromHealth == false)

    // Another day filled; today typed.
    health.filled = ["2026-11-12": Filled(at: stamp, startedAt: 0)]
    #expect(state(Bodies.body(weights: [row]), health: health).1.weighIn.fromHealth == false)
  }

  @Test func weighInRowEmptyBeforeToday() {
    let rows = state(Bodies.body(weights: Bodies.weights(["2026-11-12"]))).1
    #expect(rows.weighIn == TodayWeighIn(kg: nil, fromHealth: false))
  }

  @Test func supplementsRowCountsTodaysBoxesAtZeroOneAndTwo() {
    let list = [
      Bodies.supplement(Bodies.creatine, "Créatine", kind: .creatine),
      Bodies.supplement(Bodies.omega, "Oméga 3", kind: .other),
      Bodies.supplement(Fixture.id(), "Ancien", kind: .other, removed: true),
    ]
    let yesterday = [Bodies.taken(Bodies.creatine, "2026-11-12")]
    let cases: [([SupplementLogRow], Int)] = [
      (yesterday, 0),
      (yesterday + [Bodies.taken(Bodies.creatine, Bodies.today)], 1),
      ([Bodies.taken(Bodies.creatine, Bodies.today), Bodies.taken(Bodies.omega, Bodies.today)], 2),
    ]
    for (logs, taken) in cases {
      let rows = state(Bodies.body(supplements: list, logs: logs)).1
      #expect(rows.supplements == TodaySupplements(taken: taken, total: 2))
    }
  }

  @Test func measuresRowNamesTheLastMeasureAndItsDay() {
    let measures = [
      Bodies.measure("2026-11-02", waist: 85),
      Bodies.measure("2026-11-09", waist: 84.5, neck: 38),
      Bodies.measure("2026-11-20", waist: 83),
    ]
    #expect(
      state(Bodies.body(measures: measures)).1.measures
        == LastMeasure(field: .waist, cm: 84.5, date: "2026-11-09"))
    // A day without a waist names its neck.
    #expect(
      state(Bodies.body(measures: [Bodies.measure("2026-11-10", neck: 38)])).1.measures
        == LastMeasure(field: .neck, cm: 38, date: "2026-11-10"))
    #expect(state(Bodies.body()).1.measures == nil)
  }

  @Test func intakeRowHoldsTodaysTotals() {
    let intake = [
      IntakeRow(date: "2026-11-12", kcal: 2000, kcalAt: nil, proteinG: 120, proteinAt: nil),
      IntakeRow(date: Bodies.today, kcal: 1850, kcalAt: nil, proteinG: 128, proteinAt: nil),
    ]
    #expect(
      state(Bodies.body(intake: intake)).1.intake == TodayIntake(kcal: 1850, proteinG: 128))
    #expect(state(Bodies.body()).1.intake == TodayIntake(kcal: nil, proteinG: nil))
  }
}
