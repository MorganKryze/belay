import Foundation

// Weights in kg or lb, as the web reads and types them. Everything is stored in kg on its own
// grid (a set's 0.25 kg, a weigh-in's 0.1 kg); pounds exist only where a person types or reads a
// weight. The vector tests hold each rule to the web's.

/// The unit a person reads and types weights in; its raw value is the web's preference value.
public enum WeightUnit: String, Sendable, Codable, CaseIterable {
  case kg, lb
}

/// The international pound (1959), exact: no other file holds a conversion factor.
public let kgPerLb = 0.45359237
public func kgToLb(_ kg: Double) -> Double { kg / kgPerLb }
public func lbToKg(_ lb: Double) -> Double { lb * kgPerLb }

/// A set's load. lb: whole pounds, stored on the 0.25 kg grid. A whole pound is 0.454 kg, so the
/// nearest quarter kilo is within 0.125 kg and every whole pound up to 1 102 reads back. Half
/// pounds do not all survive the grid, hence the round to the whole pound first.
public func kgFromLoad(_ value: Double, _ unit: WeightUnit) -> Double {
  unit == .kg ? value : roundTo(lbToKg(jsRound(value)), step: 0.25)
}
public func loadFromKg(_ kg: Double, _ unit: WeightUnit) -> Double {
  unit == .kg ? kg : jsRound(kgToLb(kg))
}

/// A weigh-in. lb: quarter pounds, stored on the 0.1 kg grid. Each quarter pound lands on a
/// different stored kg, and reads back exactly.
public func kgFromWeighing(_ value: Double, _ unit: WeightUnit) -> Double {
  unit == .kg ? value : roundTo(lbToKg(value), step: 0.1)
}
public func weighingFromKg(_ kg: Double, _ unit: WeightUnit) -> Double {
  unit == .kg ? kg : roundTo(kgToLb(kg), step: 0.25)
}

/// A kg step's lb counterpart, a round number of pounds near twice the step; the weigh-in's
/// 0.1 kg takes the quarter pound, the finest step that never lands twice on the same stored kg.
private let lbSteps: [(kg: Double, lb: Double)] = [
  (0.1, 0.25), (0.25, 0.5), (0.5, 1), (1, 2), (2.5, 5),
]
public func stepIn(_ stepKg: Double, _ unit: WeightUnit) -> Double {
  if unit == .kg { return stepKg }
  return lbSteps.first { $0.kg == stepKg }?.lb ?? 10
}

/// kg bounds in the unit, rounded inward to the step so a value inside them converts back inside
/// the kg bounds: (20...400, lb, 0.25) gives 44.25...881.75.
public func rangeIn(
  _ range: ClosedRange<Double>, _ unit: WeightUnit, step: Double
) -> ClosedRange<Double> {
  if unit == .kg { return range }
  let scale = pow(10, Double(decimalsOf(step)))
  let steps = { (lb: Double) in lb * scale / jsRound(step * scale) }
  // The epsilon keeps a bound that converts to an exact step from moving one step in.
  let low = roundTo((steps(kgToLb(range.lowerBound)) - 1e-9).rounded(.up) * step, step: step)
  let high = roundTo((steps(kgToLb(range.upperBound)) + 1e-9).rounded(.down) * step, step: step)
  return low...high
}

/// The step between two loads in pounds, as plates and dumbbells come in a pound gym.
public let incrementLb: [Equipment: Double] = [
  .barbell: 5, .dumbbell: 5, .machine: 10, .cable: 5, .bodyweight: 5, .other: 2,
]
public func incrementIn(_ e: LibraryExercise, _ unit: WeightUnit) -> Double {
  unit == .kg ? e.incrementKg : incrementLb[e.equipment] ?? 5
}

/// A pound gym's bar and plates.
public let poundPlates: (barLb: Double, platesLb: [Double]) = (45, [45, 35, 25, 10, 5, 2.5])

/// A prefilled weight shown in pounds, confirmed as shown, gives back its exact kg: 100 kg reads
/// "220" lb, which converts to 99.75, yet the person changed nothing. Any other typed kg stands.
public func readBack(_ typedKg: Double, prefill: (kg: Double, shownKg: Double)?) -> Double {
  if let prefill, typedKg == prefill.shownKg { return prefill.kg }
  return typedKg
}

/// A typed load to kg on the set grid, or nil outside the set's bounds once converted. Only a
/// prefill that is itself a valid load is given back, so a stray value never slips past them.
public func loadKgFrom(_ value: Double, _ unit: WeightUnit, prefillKg: Double?) -> Double? {
  var kg = kgFromLoad(value, unit)
  if let prefillKg, isSetKg(prefillKg) {
    kg = readBack(kg, prefill: (prefillKg, kgFromLoad(loadFromKg(prefillKg, unit), unit)))
  }
  return isSetKg(kg) ? kg : nil
}

/// A typed weigh-in to kg on its 0.1 kg grid, or nil outside the weigh-in's bounds.
public func weighingKgFrom(_ value: Double, _ unit: WeightUnit) -> Double? {
  let kg = kgFromWeighing(value, unit)
  return isWeighingKg(kg) ? kg : nil
}

/// The loads a set card offers: one step down, the current load, one and two steps up, in the
/// unit shown. The current one is its exact kilos in either unit, even off the grid or when its
/// pounds convert to a neighbor on it; a step outside the set's bounds is left out, and so is a
/// step off the grid, which in kg is any step from a current load off it.
public func loadChoices(weightKg: Double, stepInUnit: Double, _ unit: WeightUnit) -> [Double] {
  let shown = loadFromKg(weightKg, unit)
  let current = (Bounds.setKgMin...Bounds.setKgMax).contains(weightKg) ? weightKg : nil
  var out: [Double] = []
  for steps in [-1.0, 0, 1, 2] {
    let choice = steps == 0 ? current : loadKgFrom(shown + steps * stepInUnit, unit, prefillKg: weightKg)
    guard let kg = choice, !out.contains(kg) else { continue }
    out.append(kg)
  }
  return out
}
