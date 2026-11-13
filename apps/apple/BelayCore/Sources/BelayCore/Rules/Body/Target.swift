// The weekly loss range of the profile, ported from the shared rules.

/// The range, in percent of the average weight per week.
public struct TargetRange: Codable, Sendable, Equatable {
  public var minPct: Double
  public var maxPct: Double

  public init(minPct: Double, maxPct: Double) {
    self.minPct = minPct
    self.maxPct = maxPct
  }
}

public let defaultTarget = TargetRange(minPct: 0.5, maxPct: 1)

/// 0.25 to 1 % in steps of 0.05, at least 0.1 apart. Published recommendations stop at 1 %.
private let targetMin = 0.25
private let targetMax = 1.0
private let targetGap = 0.1

/// Checked in hundredths, so 0.85 ≤ 0.95 − 0.1 holds although 0.95 − 0.1 is 0.8499… in floats.
public func isTargetRange(_ range: TargetRange) -> Bool {
  guard range.minPct.isFinite, range.maxPct.isFinite else { return false }
  let (lo, hi) = (range.minPct * 100, range.maxPct * 100)
  let onGrid = { (v: Double) in
    abs(v - jsRound(v)) < 1e-6 && jsRound(v).truncatingRemainder(dividingBy: 5) == 0
  }
  return onGrid(lo) && onGrid(hi) && jsRound(lo) >= targetMin * 100
    && jsRound(hi) <= targetMax * 100 && jsRound(lo) <= jsRound(hi) - targetGap * 100
}

/// Compares the loss as it is shown, to the tenth of a percent, so the "in your range" words
/// never contradict the number next to them.
public func inTargetRange(_ lossPct: Double, _ range: TargetRange) -> Bool {
  let shown = roundTo(lossPct, step: 0.1)
  return shown >= range.minPct && shown <= range.maxPct
}
