import Foundation

// The line under a set's load: how it compares with last time, in one plain sentence. It never
// suggests a load for next time.

/// What the line says; the screen words it.
public enum Progression: Sendable, Equatable {
  case warmup
  /// The same load as last time (or lighter): aim for the top of the range.
  case sameLoad(top: Int)
  case heavier(byKg: Double)
  /// No earlier session with this exercise in this measure: the target.
  case firstTime(low: Int, high: Int)
  case holdLonger(bySeconds: Int, last: Int)
  case holdSame(last: Int)
}

/// The line for the set of `slot` at `setIndex` (its k-th work set), about to be done with
/// `weightKg` and `count`, compared with the same set last time by the shared prefill rule.
public func progression(
  history: History, slot: Slot, setIndex: Int, warmup: Bool, weightKg: Double, count: Int
) -> Progression {
  if warmup { return .warmup }
  let low = slot.repRange.first ?? 0
  let high = slot.repRange.last ?? low
  guard
    let last = prefill(
      history, exerciseId: slot.exerciseId, setIndex: setIndex, measure: slot.measure)
  else { return .firstTime(low: low, high: high) }
  if slot.measure == .seconds {
    let held = last.seconds ?? 0
    return count > held ? .holdLonger(bySeconds: count - held, last: held) : .holdSame(last: held)
  }
  return weightKg > last.weightKg ? .heavier(byKg: weightKg - last.weightKg) : .sameLoad(top: high)
}
