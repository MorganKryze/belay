import Foundation
import Testing

@testable import BelayCore

// The states of the screens Corps pushes: Tes semaines, Apports, Compléments and Mensurations,
// each from the body entries and the local day.

@Suite struct EntriesStateTests {
  private let zone = Days.paris

  // MARK: Tes semaines

  @Test func weeksNewestFirstWithTheCurrentOneToFollow() throws {
    let note = "00000000-0000-7000-8000-0000000000a1"
    let body = Bodies.body(
      weights: Bodies.usualWeights,
      annotations: [Bodies.annotation(note, "2026-11-04", .deload)])
    let rows = weeks(body, now: Bodies.now, timeZone: zone)
    #expect(rows.map(\.summary.start) == ["2026-11-09", "2026-11-02", "2026-10-26"])
    #expect(rows[0].isCurrent)
    #expect(rows[0].summary.status == .inProgress)
    #expect(rows[0].inRange == nil)
    #expect(!rows[1].isCurrent)
    #expect(rows[1].inRange == true)
    #expect(rows[1].annotations == [
      AnnotationMark(id: note, date: "2026-11-04", kind: .deload, label: nil)
    ])
    #expect(rows[0].annotations.isEmpty)
    // The first week has nothing to compare with.
    #expect(rows[2].summary.lossPct == nil)
    #expect(rows[2].inRange == nil)
  }

  @Test func weeksOutOfTheProfilesRange() {
    let body = Bodies.body(
      weights: Bodies.usualWeights, target: TargetRow(minPct: 0.8, maxPct: 1, at: nil))
    #expect(weeks(body, now: Bodies.now, timeZone: zone)[1].inRange == false)
  }

  @Test func noWeeksBeforeTheFirstWeighIn() {
    #expect(weeks(Bodies.body(), now: Bodies.now, timeZone: zone).isEmpty)
  }

  @Test func weekKcalIsRoundedAverageOfDaysWithCalories() {
    let body = Bodies.body(
      weights: Bodies.usualWeights,
      intake: [
        IntakeRow(date: "2026-11-09", kcal: 1900, kcalAt: nil, proteinG: nil, proteinAt: nil),
        IntakeRow(date: "2026-11-10", kcal: 2001, kcalAt: nil, proteinG: 120, proteinAt: nil),
        // Protein alone does not count as a day with calories.
        IntakeRow(date: "2026-11-11", kcal: nil, kcalAt: nil, proteinG: 130, proteinAt: nil),
        // The week before, on its Sunday.
        IntakeRow(date: "2026-11-08", kcal: 2500, kcalAt: nil, proteinG: nil, proteinAt: nil),
      ])
    let rows = weeks(body, now: Bodies.now, timeZone: zone)
    // (1 900 + 2 001) / 2 = 1 950.5, rounded as the web's `Math.round`.
    #expect(rows[0].kcalAvg == 1951)
    #expect(rows[1].kcalAvg == 2500)
  }

  @Test func weekWithoutCaloriesHasNone() {
    let body = Bodies.body(
      weights: Bodies.usualWeights,
      intake: [
        IntakeRow(date: "2026-11-03", kcal: nil, kcalAt: nil, proteinG: 110, proteinAt: nil)
      ])
    #expect(weeks(body, now: Bodies.now, timeZone: zone).map(\.kcalAvg) == [nil, nil, nil])
  }

  // MARK: Apports

  private let profile = ProfileRow(
    formula: .male, formulaAt: nil, birthYear: 1990, birthYearAt: nil, heightCm: 180,
    heightAt: nil)

  @Test func intakeFiguresFromTheToolsWithAFullProfile() throws {
    let body = Bodies.body(weights: Bodies.usualWeights, profile: profile)
    let state = intakeState(body, pal: sedentary, goal: .maintain, now: Bodies.now, timeZone: zone)
    // Mifflin for a man of 36, 180 cm, 80.0 kg (the 7-day average): 1 750 kcal; × 1.55 = 2 712.5,
    // to 10 kcal.
    #expect(state.kcalFigure == 2710)
    let protein = try #require(state.protein)
    #expect((protein.lowG, protein.highG) == (110, 160))
    // 1.4 to 2.0 g/kg of 80 kg: 112 to 160, shown 110 to 160; the middle 135.
    #expect(state.proteinFigure == 135)
  }

  private let sedentary = 1.55

  @Test func apportsUsesChosenPalAndGoal() throws {
    let body = Bodies.body(weights: Bodies.usualWeights, profile: profile)
    let state = intakeState(body, pal: 1.75, goal: .gain, now: Bodies.now, timeZone: zone)
    // 1 750 kcal at rest × 1.75 (Actif) = 3 062.5, to 10 kcal.
    #expect(state.kcalFigure == 3060)
    // Gain: 1.6 to 2.2 g/kg of 80 kg, 128 to 176, shown 130 to 175; the middle 152.5 rounds up.
    let protein = try #require(state.protein)
    #expect((protein.lowG, protein.highG) == (130, 175))
    #expect(state.proteinFigure == 155)
  }

  @Test func toolsOpenOnTheEntries() {
    let body = Bodies.body(weights: Bodies.usualWeights, profile: profile)
    let today = toISODate(Bodies.now, timeZone: zone)
    let defaults = toolDefaults(body, now: Bodies.now, timeZone: zone)
    #expect(
      defaults
        == toolDefaults(
          profile: profile, weighings: weighings(body), measures: body.measures, today: today))
    #expect(defaults.formula?.value == .male)
    #expect(defaults.weightKg != nil)
    #expect(toolDefaults(.empty, now: Bodies.now, timeZone: zone) == ToolDefaults())
  }

  @Test func defaultsSedentaryMaintain() {
    let body = Bodies.body(weights: Bodies.usualWeights, profile: profile)
    let unchosen = ToolMemory()
    let state = intakeState(
      body, pal: unchosen.pal.pal, goal: unchosen.goal, now: Bodies.now, timeZone: zone)
    #expect(state == intakeState(body, pal: 1.55, goal: .maintain, now: Bodies.now, timeZone: zone))
    #expect(state.kcalFigure == 2710)
    #expect(state.proteinFigure == 135)
  }

  @Test func intakeWithoutAFullProfileHasNoCalorieFigure() {
    let incomplete = [
      ProfileRow(
        formula: nil, formulaAt: nil, birthYear: 1990, birthYearAt: nil, heightCm: 180,
        heightAt: nil),
      ProfileRow(
        formula: .male, formulaAt: nil, birthYear: nil, birthYearAt: nil, heightCm: 180,
        heightAt: nil),
      ProfileRow(
        formula: .female, formulaAt: nil, birthYear: 1990, birthYearAt: nil, heightCm: nil,
        heightAt: nil),
    ]
    for profile in incomplete + [nil] as [ProfileRow?] {
      let state = intakeState(
        Bodies.body(weights: Bodies.usualWeights, profile: profile), pal: sedentary,
        goal: .maintain, now: Bodies.now, timeZone: zone)
      #expect(state.kcalFigure == nil)
      // The protein needs the weight only.
      #expect(state.proteinFigure == 135)
    }
  }

  @Test func intakeWithoutAWeighInHasNoFigure() {
    let state = intakeState(
      Bodies.body(profile: profile), pal: sedentary, goal: .maintain, now: Bodies.now,
      timeZone: zone)
    #expect(state.kcalFigure == nil)
    #expect(state.protein == nil)
    #expect(state.proteinFigure == nil)
  }

  @Test func proteinMiddleRoundedToFiveGrams() {
    // 77 kg: 107.8 to 154 g, shown 110 to 155; the middle 132.5 rounds to 135.
    let body = Bodies.body(weights: Bodies.weights([Bodies.today], kg: 77))
    let state = intakeState(body, pal: sedentary, goal: .maintain, now: Bodies.now, timeZone: zone)
    #expect(state.proteinFigure == 135)
    // 83 kg: 116.2 to 166 g, shown 115 to 165; the middle 140.
    let other = intakeState(
      Bodies.body(weights: Bodies.weights([Bodies.today], kg: 83)), pal: sedentary,
      goal: .maintain, now: Bodies.now,
      timeZone: zone)
    #expect(other.proteinFigure == 140)
  }

  @Test func intakeTodayAndThePreviousDaysNewestFirst() {
    let intake = [
      IntakeRow(date: "2026-11-10", kcal: 1900, kcalAt: nil, proteinG: nil, proteinAt: nil),
      IntakeRow(date: Bodies.today, kcal: 1850, kcalAt: nil, proteinG: 128, proteinAt: nil),
      IntakeRow(date: "2026-11-12", kcal: 2000, kcalAt: nil, proteinG: 120, proteinAt: nil),
      IntakeRow(date: "2026-11-14", kcal: 2100, kcalAt: nil, proteinG: 100, proteinAt: nil),
    ]
    let state = intakeState(
      Bodies.body(intake: intake), pal: sedentary, goal: .maintain, now: Bodies.now,
      timeZone: zone)
    #expect(state.today == TodayIntake(kcal: 1850, proteinG: 128))
    #expect(state.previous.map(\.date) == ["2026-11-12", "2026-11-10"])
  }

  // MARK: Compléments

  @Test func supplementsTickedPerDay() {
    let list = [
      Bodies.supplement(Bodies.creatine, "Créatine", kind: .creatine),
      Bodies.supplement(Bodies.omega, "Oméga 3", kind: .other),
      Bodies.supplement(Fixture.id(), "Ancien", kind: .other, removed: true),
    ]
    let logs = [
      Bodies.taken(Bodies.creatine, "2026-11-10"),
      Bodies.taken(Bodies.creatine, "2026-11-12"),
      Bodies.taken(Bodies.creatine, Bodies.today),
      Bodies.taken(Bodies.omega, "2026-11-12"),
    ]
    let today = supplementsToday(
      Bodies.body(supplements: list, logs: logs), now: Bodies.now, timeZone: zone)
    #expect(
      today == [
        SupplementToday(
          id: Bodies.creatine, name: "Créatine", kind: .creatine, taken: true, creatineDay: 4),
        SupplementToday(
          id: Bodies.omega, name: "Oméga 3", kind: .other, taken: false, creatineDay: nil),
      ])
  }

  @Test func creatineDayOnlyWhileTakenToday() {
    let list = [Bodies.supplement(Bodies.creatine, "Créatine", kind: .creatine)]
    let logs = [Bodies.taken(Bodies.creatine, "2026-11-12")]
    let today = supplementsToday(
      Bodies.body(supplements: list, logs: logs), now: Bodies.now, timeZone: zone)
    #expect(today.map(\.taken) == [false])
    #expect(today.map(\.creatineDay) == [nil])
  }

  @Test func creatineDayFromTheCourseStart() {
    // A course from 1 November: today is its 13th day; a box 20 days before started an older one.
    let list = [Bodies.supplement(Bodies.creatine, "Créatine", kind: .creatine)]
    let logs = ["2026-10-12", "2026-11-01", Bodies.today].map { Bodies.taken(Bodies.creatine, $0) }
    let today = supplementsToday(
      Bodies.body(supplements: list, logs: logs), now: Bodies.now, timeZone: zone)
    #expect(today.map(\.creatineDay) == [13])
  }

  // MARK: Mensurations

  @Test func measuresWaistChangeSinceTheFirst() {
    let measures = [
      Bodies.measure("2026-10-01", waist: 85.2, neck: 38),
      Bodies.measure("2026-09-07", waist: 86),
      Bodies.measure("2026-11-09", waist: 84.5),
      Bodies.measure("2026-11-11", neck: 37.5),
      Bodies.measure("2026-11-20", waist: 83),
    ]
    let state = measuresState(Bodies.body(measures: measures), now: Bodies.now, timeZone: zone)
    #expect(state.waist == LatestMeasure(cm: 84.5, date: "2026-11-09"))
    #expect(state.first == LatestMeasure(cm: 86, date: "2026-09-07"))
    #expect(state.changeCm == -1.5)
    #expect(
      state.curve == [
        Point(date: "2026-09-07", value: 86), Point(date: "2026-10-01", value: 85.2),
        Point(date: "2026-11-09", value: 84.5),
      ])
    #expect(state.history.map(\.date) == ["2026-11-11", "2026-11-09", "2026-10-01", "2026-09-07"])
  }

  @Test func measuresNoChangeWithOneWaist() {
    let state = measuresState(
      Bodies.body(measures: [Bodies.measure("2026-11-09", waist: 84.5)]), now: Bodies.now,
      timeZone: zone)
    #expect(state.waist == LatestMeasure(cm: 84.5, date: "2026-11-09"))
    #expect(state.changeCm == nil)
  }
}
