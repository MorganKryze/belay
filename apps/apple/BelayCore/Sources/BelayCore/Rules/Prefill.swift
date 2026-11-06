import Foundation

// What the history offers a new set: last time's load, and last time's sets as one line.

/// The sessions and sets kept on the device.
public struct History: Sendable, Equatable {
  public var workouts: [WorkoutRow]
  public var sets: [SetRow]

  public init(workouts: [WorkoutRow], sets: [SetRow]) {
    self.workouts = workouts
    self.sets = sets
  }
}

/// A set's load and its count: repetitions, or seconds for a timed set (the other one nil).
public struct Load: Codable, Sendable, Equatable {
  public var weightKg: Double
  public var reps: Int?
  public var seconds: Int?

  public init(weightKg: Double, reps: Int?, seconds: Int?) {
    self.weightKg = weightKg
    self.reps = reps
    self.seconds = seconds
  }
}

/// The measure a set was counted in: nil for repetitions.
public func measureOfSet(_ set: SetRow) -> Measure? { set.seconds == nil ? nil : .seconds }

/// The set's count in its own measure.
public func countOf(_ set: SetRow) -> Int { set.seconds ?? set.reps ?? 0 }

private func loadOf(_ set: SetRow) -> Load {
  Load(weightKg: set.weightKg, reps: set.reps, seconds: set.seconds)
}

/// The sets a person sees: neither removed nor in a removed session.
public func liveSets(_ history: History) -> [SetRow] {
  let live = Set(history.workouts.filter { !$0.removed }.map(\.id))
  return history.sets.filter { !$0.removed && live.contains($0.workoutId) }
}

/// Text in the order JavaScript compares it: by UTF-16 unit.
func precedes(_ a: String, _ b: String) -> Bool { a.utf16.lexicographicallyPrecedes(b.utf16) }

private func bySlot(_ a: SetRow, _ b: SetRow) -> Bool {
  a.slotIndex != b.slotIndex ? a.slotIndex < b.slotIndex : a.position < b.position
}

/// The work sets of an exercise at the last finished session that has some, in order; only the
/// sets counted in `measure`.
private func lastWorkSets(_ history: History, exerciseId: String, measure: Measure?) -> [SetRow] {
  let sets = liveSets(history).filter {
    !$0.warmup && $0.exerciseId == exerciseId && measureOfSet($0) == measure
  }
  let withSets = Set(sets.map(\.workoutId))
  // Of two started at the same time, the later in the list, as the web's sort leaves them.
  var last: WorkoutRow?
  for w in history.workouts where !w.removed && w.endedAt != nil && withSets.contains(w.id) {
    if let best = last, precedes(w.startedAt, best.startedAt) { continue }
    last = w
  }
  guard let last else { return [] }
  return sets.filter { $0.workoutId == last.id }.sorted(by: bySlot)
}

/// The same work set last time; else the last work set of that session; else nothing. The
/// exercise is the one the slot holds now (a replaced one included), in its own measure.
public func prefill(_ history: History, exerciseId: String, setIndex: Int, measure: Measure?)
  -> Load?
{
  let sets = lastWorkSets(history, exerciseId: exerciseId, measure: measure)
  let set = sets.indices.contains(setIndex) ? sets[setIndex] : sets.last
  return set.map(loadOf)
}

/// "80 kg x 8, 8, 7, 6" or "45, 45, 40 s": last time's work sets, the counts of equal loads in a
/// row grouped.
public func lastTime(_ history: History, exerciseId: String, measure: Measure?)
  -> [(weightKg: Double, counts: [Int])]
{
  var groups: [(weightKg: Double, counts: [Int])] = []
  for s in lastWorkSets(history, exerciseId: exerciseId, measure: measure) {
    if let last = groups.indices.last, groups[last].weightKg == s.weightKg {
      groups[last].counts.append(countOf(s))
    } else {
      groups.append((s.weightKg, [countOf(s)]))
    }
  }
  return groups
}
