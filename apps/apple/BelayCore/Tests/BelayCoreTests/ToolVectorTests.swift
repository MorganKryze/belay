import Foundation
import Testing

@testable import BelayCore

// The toolkit's rules as the shared rules computed them (`pnpm vectors`): the one-rep max, a
// bar's loading, the loss projection, BMI and body fat. A null result is an input the web refuses.

private func load<T: Decodable>(_ name: String, as type: T.Type = T.self) throws -> T {
  let url = try #require(
    Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Vectors"))
  return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
}

private struct ToolkitFile: Decodable, Sendable {
  let toolkit: Toolkit

  static func load() throws -> Toolkit { try BelayCoreTests.load("rules", as: Self.self).toolkit }
}

private struct Toolkit: Decodable, Sendable {
  struct Bounds: Decodable, Sendable {
    struct Pounds: Decodable, Sendable {
      let bar: Double
      let plates: [Double]
    }
    struct Rate: Decodable, Sendable {
      let id: String
      let pct: Double
    }
    struct BmiThresholds: Decodable, Sendable {
      let low: Double
      let reference: Double
      let high: Double
    }
    struct Range: Decodable, Sendable {
      let min: Double
      let max: Double
    }
    let reliableMaxReps: Int
    let maxReps: Int
    let lbPlates: Pounds
    let standardPlatesKg: [Double]
    let standardBarsKg: [Double]
    let ratePresets: [Rate]
    let rateMinPct: Double
    let rateMaxPct: Double
    let rateStepPct: Double
    let bmiThresholds: BmiThresholds
    let navyRangePct: Range
    let supplementSuggestions: [String]
  }
  struct OneRepMaxCase: Decodable, Sendable, CustomTestStringConvertible {
    let weightKg: Double
    /// The web takes any number and refuses one that is not whole; the phone's stepper only
    /// gives whole reps.
    let reps: Double
    let epley: Double
    let brzycki: Double
    let result: OneRepMax?
    var testDescription: String { "\(weightKg) kg × \(reps)" }
  }
  struct BarLoadVector: Decodable, Sendable {
    let kind: String
    let loading: Loading?
    let below: Loading?
    let above: Loading?
    var barLoad: BarLoad {
      kind == "exact" ? .exact(loading!) : .unreachable(below: below, above: above)
    }
  }
  struct LoadBarCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let targetKg: Double
    let barKg: Double
    let platesKg: [Double]
    let result: BarLoadVector?
    let nearest: Loading?
    var testDescription: String { name }
  }
  struct IwfCase: Decodable, Sendable {
    let kg: Double
    let color: String?
  }
  struct ProjectionVector: Decodable, Sendable {
    let kind: String
    let weeksLow: Int?
    let weeksHigh: Int?
    let dateLow: String?
    let dateHigh: String?
    var projection: Projection {
      guard kind == "ok", let weeksLow, let weeksHigh, let dateLow, let dateHigh else {
        return .targetNotBelow
      }
      return .ok(weeksLow: weeksLow, weeksHigh: weeksHigh, dateLow: dateLow, dateHigh: dateHigh)
    }
  }
  struct ProjectCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let zone: String
    let today: String
    let currentKg: Double
    let targetKg: Double
    let pctPerWeek: Double
    let result: ProjectionVector?
    var testDescription: String { name }
  }
  struct RateCase: Decodable, Sendable {
    let pct: Double
    let warning: String
    let kgPerWeek: Double
  }
  struct SlowCase: Decodable, Sendable {
    let weeks: Int
    let slow: Int
  }
  struct BmiCase: Decodable, Sendable {
    let weightKg: Double
    let heightCm: Double
    let result: Double?
  }
  struct BmiBandCase: Decodable, Sendable {
    let value: Double
    let band: String
    let professional: Bool
  }
  struct NavyInputVector: Decodable, Sendable {
    let formula: ProfileFormula
    let heightCm: Double
    let neckCm: Double
    let waistCm: Double
    let hipCm: Double?
    var input: NavyInput {
      NavyInput(formula: formula, heightCm: heightCm, neckCm: neckCm, waistCm: waistCm, hipCm: hipCm)
    }
  }
  struct NavyVector: Decodable, Sendable {
    let kind: String
    let percent: Int?
    let exact: Double?
  }
  struct NavyCase: Decodable, Sendable, CustomTestStringConvertible {
    let input: NavyInputVector
    let result: NavyVector
    var testDescription: String {
      "\(input.formula.rawValue): waist \(input.waistCm), neck \(input.neckCm)"
    }
  }
  struct GallagherVector: Decodable, Sendable {
    let group: AgeGroup
    let thresholds: GallagherThresholds
  }
  struct GallagherCase: Decodable, Sendable, CustomTestStringConvertible {
    let formula: ProfileFormula
    let reference: BodyFatReference
    let ageYears: Double
    let group: AgeGroup?
    let result: GallagherVector?
    var testDescription: String { "\(formula.rawValue), \(reference.rawValue), \(ageYears)" }
  }
  struct BodyFatBandCase: Decodable, Sendable {
    let percent: Int
    let thresholds: GallagherThresholds
    let band: Band
  }
  struct SummaryVector: Decodable, Sendable {
    let kind: String
    let steps: Int?
    let id: String?
    let count: Int?
  }
  struct SummaryCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let activities: [ActivityRow]
    let logs: [StepsRow]
    let day: String
    let result: SummaryVector
    var testDescription: String { name }
  }
  struct StepsOfCase: Decodable, Sendable {
    let name: String
    let logs: [StepsRow]
    let day: String
    let result: Int?
  }
  struct AgeCase: Decodable, Sendable {
    let birthYear: Int
    let today: String
    let result: Int
  }
  let bounds: Bounds
  let oneRepMax: [OneRepMaxCase]
  let loadBar: [LoadBarCase]
  let iwfColor: [IwfCase]
  let projectLoss: [ProjectCase]
  let rateWarning: [RateCase]
  let slowWeeks: [SlowCase]
  let bmi: [BmiCase]
  let bmiBand: [BmiBandCase]
  let navyBodyFat: [NavyCase]
  let gallagher: [GallagherCase]
  let bodyFatBand: [BodyFatBandCase]
  let activitySummary: [SummaryCase]
  let stepsOf: [StepsOfCase]
  let ageIn: [AgeCase]
}

