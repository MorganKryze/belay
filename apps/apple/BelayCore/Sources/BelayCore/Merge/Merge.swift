import Foundation

/// Last write wins, field by field. Strictly later wins: on a tie what is stored stays, so
/// replaying a batch that was already applied changes nothing. Times compare as instants, with
/// or without their milliseconds; one that cannot be read never wins, as `Date.parse` gives NaN.
public func isNewer(_ incoming: String, _ existing: String?) -> Bool {
  guard let existing else { return true }
  guard let incomingMs = Instant.milliseconds(incoming),
    let existingMs = Instant.milliseconds(existing)
  else { return false }
  return incomingMs > existingMs
}

/// A change's time brought back to `now` when the phone's clock ran ahead, which would otherwise
/// win every later edit made elsewhere; any other time is kept as written.
public func clampAt(_ at: String, now: Date) -> String {
  guard let ms = Instant.milliseconds(at), ms > Instant.milliseconds(now) else { return at }
  return Instant.string(now)
}
