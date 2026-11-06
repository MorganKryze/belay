import Foundation

// Where a session stands, which one is open, and when a forgotten one closes.

/// Where an open session stands: the planned work sets done (by `turnKey`), how many are left,
/// the last one done and the one up next. Warm-ups, skipped slots and sets past the plan are
/// aside.
public struct SessionProgress: Sendable, Equatable {
  public var done: Set<String>
  public var left: Int
  public var last: Turn?
  public var next: Turn?
}

public func sessionProgress(_ plan: [Slot], sets: [SetRow]) -> SessionProgress {
  let work = sets.filter { s in
    guard !s.warmup, plan.indices.contains(s.slotIndex) else { return false }
    let slot = plan[s.slotIndex]
    return slot.skipped != true && s.position - Bounds.maxWarmups < slot.sets
  }
  let done = Set(work.map { turnKey(turnOf($0)) })
  // The latest done; of two done at the same time, the later in the list.
  var latest: SetRow?
  for s in work {
    if let best = latest, precedes(s.doneAt, best.doneAt) { continue }
    latest = s
  }
  let last = latest.map(turnOf)
  return SessionProgress(
    done: done, left: plannedWorkSets(plan) - done.count, last: last,
    next: nextTurn(plan, done: done, from: last))
}

/// A session left open is closed at its last set once that set is more than 6 hours old; one
/// without a set is removed after 6 hours. In milliseconds.
public let forgottenMs = 6 * 3_600_000

/// What happens to a session left open.
public enum Closing: Sendable, Equatable {
  case keep
  case end(endedAt: String)
  case remove
}

/// The instant `text` names in milliseconds, NaN when it names none, as `Date.parse` gives.
func parsedMs(_ text: String) -> Double {
  Instant.milliseconds(text).map(Double.init) ?? .nan
}

/// Whether a session left open is kept, ended or removed at `now`.
///
/// A resume moves the start later by the time paused, and its change is written at the resume
/// (`startedAtAt`). When that came after the last set, the session ends at the resume instead:
/// ending at the set would take the pause out of time trained before it, down to a negative
/// duration.
public func autoClose(_ workout: WorkoutRow, sets: [SetRow], now: Date) -> Closing {
  if workout.endedAt != nil || workout.removed { return .keep }
  let nowMs = Double(Instant.milliseconds(now))
  let forgotten = Double(forgottenMs)
  // The latest time as text, as the web sorts the times.
  let lastSet = sets.filter { !$0.removed && $0.workoutId == workout.id }.map(\.doneAt)
    .max(by: precedes)
  guard let lastSet else {
    return nowMs - parsedMs(workout.startedAt) > forgotten ? .remove : .keep
  }
  let last =
    if let moved = workout.startedAtAt, !moved.isEmpty, parsedMs(moved) > parsedMs(lastSet) {
      moved
    } else {
      lastSet
    }
  return nowMs - parsedMs(last) > forgotten ? .end(endedAt: last) : .keep
}

/// The session in progress, if any: the latest one neither finished nor removed. With
/// `forgotten`, a session `autoClose` would close is not open: it is only waiting for the next
/// landed sync to be closed.
public func openWorkout(_ workouts: [WorkoutRow], forgotten: (sets: [SetRow], now: Date)? = nil)
  -> WorkoutRow?
{
  var last: WorkoutRow?
  for w in workouts where w.endedAt == nil && !w.removed {
    if let forgotten, autoClose(w, sets: forgotten.sets, now: forgotten.now) != .keep { continue }
    // Of two started at the same time, the first in the list.
    if let best = last, !precedes(best.startedAt, w.startedAt) { continue }
    last = w
  }
  return last
}
