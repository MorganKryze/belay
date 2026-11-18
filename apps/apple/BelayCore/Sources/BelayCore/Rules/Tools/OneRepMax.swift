// The one-rep max, ported from the shared rules. Epley 1985 as reproduced in Reynolds 2006, and
// Brzycki 1993. Reynolds 2006: no more than 10 reps in these linear equations.

/// The reps above which an estimate is no longer reliable; a record counts only sets up to it.
public let reliableMaxReps = 10
public let maxReps = 12

/// Both estimates, and whether the reps go past what the equations hold for.
public struct OneRepMax: Codable, Sendable, Equatable {
  public let epleyKg: Double
  public let brzyckiKg: Double
  public let lessReliable: Bool
}

/// At 1 rep the formula gives 1.033 × w; one rep is the max, so the max is the load.
public func epley(_ weightKg: Double, _ reps: Int) -> Double {
  reps == 1 ? weightKg : weightKg * (1 + Double(reps) / 30)
}

public func brzycki(_ weightKg: Double, _ reps: Int) -> Double {
  (weightKg * 36) / Double(37 - reps)
}

public func oneRepMax(weightKg: Double, reps: Int) throws(OutOfRange) -> OneRepMax {
  guard weightKg.isFinite && weightKg > 0 else { throw OutOfRange(message: "weight") }
  guard (1...maxReps).contains(reps) else { throw OutOfRange(message: "reps") }
  return OneRepMax(
    epleyKg: epley(weightKg, reps), brzyckiKg: brzycki(weightKg, reps),
    lessReliable: reps > reliableMaxReps)
}
