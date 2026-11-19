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

/// A change merged on its own key, as the server keys it: a day, a day's field, an id's field.
public protocol KeyedChange: Sendable {
  var at: String { get set }
  var mergeKey: String { get }
}

/// The change to write for each key, its time clamped, or none when what is stored under that
/// key (`stored`, by key; a key never written is absent) is as recent. Keys come in the order
/// they first appear. Against what is stored the rule is strict; inside the batch a later change
/// wins a tie, because two edits clamped to the same `now` still arrive in the order made.
public func mergeFields<C: KeyedChange>(stored: [String: String], changes: [C], now: Date) -> [C] {
  var order: [String] = []
  var byKey: [String: [C]] = [:]
  for change in changes {
    if byKey[change.mergeKey] == nil { order.append(change.mergeKey) }
    byKey[change.mergeKey, default: []].append(change)
  }
  return order.compactMap { key in
    var winner: C?
    for change in byKey[key] ?? [] {
      var clamped = change
      clamped.at = clampAt(change.at, now: now)
      if winner.map({ !isNewer($0.at, clamped.at) }) ?? isNewer(clamped.at, stored[key]) {
        winner = clamped
      }
    }
    return winner
  }
}
