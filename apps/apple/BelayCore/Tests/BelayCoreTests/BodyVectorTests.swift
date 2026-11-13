import Foundation
import Testing

@testable import BelayCore

// The body rules, as the shared rules computed them (`pnpm vectors`): the weigh-ins' averages and
// weeks, the loss range, measures, intake, creatine and the energy and protein tools.

private struct BodyFile: Decodable, Sendable {
  struct Bounds: Decodable, Sendable {
    let minWeighings: Int
    let creatineDays: Int
    let defaultTarget: TargetRange
    let palLevels: [PalLevel]
    let cutFloorGPerKg: Double
  }
  struct AddCase: Decodable, Sendable {
    let date: String
    let days: Int
    let result: String
  }
  struct DayCase: Decodable, Sendable {
    let date: String
    let result: String
  }
  struct NumberCase: Decodable, Sendable {
    let value: Double
    let result: Bool
  }
  struct WeighingCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let weighings: [Weighing]
    let today: String
    let from: String
    let series: [DayAverage]
    let average7: Double?
    let latest: DayAverage?
    let weeks: [WeekSummary]
    var testDescription: String { name }
  }
  struct RangeCase: Decodable, Sendable {
    let minPct: Double
    let maxPct: Double
    let result: Bool
  }
  struct LossCase: Decodable, Sendable {
    let lossPct: Double
    let target: TargetRange
    let result: Bool
  }
  struct MeasureCmCase: Decodable, Sendable {
    let field: MeasureField
    let value: Double
    let result: Bool
  }
  struct MeasuresCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let measures: [MeasureRow]
    let weekStart: String
    let latest: [String: LatestMeasure]
    let waist: Double?
    var testDescription: String { name }
  }
  struct IntakeCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let logs: [IntakeRow]
    let weekStart: String
    let result: WeeklyIntake
    var testDescription: String { name }
  }
  struct NameCase: Decodable, Sendable {
    let name: String
    let result: Bool
  }
  struct CreatineCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let takenDays: [String]
    let today: String
    let result: [DateSpan]
    var testDescription: String { name }
  }
  struct LabelCase: Decodable, Sendable {
    let label: String?
    let result: Bool
  }
  struct Input: Decodable, Sendable {
    let formula: ProfileFormula
    let ageYears: Double
    let heightCm: Double
    let weightKg: Double
  }
  struct EnergyCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let input: Input
    let pal: Double
    let bmr: Double?
    let result: DailyEnergy?
    var testDescription: String { name }
  }
  struct ProteinCase: Decodable, Sendable, CustomTestStringConvertible {
    let weightKg: Double
    let goal: ProteinGoal
    let bodyFatPct: Double?
    let result: ProteinRange?
    var testDescription: String {
      "\(weightKg) kg, \(goal.rawValue), \(bodyFatPct.map { "\($0) %" } ?? "no body fat")"
    }
  }
  /// A source this file does not know fails the decoding, so a new one in TS cannot pass unseen.
  struct Source: Decodable, Sendable {
    let source: ToolSource
    private enum Keys: String, CodingKey { case from, date }
    init(from decoder: any Decoder) throws {
      let c = try decoder.container(keyedBy: Keys.self)
      let from = try c.decode(String.self, forKey: .from)
      switch from {
      case "profile": source = .profile
      case "birthYear": source = .birthYear
      case "average": source = .average
      case "weighing": source = .weighing
      case "measures": source = .measures(try c.decode(String.self, forKey: .date))
      default:
        throw DecodingError.dataCorruptedError(
          forKey: .from, in: c, debugDescription: "unknown tool source \(from)")
      }
    }
  }
  struct Default<V: Decodable & Sendable & Equatable>: Decodable, Sendable {
    let value: V
    let source: Source
    var toolDefault: ToolDefault<V> { ToolDefault(value: value, source: source.source) }
  }
  struct Defaults: Decodable, Sendable {
    let formula: Default<ProfileFormula>?
    let ageYears, heightCm, weightKg, neckCm, waistCm, hipCm: Default<Double>?
    var toolDefaults: ToolDefaults {
      ToolDefaults(
        formula: formula?.toolDefault, ageYears: ageYears?.toolDefault,
        heightCm: heightCm?.toolDefault, weightKg: weightKg?.toolDefault,
        neckCm: neckCm?.toolDefault, waistCm: waistCm?.toolDefault, hipCm: hipCm?.toolDefault)
    }
  }
  struct DefaultsCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let profile: ProfileRow
    let weighings: [Weighing]
    let measures: [MeasureRow]
    let today: String
    let result: Defaults
    var testDescription: String { name }
  }

  let bounds: Bounds
  let addDays: [AddCase]
  let isoWeekStart: [DayCase]
  let isWeighingKg: [NumberCase]
  let weighings: [WeighingCase]
  let isTargetRange: [RangeCase]
  let inTargetRange: [LossCase]
  let isMeasureCm: [MeasureCmCase]
  let measures: [MeasuresCase]
  let isKcal: [NumberCase]
  let isProteinG: [NumberCase]
  let intake: [IntakeCase]
  let isCreatineName: [NameCase]
  let creatineWindows: [CreatineCase]
  let isAnnotationLabel: [LabelCase]
  let energy: [EnergyCase]
  let protein: [ProteinCase]
  let toolDefaults: [DefaultsCase]

  static func load() throws -> BodyFile {
    let url = try #require(
      Bundle.module.url(forResource: "body", withExtension: "json", subdirectory: "Vectors"))
    return try JSONDecoder().decode(BodyFile.self, from: Data(contentsOf: url))
  }
}

