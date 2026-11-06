import Foundation

// The order a session's work sets come in, read off its plan. Pure, as the shared rules.

/// A work set of the plan: its slot and its round (the k-th work set of the slot).
public struct Turn: Codable, Sendable, Hashable {
  public var slotIndex: Int
  public var round: Int

  public init(slotIndex: Int, round: Int) {
    self.slotIndex = slotIndex
    self.round = round
  }
}

/// A turn as a set of turns done holds it: `slotIndex|round`.
public func turnKey(_ turn: Turn) -> String { "\(turn.slotIndex)|\(turn.round)" }

/// The turn a work set was done as.
public func turnOf(_ set: SetRow) -> Turn {
  Turn(slotIndex: set.slotIndex, round: set.position - Bounds.maxWarmups)
}

/// The slot indexes of a slot's group (consecutive slots of one `groupKey`), or the slot alone.
public func groupOf(_ plan: [Slot], slotIndex: Int) -> [Int] {
  guard plan.indices.contains(slotIndex), let key = plan[slotIndex].groupKey else {
    return [slotIndex]
  }
  var first = slotIndex
  while first > 0 && plan[first - 1].groupKey == key { first -= 1 }
  var out: [Int] = []
  var i = first
  while i < plan.count && plan[i].groupKey == key {
    out.append(i)
    i += 1
  }
  return out
}

/// The slots done today, in order.
public func liveSlots(_ plan: [Slot]) -> [Int] {
  plan.indices.filter { plan[$0].skipped != true }
}

/// A slot's group without the slots skipped today.
func liveGroup(_ plan: [Slot], slotIndex: Int) -> [Int] {
  groupOf(plan, slotIndex: slotIndex).filter { plan[$0].skipped != true }
}

/// The order the work sets come in: slot after slot; in a group, round after round across its
/// slots (A1 B1 C1, A2 B2 C2...), a slot with fewer sets dropping out of the later rounds. A slot
/// skipped today has no turn.
public func workOrder(_ plan: [Slot]) -> [Turn] {
  var out: [Turn] = []
  var seen = Set<Int>()
  for i in liveSlots(plan) where !seen.contains(i) {
    let group = liveGroup(plan, slotIndex: i)
    seen.formUnion(group)
    let rounds = group.map { plan[$0].sets }.max() ?? 0
    for round in 0..<max(rounds, 0) {
      for g in group where round < plan[g].sets {
        out.append(Turn(slotIndex: g, round: round))
      }
    }
  }
  return out
}

/// The next work set not done: after `from` in the order, else the first one left behind.
public func nextTurn(_ plan: [Slot], done: Set<String>, from: Turn? = nil) -> Turn? {
  let order = workOrder(plan)
  // A turn not in the order starts from the beginning, as `findIndex` gives -1.
  let start =
    from.map { from in (order.firstIndex { turnKey($0) == turnKey(from) } ?? -1) + 1 } ?? 0
  let isOpen = { (turn: Turn) in !done.contains(turnKey(turn)) }
  return order[start...].first(where: isOpen) ?? order[..<start].first(where: isOpen)
}

/// The work sets the plan asks for, a skipped slot's aside.
public func plannedWorkSets(_ plan: [Slot]) -> Int {
  plan.reduce(0) { $0 + ($1.skipped == true ? 0 : $1.sets) }
}

/// Every set, warm-ups included, takes 45 s plus its slot's rest; rounded to 5 minutes, never
/// under 5. A slot skipped for the session counts for nothing.
public func estimatedMinutes(_ slots: [Slot]) -> Int {
  let seconds = slots.filter { $0.skipped != true }.reduce(0) {
    $0 + ($1.sets + $1.warmupSets) * (45 + $1.restSec)
  }
  return max(5, Int(jsRound(Double(seconds) / 300)) * 5)
}

/// `Math.round`: to the nearest whole number, a half rounded up, toward positive infinity.
func jsRound(_ value: Double) -> Double {
  let floor = value.rounded(.down)
  return value - floor >= 0.5 ? floor + 1 : floor
}
