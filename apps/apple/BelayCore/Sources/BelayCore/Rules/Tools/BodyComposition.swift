import Foundation

// BMI and body fat, ported from the shared rules.

/// Where a value sits against published thresholds. Descriptive only, never a judgement.
public enum Band: String, Codable, Sendable {
  case below, reference, above
  case wellAbove = "well-above"
}

/// WHO TRS 894, Table 2.1. The same thresholds at every adult age and for both sexes.
public let bmiThresholds = (low: 18.5, reference: 25.0, high: 30.0)

/// Rounded to 0.1 here, so the value shown and the band chosen are always the same number: a raw
/// 24.97 shows as 25.0 and sits in 25 to 30.
public func bmi(weightKg: Double, heightCm: Double) throws(OutOfRange) -> Double {
  try assertBody(weightKg: weightKg, heightCm: heightCm)
  let m = heightCm / 100
  return roundTo(weightKg / (m * m), step: 0.1)
}

public func bmiBand(_ value: Double) -> Band {
  if value < bmiThresholds.low { return .below }
  if value < bmiThresholds.reference { return .reference }
  if value < bmiThresholds.high { return .above }
  return .wellAbove
}

/// Belay's wording: suggest talking to a professional under 18.5 or from 35 (WHO class II).
public func bmiSuggestsProfessional(_ value: Double) -> Bool { value < 18.5 || value >= 35 }

public struct NavyInput: Sendable, Equatable {
  public var formula: ProfileFormula
  public var heightCm: Double
  public var neckCm: Double
  public var waistCm: Double
  public var hipCm: Double?

  public init(
    formula: ProfileFormula, heightCm: Double, neckCm: Double, waistCm: Double, hipCm: Double?
  ) {
    self.formula = formula
    self.heightCm = heightCm
    self.neckCm = neckCm
    self.waistCm = waistCm
    self.hipCm = hipCm
  }
}

public enum NavyResult: Sendable, Equatable {
  case ok(percent: Int, exact: Double)
  case invalidGirths
  case outOfRange(exact: Double)
}

/// DoDI 1308.3 E3.1.3, centimetre form: the inch constants 36.76 and −78.387 become 30.295 and
/// −104.912 under log10(x_in) = log10(x_cm) − log10(2.54). Rounded to an integer (E3.1.2.1).
public func navyBodyFat(_ input: NavyInput) -> NavyResult {
  let (height, neck, waist) = (input.heightCm, input.neckCm, input.waistCm)
  guard [height, neck, waist, input.hipCm ?? 0].allSatisfy(\.isFinite) else {
    return .invalidGirths
  }
  let girth = input.formula == .male ? waist - neck : waist + (input.hipCm ?? .nan) - neck
  // log10 of zero or less is -infinity or NaN: refuse before computing.
  guard girth > 0, height > 0 else { return .invalidGirths }
  let exact =
    input.formula == .male
    ? 86.01 * log10(girth) - 70.041 * log10(height) + 30.295
    : 163.205 * log10(girth) - 97.684 * log10(height) - 104.912
  // The range applies to the value shown: 1.7 shows as 2 and is accepted.
  let percent = Int(jsRound(exact))
  guard navyRangePct.contains(Double(percent)) else { return .outOfRange(exact: exact) }
  return .ok(percent: percent, exact: exact)
}

/// Gallagher 2000: table 4 (African American and white, combined) is the standard set; table 5
/// is the Asian set.
public enum BodyFatReference: String, Codable, Sendable {
  case standard, asian
}

public enum AgeGroup: String, Codable, Sendable {
  case from20To39 = "20-39"
  case from40To59 = "40-59"
  case from60To79 = "60-79"
}

/// Percent body fat at a BMI of 18.5, 25 and 30.
public struct GallagherThresholds: Codable, Sendable, Equatable {
  public let at18_5: Int
  public let at25: Int
  public let at30: Int

  public init(_ at18_5: Int, _ at25: Int, _ at30: Int) {
    self.at18_5 = at18_5
    self.at25 = at25
    self.at30 = at30
  }
}

private typealias T = GallagherThresholds
private let gallagher: [BodyFatReference: [ProfileFormula: [AgeGroup: T]]] = [
  .standard: [
    .female: [.from20To39: T(21, 33, 39), .from40To59: T(23, 34, 40), .from60To79: T(24, 36, 42)],
    .male: [.from20To39: T(8, 20, 25), .from40To59: T(11, 22, 28), .from60To79: T(13, 25, 30)],
  ],
  .asian: [
    .female: [.from20To39: T(25, 35, 40), .from40To59: T(25, 35, 41), .from60To79: T(25, 36, 41)],
    .male: [.from20To39: T(13, 23, 28), .from40To59: T(13, 24, 29), .from60To79: T(14, 24, 29)],
  ],
]

/// Three bands only: the paper does not support interpolating between them.
public func ageGroup(_ ageYears: Double) -> AgeGroup? {
  guard ageYears >= 20 && ageYears < 80 else { return nil }
  return ageYears < 40 ? .from20To39 : ageYears < 60 ? .from40To59 : .from60To79
}

/// Nil outside the paper's ages, or for a formula this version does not know.
public func gallagherThresholds(
  _ formula: ProfileFormula, ageYears: Double, reference: BodyFatReference
) -> (group: AgeGroup, thresholds: GallagherThresholds)? {
  guard let group = ageGroup(ageYears),
    let thresholds = gallagher[reference]?[formula]?[group]
  else { return nil }
  return (group, thresholds)
}

/// An integer percent against integer thresholds: 21 to 32 is the band matching a BMI of 18.5
/// to 25.
public func bodyFatBand(_ percent: Int, _ t: GallagherThresholds) -> Band {
  if percent < t.at18_5 { return .below }
  if percent < t.at25 { return .reference }
  if percent < t.at30 { return .above }
  return .wellAbove
}
