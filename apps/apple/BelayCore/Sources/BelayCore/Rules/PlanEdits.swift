import Foundation

// The changes a session may make to its own copy of the plan. Each returns a new plan; a slot is
// never taken out, so the sets stay attached to their slot index. The program never changes.

/// Why a plan edit is refused.
public enum PlanError: Error, Equatable {
  /// The plan already holds `Bounds.maxSlots` slots.
  case full
}

/// A new exercise's targets in its measure: 8 to 12 reps, or 30 to 60 seconds.
private func target(_ measure: Measure?) -> [Int] { measure == .seconds ? [30, 60] : [8, 12] }

/// Another exercise in slot `at`, for this session only. Its sets, rest, RIR and group stay; the
/// target goes back to the default when the measure changes, and a timed exercise has no
/// warm-up. The sets already done keep their own exercise.
public func replaceSlot(_ plan: [Slot], at: Int, with exercise: LibraryExercise) -> [Slot] {
  plan.enumerated().map { j, slot in
    guard j == at else { return slot }
    var out = slot
    out.exerciseId = exercise.id
    if slot.measure != exercise.measure { out.repRange = target(exercise.measure) }
    if exercise.measure == .seconds { out.warmupSets = 0 }
    out.measure = exercise.measure
    return out
  }
}

/// Slot `at` left out for today, or put back.
public func skipSlot(_ plan: [Slot], at: Int, skipped: Bool) -> [Slot] {
  plan.enumerated().map { j, slot in
    guard j == at else { return slot }
    var out = slot
    out.skipped = skipped
    return out
  }
}

/// A slot at the end with the default targets: 3 sets, 90 s, RIR 1 to 2, none to warm up.
public func appendSlot(_ plan: [Slot], _ exercise: LibraryExercise) throws -> [Slot] {
  guard plan.count < Bounds.maxSlots else { throw PlanError.full }
  let slot = Slot(
    exerciseId: exercise.id, sets: 3, repRange: target(exercise.measure), rirTarget: [1, 2],
    restSec: 90, warmupSets: 0, isMain: false, groupKey: nil, measure: exercise.measure,
    added: true)
  return plan + [slot]
}
