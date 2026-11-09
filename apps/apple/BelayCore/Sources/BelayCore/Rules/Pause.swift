import Foundation

// A paused session. Since when it is paused stays on the device that paused it; on resume the
// session's start moves later by the time paused, so every device and the recorded duration
// leave the pause out without a new synced value. Every time read here is one the device wrote.

private func ms(_ text: String) -> Int64 {
  guard let ms = Instant.milliseconds(text) else { preconditionFailure("not an instant") }
  return ms
}

/// What a pause stops, a choice each device keeps: everything, or the session's time while the
/// rest keeps running.
public enum PauseStops: Sendable { case all, session }

/// The session's time in ms: the clock stops at the pause, and never reads below zero (a start
/// moved later elsewhere than this device's pause). Int64, as Int is 32 bits on the Watch.
public func sessionElapsed(startedAt: String, pausedAt: String?, now: Date) -> Int64 {
  let end = pausedAt.map(ms) ?? Instant.milliseconds(now)
  return max(0, end - ms(startedAt))
}

/// The start once the pause is left out: later by the time paused, counted from the start when
/// another device moved it past the pause's beginning. Never earlier than the start (a clock put
/// back during the pause), and never after the resume, which a start must not pass.
public func resumedStart(startedAt: String, pausedAt: String, resumedAt: String) -> String {
  let start = ms(startedAt)
  let resumed = ms(resumedAt)
  let paused = max(ms(pausedAt), start)
  return Instant.string(ms: min(start + max(0, resumed - paused), resumed))
}

/// A set logged after the pause began ends it, at that set's time: the first such set, or nil.
public func pauseEndedBy(pausedAt: String, doneAts: [String]) -> String? {
  let paused = ms(pausedAt)
  var first: String?
  for doneAt in doneAts where ms(doneAt) > paused {
    if let f = first, ms(doneAt) >= ms(f) { continue }
    first = doneAt
  }
  return first
}

/// The moment the rest is read at: while everything stops, the pause's beginning (never later
/// than now, a clock put back during the pause), so the rest left stands still.
public func restClock(pausedAt: String?, now: Date, stops: PauseStops) -> Date {
  guard stops == .all, let pausedAt else { return now }
  let at = min(Instant.milliseconds(now), ms(pausedAt))
  return Date(timeIntervalSince1970: Double(at) / 1000)
}

/// The rest's end once the pause is left. When everything stopped, a rest still running at the
/// pause ends later by the time paused, so it goes on from the time it had left; never earlier
/// (a clock put back during the pause).
public func resumedRestEnd(
  _ restEndsAt: String?, pausedAt: String, resumedAt: String, stops: PauseStops
) -> String? {
  guard stops == .all, let restEndsAt else { return restEndsAt }
  let end = ms(restEndsAt)
  let paused = ms(pausedAt)
  if end <= paused { return restEndsAt }
  return Instant.string(ms: end + max(0, ms(resumedAt) - paused))
}
