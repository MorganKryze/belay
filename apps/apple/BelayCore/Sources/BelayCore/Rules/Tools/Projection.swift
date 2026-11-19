import Foundation

// The loss projection, ported from the shared rules. Rates: Garthe 2011 and Helms 2014, 0.5 to
// 1 % of body weight per week. The +30 % that gives the late date has no source: the whole date
// range is a Belay heuristic.

public struct RatePreset: Sendable, Equatable {
  public let id: String
  public let pct: Double
}

public let ratePresets = [
  RatePreset(id: "gentle", pct: 0.5),
  RatePreset(id: "balanced", pct: 0.75),
  RatePreset(id: "steady", pct: 1),
]
public let rateMinPct = 0.25
public let rateMaxPct = 2.5
public let rateStepPct = 0.05

public enum RateWarning: String, Sendable {
  case none
  case above1 = "above-1"
  case above15 = "above-1.5"
}

public func rateWarning(_ pctPerWeek: Double) -> RateWarning {
  pctPerWeek > 1.5 ? .above15 : pctPerWeek > 1 ? .above1 : .none
}

public func kgPerWeek(_ currentKg: Double, pctPerWeek: Double) -> Double {
  (currentKg * pctPerWeek) / 100
}

/// ⌈1.3 × n⌉ in integers: 13 × n / 10 is exact, 1.3 × n is not always.
public func slowWeeks(_ fastWeeks: Int) -> Int {
  Int((Double(13 * fastWeeks) / 10).rounded(.up))
}

/// The fast and slow ends of the range, in weeks and as the days they fall on.
public enum Projection: Sendable, Equatable {
  case ok(weeksLow: Int, weeksHigh: Int, dateLow: String, dateHigh: String)
  case targetNotBelow
}

/// From `today`, a local day: calendar weeks, so a daylight-saving change or the new year never
/// shifts the date.
public func projectLoss(currentKg: Double, targetKg: Double, pctPerWeek: Double, today: String)
  throws(OutOfRange) -> Projection
{
  guard currentKg.isFinite && currentKg > 0, targetKg.isFinite && targetKg > 0 else {
    throw OutOfRange(message: "weight")
  }
  guard pctPerWeek >= rateMinPct && pctPerWeek <= rateMaxPct else {
    throw OutOfRange(message: "rate")
  }
  guard targetKg < currentKg else { return .targetNotBelow }
  // Lose pct of the current weight each week: kg per week shrink as weight falls.
  let raw = log(targetKg / currentKg) / log(1 - pctPerWeek / 100)
  let weeksLow = max(1, Int((raw - 1e-9).rounded(.up)))  // 12.0000000001 is 12 weeks, not 13
  let weeksHigh = slowWeeks(weeksLow)
  return .ok(
    weeksLow: weeksLow, weeksHigh: weeksHigh, dateLow: addDays(today, 7 * weeksLow),
    dateHigh: addDays(today, 7 * weeksHigh))
}
