import Foundation

// Warm-up sets before a slot's work sets. No study validates a warm-up scheme (Ribeiro 2020 is
// the closest evidence): this is Belay's heuristic.

/// One warm-up set on a loaded bar.
public struct WarmupSet: Codable, Sendable, Equatable {
  public let loadKg: Double
  public let reps: Int
  public let perSideKg: [Double]

  public init(loadKg: Double, reps: Int, perSideKg: [Double]) {
    self.loadKg = loadKg
    self.reps = reps
    self.perSideKg = perSideKg
  }
}

/// The fraction of the working load and the reps of each set, by number of sets.
public let warmupSchemes: [Int: [(fraction: Double, reps: Int)]] = [
  1: [(0.6, 5)],
  2: [(0.5, 5), (0.75, 3)],
  3: [(0.4, 5), (0.6, 3), (0.8, 1)],
]

/// How many warm-up sets a working load calls for.
public func defaultWarmupCount(workKg: Double) -> Int { workKg < 60 ? 1 : workKg < 120 ? 2 : 3 }

/// Each load rounded to what the bar can load, never under the bar. Two sets that round to the
/// same load become one (the earlier, longer set stays), and a set that would reach the working
/// load is dropped.
public func warmupSets(workKg: Double, count: Int, barKg: Double, platesKg: [Double])
  -> [WarmupSet]
{
  guard workKg > barKg, let scheme = warmupSchemes[count] else { return [] }
  var sets: [WarmupSet] = []
  for (fraction, reps) in scheme {
    let loading = nearestLoading(workKg * fraction, barKg: barKg, platesKg: platesKg)
    if loading.totalKg >= workKg || sets.contains(where: { $0.loadKg == loading.totalKg }) {
      continue
    }
    sets.append(WarmupSet(loadKg: loading.totalKg, reps: reps, perSideKg: loading.perSideKg))
  }
  return sets
}

/// The warm-up sets of a slot, in kg. A barbell is loaded on the person's bar and plates;
/// anything else takes the same fractions and reps, rounded to the exercise's step, never 0 or
/// less, never the working load or more. No working load yet, or one past what the plate table
/// handles (a typo like 8000): no warm-up, so the set stays as typed.
public func warmups(_ slot: Slot, workKg: Double?, exercise: LibraryExercise, bar: Plates)
  -> [Load]
{
  guard let workKg, slot.warmupSets != 0, workKg.isFinite, workKg <= maxTargetKg,
    let scheme = warmupSchemes[slot.warmupSets]
  else { return [] }
  let candidates: [(load: Double, reps: Int)] =
    exercise.equipment == .barbell
    ? warmupSets(workKg: workKg, count: slot.warmupSets, barKg: bar.barKg, platesKg: bar.platesKg)
      .map { ($0.loadKg, $0.reps) }
    : scheme.map { (roundTo(workKg * $0.fraction, step: exercise.incrementKg), $0.reps) }
  var out: [Load] = []
  for (load, reps) in candidates {
    if load <= 0 || load >= workKg || out.contains(where: { $0.weightKg == load }) { continue }
    out.append(Load(weightKg: load, reps: reps, seconds: nil))
  }
  return out
}

/// Decimals of a step written in base 10: 2.5 is 1, 0.05 is 2, 10 is 0.
private func decimalsOf(_ step: Double) -> Int {
  if step.rounded() == step { return 0 }
  let text = "\(step)"
  guard let dot = text.firstIndex(of: ".") else { return 0 }
  return text.distance(from: dot, to: text.endIndex) - 1
}

/// The nearest multiple of `step`, without binary noise. Scales by a power of ten rather than
/// dividing by the step, as the web does, so x.x5 ties round up as printed.
func roundTo(_ value: Double, step: Double) -> Double {
  let scale = pow(10, Double(decimalsOf(step)))
  let scaledStep = jsRound(step * scale)
  return jsRound(jsRound(value * scale / scaledStep) * scaledStep) / scale
}