struct ToolVectorTests {
  @Test func bounds() throws {
    let b = try ToolkitFile.load().bounds
    #expect(reliableMaxReps == b.reliableMaxReps)
    #expect(maxReps == b.maxReps)
    #expect(lbPlates == Plates(barKg: b.lbPlates.bar, platesKg: b.lbPlates.plates))
    #expect(standardPlatesKg == b.standardPlatesKg)
    #expect(standardBarsKg == b.standardBarsKg)
    #expect(ratePresets.map(\.id) == b.ratePresets.map(\.id))
    #expect(ratePresets.map(\.pct) == b.ratePresets.map(\.pct))
    #expect(rateMinPct == b.rateMinPct)
    #expect(rateMaxPct == b.rateMaxPct)
    #expect(rateStepPct == b.rateStepPct)
    #expect(bmiThresholds.low == b.bmiThresholds.low)
    #expect(bmiThresholds.reference == b.bmiThresholds.reference)
    #expect(bmiThresholds.high == b.bmiThresholds.high)
    #expect(navyRangePct == b.navyRangePct.min...b.navyRangePct.max)
    #expect(supplementSuggestions == b.supplementSuggestions)
  }

  @Test func platePresetsAreTheSessionsPlates() {
    #expect(platePresets.map(\.id) == ["competition", "gym"])
    #expect(platePresets.map(\.plates) == [Plates.competition, Plates.gym])
  }

  @Test(arguments: try ToolkitFile.load().oneRepMax)
  fileprivate func oneRepMax(_ c: Toolkit.OneRepMaxCase) {
    // A fractional count never reaches the phone: its stepper gives whole reps.
    guard let reps = Int(exactly: c.reps) else { return }
    #expect(epley(c.weightKg, reps) == c.epley)
    #expect(brzycki(c.weightKg, reps) == c.brzycki)
    #expect((try? BelayCore.oneRepMax(weightKg: c.weightKg, reps: reps)) == c.result)
  }

  @Test func oneRepMaxRefusesANonFiniteWeight() {
    #expect(throws: OutOfRange.self) { try BelayCore.oneRepMax(weightKg: .nan, reps: 5) }
    #expect(throws: OutOfRange.self) { try BelayCore.oneRepMax(weightKg: .infinity, reps: 5) }
  }

  @Test(arguments: try ToolkitFile.load().loadBar)
  fileprivate func loadBar(_ c: Toolkit.LoadBarCase) {
    let load = try? BelayCore.loadBar(c.targetKg, barKg: c.barKg, platesKg: c.platesKg)
    #expect(load == c.result?.barLoad)
    if let nearest = c.nearest {
      #expect(nearestLoading(c.targetKg, barKg: c.barKg, platesKg: c.platesKg) == nearest)
    }
  }

