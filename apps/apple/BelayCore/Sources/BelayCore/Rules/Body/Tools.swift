// The tools intake reads its figures from, ported from the shared rules: the day's energy, the
// protein range, and what a tool opens with from the profile, the weigh-ins and the measures.

/// A value outside a tool's range, which the web refuses with a `RangeError`.
public struct OutOfRange: Error, Equatable, Sendable {
  public let message: String
}

// The tools' ranges for a body: their steppers never go outside them.
public let ageRangeYears = Bounds.ageYears.asDoubles
public let heightRangeCm = Bounds.heightCm.asDoubles
public let weightRangeKg = 30.0...300.0
/// Belay's guard on the body-fat tool, in percent: outside it the equation is extrapolating, so
/// no number is shown.
public let navyRangePct = 2.0...75.0

private func within(_ value: Double, _ range: ClosedRange<Double>) -> Bool {
  value.isFinite && range.contains(value)
}

/// A weight and a height the body tools take.
func assertBody(weightKg: Double, heightCm: Double) throws(OutOfRange) {
  guard within(weightKg, weightRangeKg) else { throw OutOfRange(message: "weight") }
  guard within(heightCm, heightRangeCm) else { throw OutOfRange(message: "height") }
}

/// The age is never stored: it comes from the birth year and today's year.
public func ageIn(birthYear: Int, today: String) -> Int { calendarYear(today) - birthYear }

/// An activity level and its PAL multiplier.
public struct PalLevel: Codable, Sendable, Equatable {
  public var id: String
  public var pal: Double
}

/// FAO/WHO/UNU 2004: four values that each appear in the report (Table 5.3 and section 5.3.2).
public let palLevels = [
  PalLevel(id: "very-sedentary", pal: 1.4),
  PalLevel(id: "sedentary", pal: 1.55),
  PalLevel(id: "active", pal: 1.75),
  PalLevel(id: "very-active", pal: 2),
]

public struct MifflinInput: Sendable, Equatable {
  public var formula: ProfileFormula
  public var ageYears: Double
  public var heightCm: Double
  public var weightKg: Double

  public init(formula: ProfileFormula, ageYears: Double, heightCm: Double, weightKg: Double) {
    self.formula = formula
    self.ageYears = ageYears
    self.heightCm = heightCm
    self.weightKg = weightKg
  }
}

/// Mifflin-St Jeor 1990, in kcal per day.
public func mifflinStJeor(_ input: MifflinInput) throws(OutOfRange) -> Double {
  guard within(input.ageYears, ageRangeYears) else { throw OutOfRange(message: "age") }
  guard within(input.weightKg, weightRangeKg) else { throw OutOfRange(message: "weight") }
  guard within(input.heightCm, heightRangeCm) else { throw OutOfRange(message: "height") }
  return 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears
    + (input.formula == .male ? 5 : -161)
}

/// The day's expenditure and its ±10 % range, each to 10 kcal.
public struct DailyEnergy: Codable, Sendable, Equatable {
  public var bmrKcal: Double
  public var dayKcal: Double
  public var lowKcal: Double
  public var highKcal: Double
}

/// A heuristic: Mifflin × PAL is not validated as a pair by any source, hence the ±10 % range.
public func dailyEnergy(_ input: MifflinInput, pal: Double) throws(OutOfRange) -> DailyEnergy {
  let bmr = try mifflinStJeor(input)
  guard pal.isFinite && pal > 0 else { throw OutOfRange(message: "pal") }
  let day = bmr * pal
  return DailyEnergy(
    bmrKcal: roundTo(bmr, step: 10), dayKcal: roundTo(day, step: 10),
    lowKcal: roundTo(day * 0.9, step: 10), highKcal: roundTo(day * 1.1, step: 10))
}

public enum ProteinGoal: String, Codable, Sendable {
  case maintain, cut, gain
}

/// `leanMass`: Helms 2014, per kg of fat-free mass; `noBodyFat`: the fallback without a body fat.
public enum ProteinBasis: String, Codable, Sendable {
  case bodyWeight = "body-weight"
  case leanMass = "lean-mass"
  case noBodyFat = "no-body-fat"
}

/// The day's protein in grams, to 5 g, and what 3 or 4 meals each take of it.
public struct ProteinRange: Codable, Sendable, Equatable {
  public var lowG: Double
  public var highG: Double
  public var basis: ProteinBasis
  public var floorApplied: Bool
  public var perMeal3: [Double]
  public var perMeal4: [Double]
}

/// A heuristic: when cutting, never below the maintenance point.
public let cutFloorGPerKg = 1.6

