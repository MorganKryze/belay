import Foundation

// What a finished session adds up to: its time, its sets, its volume and its records.

/// The reps above which a one-rep-max estimate is no longer reliable (Reynolds 2006).
public let reliableMaxReps = 10

/// The Epley estimate of a one-rep max; one rep is the max itself.
public func epley(_ weightKg: Double, _ reps: Int) -> Double {
  reps == 1 ? weightKg : weightKg * (1 + Double(reps) / 30)
}

/// A finished session in figures. The volume is Σ kg × reps of the work sets counted in reps (a
/// bodyweight set counts its added load); a timed set adds nothing.
public struct SessionTotals: Sendable, Equatable {
  public struct Record: Sendable, Equatable {
    public var exerciseId: String
    public var load: Load
  }

  public var durationMs: Int64
  public var workSets: Int
  public var warmupSets: Int
  public var volumeKg: Double
  public var records: [Record]
}

/// The score a record compares: the Epley estimate of a work set of 1 to 10 reps, or a timed
/// set's seconds; nil for a set that cannot be a record.
private func scoreOf(_ s: SetRow) -> Double? {
  if s.warmup { return nil }
  if let seconds = s.seconds { return seconds > 0 ? Double(seconds) : nil }
  guard let reps = s.reps, (1...reliableMaxReps).contains(reps) else { return nil }
  return epley(s.weightKg, reps)
}

/// The first set with the highest score in `measure`.
private func best(_ sets: [SetRow], measure: Measure?) -> SetRow? {
  var top: (set: SetRow, score: Double)?
  for s in sets where measureOfSet(s) == measure {
    guard let score = scoreOf(s) else { continue }
    if top == nil || score > top!.score { top = (s, score) }
  }
  return top?.set
}

/// A record is the best Epley estimate of a work set of 10 reps or fewer, or the longest timed
/// set, above every earlier finished session's; never on an exercise's first time in that measure.
public func summary(_ workout: WorkoutRow, sets: [SetRow], history: History) -> SessionTotals {
  let own = sets.filter { !$0.removed && $0.workoutId == workout.id }.sorted {
    $0.slotIndex != $1.slotIndex ? $0.slotIndex < $1.slotIndex : $0.position < $1.position
  }
  let work = own.filter { !$0.warmup }
  let earlier = Set(
    history.workouts
      .filter { $0.id != workout.id && !$0.removed && $0.endedAt != nil }
      .filter { precedes($0.startedAt, workout.startedAt) }
      .map(\.id))
  let past = liveSets(history).filter { earlier.contains($0.workoutId) }
  // Each exercise and measure once, in the order the session met them.
  var kinds: [(exerciseId: String, measure: Measure?)] = []
  for s in work where !kinds.contains(where: { $0.exerciseId == s.exerciseId && $0.measure == measureOfSet(s) }) {
    kinds.append((s.exerciseId, measureOfSet(s)))
  }
  let records = kinds.compactMap { kind -> SessionTotals.Record? in
    guard let now = best(work.filter { $0.exerciseId == kind.exerciseId }, measure: kind.measure),
      let before = best(past.filter { $0.exerciseId == kind.exerciseId }, measure: kind.measure),
      scoreOf(now)! > scoreOf(before)!
    else { return nil }
    return .init(exerciseId: kind.exerciseId, load: Load(weightKg: now.weightKg, reps: now.reps, seconds: now.seconds))
  }
  let duration: Int64 =
    if let ended = workout.endedAt.flatMap(Instant.milliseconds),
      let started = Instant.milliseconds(workout.startedAt)
    {
      ended - started
    } else { 0 }
  return SessionTotals(
    durationMs: duration, workSets: work.count, warmupSets: own.count - work.count,
    volumeKg: work.reduce(0) { sum, s in sum + (s.reps.map { s.weightKg * Double($0) } ?? 0) },
    records: records)
}