  @Test func loadBarRefusesNonFiniteInputs() {
    #expect(throws: OutOfRange.self) { try BelayCore.loadBar(.nan, barKg: 20, platesKg: [20]) }
    #expect(throws: OutOfRange.self) {
      try BelayCore.loadBar(.infinity, barKg: 20, platesKg: [20])
    }
    #expect(throws: OutOfRange.self) { try BelayCore.loadBar(100, barKg: .nan, platesKg: [20]) }
    #expect(throws: OutOfRange.self) {
      try BelayCore.loadBar(60, barKg: 20, platesKg: [20, .infinity])
    }
  }

  @Test func iwfColors() throws {
    for c in try ToolkitFile.load().iwfColor {
      #expect(BelayCore.iwfColor(c.kg)?.rawValue == c.color, "\(c.kg) kg")
    }
  }

  @Test(arguments: try ToolkitFile.load().projectLoss)
  fileprivate func projectLoss(_ c: Toolkit.ProjectCase) {
    let p = try? BelayCore.projectLoss(
      currentKg: c.currentKg, targetKg: c.targetKg, pctPerWeek: c.pctPerWeek, today: c.today)
    #expect(p == c.result?.projection)
  }

  @Test func rates() throws {
    let t = try ToolkitFile.load()
    for c in t.rateWarning {
      #expect(BelayCore.rateWarning(c.pct).rawValue == c.warning, "\(c.pct) %")
      #expect(kgPerWeek(82, pctPerWeek: c.pct) == c.kgPerWeek, "\(c.pct) %")
    }
    for c in t.slowWeeks {
      #expect(BelayCore.slowWeeks(c.weeks) == c.slow, "\(c.weeks) weeks")
    }
  }

  @Test func bmiValuesAndBands() throws {
    let t = try ToolkitFile.load()
    for c in t.bmi {
      let value = try? BelayCore.bmi(weightKg: c.weightKg, heightCm: c.heightCm)
      #expect(value == c.result, "\(c.weightKg) kg, \(c.heightCm) cm")
    }
    for c in t.bmiBand {
      #expect(BelayCore.bmiBand(c.value).rawValue == c.band, "\(c.value)")
      #expect(bmiSuggestsProfessional(c.value) == c.professional, "\(c.value)")
    }
  }

  @Test(arguments: try ToolkitFile.load().navyBodyFat)
  fileprivate func navyBodyFat(_ c: Toolkit.NavyCase) throws {
    // log10 may differ from the web's in the last bit; the shown percent may not.
    switch BelayCore.navyBodyFat(c.input.input) {
    case .ok(let percent, let exact):
      #expect(c.result.kind == "ok")
      #expect(percent == c.result.percent)
      #expect(abs(exact - (try #require(c.result.exact))) < 1e-9)
    case .outOfRange(let exact):
      #expect(c.result.kind == "out-of-range")
      #expect(abs(exact - (try #require(c.result.exact))) < 1e-9)
    case .invalidGirths:
      #expect(c.result.kind == "invalid-girths")
    }
  }

  @Test func navyRefusesNonFiniteGirths() {
    let input = NavyInput(formula: .male, heightCm: 178, neckCm: 40, waistCm: .infinity, hipCm: nil)
    #expect(BelayCore.navyBodyFat(input) == .invalidGirths)
  }

  @Test(arguments: try ToolkitFile.load().gallagher)
  fileprivate func gallagher(_ c: Toolkit.GallagherCase) {
    #expect(ageGroup(c.ageYears) == c.group)
    let r = gallagherThresholds(c.formula, ageYears: c.ageYears, reference: c.reference)
    #expect(r?.group == c.result?.group)
    #expect(r?.thresholds == c.result?.thresholds)
  }

  @Test func bodyFatBands() throws {
    for c in try ToolkitFile.load().bodyFatBand {
      #expect(bodyFatBand(c.percent, c.thresholds) == c.band, "\(c.percent) %")
    }
  }

  @Test(arguments: try ToolkitFile.load().activitySummary)
  fileprivate func activitySummary(_ c: Toolkit.SummaryCase) {
    let summary = BelayCore.activitySummary(c.activities, c.logs, day: c.day)
    switch summary {
    case .none: #expect(c.result.kind == "none")
    case .steps(let steps):
      #expect(c.result.kind == "steps")
      #expect(steps == c.result.steps)
    case .activity(let activity):
      #expect(c.result.kind == "activity")
      #expect(activity.id == c.result.id)
    case .many(let count):
      #expect(c.result.kind == "many")
      #expect(count == c.result.count)
    }
  }

  @Test func stepsOfADay() throws {
    for c in try ToolkitFile.load().stepsOf {
      #expect(BelayCore.stepsOf(c.logs, day: c.day) == c.result, "\(c.name)")
    }
  }

  @Test func ageFromTheBirthYear() throws {
    for c in try ToolkitFile.load().ageIn {
      #expect(BelayCore.ageIn(birthYear: c.birthYear, today: c.today) == c.result, "\(c.today)")
    }
  }
}