public func proteinRange(_ weightKg: Double, goal: ProteinGoal, bodyFatPct: Double? = nil)
  throws(OutOfRange) -> ProteinRange
{
  guard weightKg.isFinite && weightKg > 0 else { throw OutOfRange(message: "weight") }
  if let bodyFatPct, !navyRangePct.contains(bodyFatPct) {
    throw OutOfRange(message: "body fat")
  }
  var low: Double
  var high: Double
  var basis = ProteinBasis.bodyWeight
  var cutWithFloor = false
  switch (goal, bodyFatPct) {
  case (.maintain, _): (low, high) = (1.4 * weightKg, 2.0 * weightKg)  // Jäger 2017
  case (.gain, _): (low, high) = (1.6 * weightKg, 2.2 * weightKg)  // Morton 2018
  case (.cut, nil):
    // A heuristic: Helms at about 20 % fat.
    (low, high) = (1.8 * weightKg, 2.5 * weightKg)
    basis = .noBodyFat
  case (.cut, let fat?):
    let leanKg = weightKg * (1 - fat / 100)
    (low, high) = (2.3 * leanKg, 3.1 * leanKg)  // Helms 2014, per kg of lean mass
    basis = .leanMass
    high = max(high, cutFloorGPerKg * weightKg)
    cutWithFloor = true
  }
  // The floor rounds up (1e-9 absorbs 1.6 × 100 = 160.00000000000003), so the shown low end is
  // never under 1.6 g/kg.
  let floorG = ((cutFloorGPerKg * weightKg) / 5 - 1e-9).rounded(.up) * 5
  // Checked on the rounded value: a low end just above the floor can round down under it.
  let lowG = cutWithFloor ? max(roundTo(low, step: 5), floorG) : roundTo(low, step: 5)
  let floorApplied = cutWithFloor && lowG == floorG && roundTo(low, step: 5) < floorG
  let highG = max(roundTo(high, step: 5), cutWithFloor ? floorG : 0)
  return ProteinRange(
    lowG: lowG, highG: highG, basis: basis, floorApplied: floorApplied,
    perMeal3: perMeal(lowG, highG, 3), perMeal4: perMeal(lowG, highG, 4))
}

/// From the shown day range: n meals at the low end never add up to less than the day's low end,
/// and n meals at the high end never to more than its high end.
private func perMeal(_ lowG: Double, _ highG: Double, _ meals: Double) -> [Double] {
  let high = (highG / meals / 5).rounded(.down) * 5
  return [min((lowG / meals / 5).rounded(.up) * 5, high), high]
}

/// Where a prefilled value comes from, said under its field.
public enum ToolSource: Sendable, Equatable {
  case profile, birthYear, average, weighing
  case measures(String)
}

public struct ToolDefault<V: Sendable & Equatable>: Sendable, Equatable {
  public var value: V
  public var source: ToolSource
}

/// What a tool opens with; a field left nil keeps the device's value.
public struct ToolDefaults: Sendable, Equatable {
  public var formula: ToolDefault<ProfileFormula>?
  public var ageYears: ToolDefault<Double>?
  public var heightCm: ToolDefault<Double>?
  public var weightKg: ToolDefault<Double>?
  public var neckCm: ToolDefault<Double>?
  public var waistCm: ToolDefault<Double>?
  public var hipCm: ToolDefault<Double>?
}

/// The profile, the 7-day average (else the last weigh-in), the last value of each measure. A
/// value outside the tools' bounds is left out, as is a formula this version does not know.
public func toolDefaults(
  profile: ProfileRow, weighings: [Weighing], measures: [MeasureRow], today: String
) -> ToolDefaults {
  var out = ToolDefaults()
  switch profile.formula {
  case .female?, .male?: out.formula = profile.formula.map { ToolDefault(value: $0, source: .profile) }
  case .unknown?, nil: break
  }
  if let birthYear = profile.birthYear {
    let age = Double(ageIn(birthYear: birthYear, today: today))
    if within(age, ageRangeYears) { out.ageYears = ToolDefault(value: age, source: .birthYear) }
  }
  if let height = profile.heightCm.map(Double.init), within(height, heightRangeCm) {
    out.heightCm = ToolDefault(value: height, source: .profile)
  }

  let past = weighings.filter { $0.date <= today }
  let last = past.reduce(nil as Weighing?) { a, w in a.map { $0.date > w.date } == true ? a : w }
  let average = latestMovingAverage(past, today: today)
  // The average only while it covers the last weigh-in: an old one says less than a recent day.
  var weight: ToolDefault<Double>?
  if let average, let last, average.date >= last.date {
    weight = ToolDefault(value: roundTo(average.averageKg, step: 0.1), source: .average)
  } else if let last {
    weight = ToolDefault(value: last.weightKg, source: .weighing)
  }
  if let weight, within(weight.value, weightRangeKg) { out.weightKg = weight }

  let latest = latestMeasures(measures.filter { $0.date <= today })
  let fields: [(MeasureField, WritableKeyPath<ToolDefaults, ToolDefault<Double>?>)] = [
    (.neck, \.neckCm), (.waist, \.waistCm), (.hip, \.hipCm),
  ]
  for (field, key) in fields {
    if let m = latest[field], Bounds.measureCm(field).contains(m.cm) {
      out[keyPath: key] = ToolDefault(value: m.cm, source: .measures(m.date))
    }
  }
  return out
}
