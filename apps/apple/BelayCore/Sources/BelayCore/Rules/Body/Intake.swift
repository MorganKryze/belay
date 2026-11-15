// A day's intake as two totals, ported from the shared rules.

/// Whole kilocalories, 0 to 10 000; a typed 2 130 is fine, whatever the stepper's nudge.
public func isKcal(_ value: Double) -> Bool { isWhole(value, max: Bounds.kcalMax) }

/// Whole grams of protein, 0 to 500.
public func isProteinG(_ value: Double) -> Bool { isWhole(value, max: Bounds.proteinGMax) }

private func isWhole(_ value: Double, max: Int) -> Bool {
  value.isFinite && value.rounded() == value && value >= 0 && value <= Double(max)
}

/// A week's averages: calories over the days that have them (their count is `days`), protein
/// over the days that have protein. No threshold, no verdict.
public struct WeeklyIntake: Codable, Sendable, Equatable {
  public var kcalAvg: Double?
  public var proteinAvg: Double?
  public var days: Int
}

private func mean(_ values: [Int]) -> Double? {
  values.isEmpty ? nil : Double(values.reduce(0, +)) / Double(values.count)
}

/// The week from Monday `weekStart`.
public func weeklyIntake(_ logs: [IntakeRow], weekStart: String) -> WeeklyIntake {
  let end = addDays(weekStart, 6)
  let week = logs.filter { $0.date >= weekStart && $0.date <= end }
  let kcal = week.compactMap(\.kcal)
  return WeeklyIntake(
    kcalAvg: mean(kcal), proteinAvg: mean(week.compactMap(\.proteinG)), days: kcal.count)
}
