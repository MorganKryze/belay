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

/// How many work sets a session holds: kept, warm-ups left out.
public func workSetsOf(_ h: History, workoutId: String) -> Int {
  liveSets(h).count(where: { $0.workoutId == workoutId && !$0.warmup })
}

/// The latest start of those kept and ended, by its text as the web compares it.
private func latest(_ workouts: [WorkoutRow], where keep: (WorkoutRow) -> Bool) -> WorkoutRow? {
  workouts.reduce(nil) { last, w in
    guard w.endedAt != nil, !w.removed, keep(w) else { return last }
    return last.map { precedes($0.startedAt, w.startedAt) ? w : $0 } ?? w
  }
}

/// The last session kept and ended whose day (the day it started, in `timeZone`) is `day`, with
/// its length and its work sets: Accueil's "done today". Nil when there is none.
public func finishedOn(_ h: History, day: String, timeZone: TimeZone)
  -> (workout: WorkoutRow, durationMs: Int, workSets: Int)?
{
  guard let last = latest(h.workouts, where: { dayOf($0, timeZone: timeZone) == day }) else {
    return nil
  }
  // Ended, so endedAt is set; a time that does not read counts as no length.
  let duration =
    Instant.milliseconds(last.endedAt!).flatMap { ended in
      Instant.milliseconds(last.startedAt).map { Int(ended - $0) }
    } ?? 0
  return (last, duration, workSetsOf(h, workoutId: last.id))
}

/// The last session done as this rotation session (`startedAs`) that ended and was kept, if any:
/// the preview's "last time" and the program card's day.
public func lastFinished(_ workouts: [WorkoutRow], session: LetteredTemplate) -> WorkoutRow? {
  latest(workouts, where: { startedAs($0, session) })
}
