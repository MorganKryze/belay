import Foundation

// The rest that follows a work set. Inside a group's round, none: the next exercise follows.

/// The rest planned after a set of this slot: the group's is its last slot's, even when that
/// slot is skipped today.
public func restSecAfter(_ plan: [Slot], slotIndex: Int) -> Int {
  // A group always holds the slot asked for, so it is never empty.
  plan[groupOf(plan, slotIndex: slotIndex).last!].restSec
}

/// When the rest after `after` ends, done at `doneAt`: after the round, or after a slot alone,
/// the rest of the group's last slot (or the slot's own). A slot skipped today has no turn in the
/// round. After the last set of the session, or with no rest planned, none.
public func restEndsAt(_ plan: [Slot], done: Set<String>, after: Turn, doneAt: String) -> String? {
  guard let next = nextTurn(plan, done: done, from: after) else { return nil }
  let group = liveGroup(plan, slotIndex: after.slotIndex)
  if group.count > 1 && group.contains(next.slotIndex) && next.round == after.round { return nil }
  let restSec = restSecAfter(plan, slotIndex: after.slotIndex)
  // The device writes every set's time, so it always reads; the web would throw on one that
  // does not, and here it gets no rest end.
  guard restSec > 0, let ms = Instant.milliseconds(doneAt) else { return nil }
  return Instant.string(ms: ms + Int64(restSec) * 1000)
}
