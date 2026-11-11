import Foundation

// A paused session. Since when it is paused stays on the device that paused it; on resume the
// session's start moves later by the time paused, so every device and the recorded duration
// leave the pause out without a new synced value. A time the phone cannot read, which only a
// server or contract at fault sends, is left out or read as no pause, as the web's NaN leaves it:
// the cover reads these at every change and tick, so stopping on one would close the app at each
// launch while the session is open.

private func ms(_ text: String) -> Int64? { Instant.milliseconds(text) }

/// What a pause stops, a choice each device keeps: everything, or the session's time while the
/// rest keeps running.
public enum PauseStops: Sendable { case all, session }

/// The session's time in ms: the clock stops at the pause, and never reads below zero (a start
/// moved later elsewhere than this device's pause). Int64, as Int is 32 bits on the Watch. Zero
/// for a start that cannot be read.
public func sessionElapsed(startedAt: String, pausedAt: String?, now: Date) -> Int64 {
  guard let start = ms(startedAt) else { return 0 }
  let end = pausedAt.flatMap(ms) ?? Instant.milliseconds(now)
  return max(0, end - start)
}

/// The start once the pause is left out: later by the time paused, counted from the start when
/// another device moved it past the pause's beginning. Never earlier than the start (a clock put
/// back during the pause), and never after the resume, which a start must not pass. Unchanged
/// when one of the three cannot be read.
public func resumedStart(startedAt: String, pausedAt: String, resumedAt: String) -> String {
  guard let start = ms(startedAt), let resumed = ms(resumedAt), let pausedMs = ms(pausedAt)
  else { return startedAt }
  let paused = max(pausedMs, start)
  return Instant.string(ms: min(start + max(0, resumed - paused), resumed))
}

/// A set logged after the pause began ends it, at that set's time: the first such set, or nil.
/// A set whose time cannot be read ends nothing, and a pause that cannot be read is ended by none.
public func pauseEndedBy(pausedAt: String, doneAts: [String]) -> String? {
  guard let paused = ms(pausedAt) else { return nil }
  var first: (text: String, at: Int64)?
  for doneAt in doneAts {
    guard let at = ms(doneAt), at > paused else { continue }
    if let f = first, at >= f.at { continue }
    first = (doneAt, at)
  }
  return first?.text
}

/// The moment the rest is read at: while everything stops, the pause's beginning (never later
/// than now, a clock put back during the pause), so the rest left stands still. Now, for a pause
/// that cannot be read.
public func restClock(pausedAt: String?, now: Date, stops: PauseStops) -> Date {
  guard stops == .all, let paused = pausedAt.flatMap(ms) else { return now }
  let at = min(Instant.milliseconds(now), paused)
  return Date(timeIntervalSince1970: Double(at) / 1000)
}

/// The rest's end once the pause is left. When everything stopped, a rest still running at the
/// pause ends later by the time paused, so it goes on from the time it had left; never earlier
/// (a clock put back during the pause). Unchanged when one of the three cannot be read.
public func resumedRestEnd(
  _ restEndsAt: String?, pausedAt: String, resumedAt: String, stops: PauseStops
) -> String? {
  guard stops == .all, let restEndsAt, let end = ms(restEndsAt), let paused = ms(pausedAt),
    let resumed = ms(resumedAt)
  else { return restEndsAt }
  if end <= paused { return restEndsAt }
  return Instant.string(ms: end + max(0, resumed - paused))
}