struct BodyVectorTests {
  @Test func bounds() throws {
    let bounds = try BodyFile.load().bounds
    #expect(minWeighings == bounds.minWeighings)
    #expect(creatineDays == bounds.creatineDays)
    #expect(defaultTarget == bounds.defaultTarget)
    #expect(palLevels == bounds.palLevels)
    #expect(cutFloorGPerKg == bounds.cutFloorGPerKg)
  }

  @Test func days() throws {
    let file = try BodyFile.load()
    for c in file.addDays {
      #expect(BelayCore.addDays(c.date, c.days) == c.result, "\(c.date) + \(c.days)")
    }
    for c in file.isoWeekStart {
      #expect(BelayCore.isoWeekStart(c.date) == c.result, "\(c.date)")
    }
  }

  @Test func checks() throws {
    let file = try BodyFile.load()
    for c in file.isWeighingKg {
      #expect(BelayCore.isWeighingKg(c.value) == c.result, "\(c.value) kg")
    }
    for c in file.isTargetRange {
      let range = TargetRange(minPct: c.minPct, maxPct: c.maxPct)
      #expect(BelayCore.isTargetRange(range) == c.result, "\(c.minPct) to \(c.maxPct)")
    }
    for c in file.isMeasureCm {
      #expect(BelayCore.isMeasureCm(c.field, c.value) == c.result, "\(c.field) \(c.value)")
    }
    for c in file.isKcal { #expect(BelayCore.isKcal(c.value) == c.result, "\(c.value) kcal") }
    for c in file.isProteinG { #expect(BelayCore.isProteinG(c.value) == c.result, "\(c.value) g") }
    for c in file.isCreatineName {
      #expect(BelayCore.isCreatineName(c.name) == c.result, "\(c.name)")
    }
    for c in file.isAnnotationLabel {
      #expect(BelayCore.isAnnotationLabel(c.label) == c.result, "\(String(describing: c.label))")
    }
  }

  /// The pill and the figure beside it never disagree: the loss is compared as shown.
  @Test func inTargetRange() throws {
    for c in try BodyFile.load().inTargetRange {
      #expect(
        BelayCore.inTargetRange(c.lossPct, c.target) == c.result,
        "\(c.lossPct) in \(c.target.minPct) to \(c.target.maxPct)")
    }
  }

  @Test(arguments: try BodyFile.load().weighings)
  fileprivate func weighings(_ c: BodyFile.WeighingCase) {
    #expect(movingAverageSeries(c.weighings, from: c.from, to: c.today) == c.series)
    #expect(movingAverage7(c.weighings, on: c.today) == c.average7)
    #expect(latestMovingAverage(c.weighings, today: c.today) == c.latest)
    #expect(weeklySummaries(c.weighings, today: c.today) == c.weeks)
  }

  @Test(arguments: try BodyFile.load().measures)
  fileprivate func measures(_ c: BodyFile.MeasuresCase) {
    let latest = Dictionary(
      uniqueKeysWithValues: c.latest.map { (MeasureField(rawValue: $0.key)!, $0.value) })
    #expect(latestMeasures(c.measures) == latest)
    #expect(weeklyWaist(c.measures, weekStart: c.weekStart) == c.waist)
  }

  @Test(arguments: try BodyFile.load().intake)
  fileprivate func intake(_ c: BodyFile.IntakeCase) {
    #expect(weeklyIntake(c.logs, weekStart: c.weekStart) == c.result)
  }

  @Test(arguments: try BodyFile.load().creatineWindows)
  fileprivate func creatineWindows(_ c: BodyFile.CreatineCase) {
    #expect(BelayCore.creatineWindows(c.takenDays, today: c.today) == c.result)
  }

  @Test(arguments: try BodyFile.load().energy)
  fileprivate func energy(_ c: BodyFile.EnergyCase) {
    let input = MifflinInput(
      formula: c.input.formula, ageYears: c.input.ageYears, heightCm: c.input.heightCm,
      weightKg: c.input.weightKg)
    #expect((try? mifflinStJeor(input)) == c.bmr)
    #expect((try? dailyEnergy(input, pal: c.pal)) == c.result)
  }

  @Test(arguments: try BodyFile.load().protein)
  fileprivate func protein(_ c: BodyFile.ProteinCase) {
    #expect((try? proteinRange(c.weightKg, goal: c.goal, bodyFatPct: c.bodyFatPct)) == c.result)
  }

  @Test(arguments: try BodyFile.load().toolDefaults)
  fileprivate func toolDefaults(_ c: BodyFile.DefaultsCase) {
    let defaults = BelayCore.toolDefaults(
      profile: c.profile, weighings: c.weighings, measures: c.measures, today: c.today)
    #expect(defaults == c.result.toolDefaults)
  }

  @Test(arguments: ["{\"from\":\"scale\"}", "{\"from\":\"measures\"}"])
  func anUnknownToolSourceFailsTheDecoding(_ json: String) {
    #expect(throws: DecodingError.self) {
      try JSONDecoder().decode(BodyFile.Source.self, from: Data(json.utf8))
    }
  }

  /// The web cannot hold another formula, and Mifflin would read one as female: it is left out.
  @Test func aFormulaThisVersionDoesNotKnowIsLeftOut() {
    let profile = ProfileRow(
      formula: .unknown("other"), formulaAt: nil, birthYear: 1990, birthYearAt: nil,
      heightCm: 170, heightAt: nil)
    let defaults = BelayCore.toolDefaults(
      profile: profile, weighings: [], measures: [], today: "2026-10-28")
    #expect(defaults.formula == nil)
    #expect(defaults.ageYears?.value == 36)
    #expect(defaults.heightCm?.value == 170)
  }
}
