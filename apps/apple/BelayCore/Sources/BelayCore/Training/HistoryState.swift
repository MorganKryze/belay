import Foundation

// Historique: the sessions kept and ended, newest first, by week from Monday on the local day; and
// a past session opened, its exercises with their sets.

/// A session kept, as its row shows it.
public struct HistoryRow: Sendable, Equatable, Identifiable {
  public var workoutId: String
  public var code: String
  public var name: String?
  /// The session it recorded, nil when it recorded none.
  public var sessionId: String?
  /// The day it started on, where the person is.
  public var day: String
  public var startedAt: String
  public var durationMs: Int
  /// The work sets' kilograms times reps, as the summary counts them.
  public var volumeKg: Double
  /// The floor given on this phone; nil when it holds none.
  public var effort: Int?

  public var id: String { workoutId }
}

/// A week, Monday to Sunday, with its sessions newest first and their count and total length.
public struct HistoryWeek: Sendable, Equatable, Identifiable {
  public var start: String
  public var end: String
  /// The week holding today: « Cette semaine ».
  public var isCurrent: Bool
  public var count: Int
  public var durationMs: Int
  public var rows: [HistoryRow]

  public var id: String { start }
}

public func historyWeeks(
  _ h: History, efforts: [SessionEffort], now: Date, timeZone: TimeZone
) -> [HistoryWeek] {
  let sets = Dictionary(grouping: h.sets.filter { !$0.removed }, by: \.workoutId)
  let floors = Dictionary(
    efforts.compactMap { e in e.floor.map { (e.workoutId, $0) } }, uniquingKeysWith: { a, _ in a })
  // Kept and ended, with a start that reads (one that does not falls on no day); newest first by
  // instant, two at the same instant by the greater id, on every device.
  let past = h.workouts
    .compactMap { w in
      w.endedAt != nil && !w.removed ? Instant.milliseconds(w.startedAt).map { (w: w, ms: $0) } : nil
    }
    .sorted { $0.ms != $1.ms ? $0.ms > $1.ms : precedes($1.w.id, $0.w.id) }
  let current = Day.weekOf(toISODate(now, timeZone: timeZone)).start
  var weeks: [HistoryWeek] = []
  for (w, started) in past {
    let day = dayOf(w, timeZone: timeZone)
    let row = HistoryRow(
      workoutId: w.id, code: w.sessionCode, name: w.sessionName.value,
      sessionId: recordedSession(w), day: day, startedAt: w.startedAt,
      durationMs: w.endedAt.flatMap(Instant.milliseconds).map { Int(clamping: $0 - started) } ?? 0,
      volumeKg: volumeOf((sets[w.id] ?? []).filter { !$0.warmup }), effort: floors[w.id])
    // Newest first, so a day before the last week's Monday opens the next week down.
    if let last = weeks.last, !precedes(day, last.start) {
      weeks[weeks.count - 1].rows.append(row)
    } else {
      let (start, end) = Day.weekOf(day)
      weeks.append(
        HistoryWeek(
          start: start, end: end, isCurrent: start == current, count: 0, durationMs: 0,
          rows: [row]))
    }
  }
  for i in weeks.indices {
    weeks[i].count = weeks[i].rows.count
    // Saturated, as each length is: Int is 32 bits on the Watch.
    weeks[i].durationMs = weeks[i].rows.reduce(0) { sum, row in
      let (total, over) = sum.addingReportingOverflow(row.durationMs)
      return over ? .max : total
    }
  }
  return weeks
}

/// A set of a past session: a warm-up (« Montée ») or a work set, numbered from 1 among its kind.
public struct PastSet: Sendable, Equatable, Identifiable {
  public var setId: String
  public var warmup: Bool
  public var number: Int
  public var weightKg: Double
  public var reps: Int?
  public var seconds: Int?
  public var rir: Int?

  public var id: String { setId }
}

/// An exercise of a past session, in its plan's place, with the sets done: warm-ups first.
public struct PastExercise: Sendable, Equatable, Identifiable {
  public var slotIndex: Int
  /// The exercise really done.
  public var exerciseId: String
  public var sets: [PastSet]

  public var id: Int { slotIndex }
}

public struct PastSession: Sendable, Equatable {
  public var workoutId: String
  public var code: String
  public var name: String?
  public var startedAt: String
  public var durationMs: Int
  public var workSets: Int
  public var volumeKg: Double
  /// The floor given on this phone; nil when it holds none.
  public var effort: Int?
  public var exercises: [PastExercise]
}

/// A session kept and ended, opened from the history; nil for any other.
public func pastSession(_ h: History, workoutId: String, effort: SessionEffort?) -> PastSession? {
  guard let w = h.workouts.first(where: { $0.id == workoutId }), w.endedAt != nil, !w.removed
  else { return nil }
  let own = h.sets.filter { $0.workoutId == w.id && !$0.removed }
  // Its records are not shown here, so it is read against no earlier session.
  let figures = summary(w, sets: own, history: History(workouts: [], sets: []))
  let bySlot = Dictionary(grouping: own, by: \.slotIndex)
  let exercises = bySlot.keys.sorted().map { slot in
    // Positions below the warm-up bound are warm-ups: in order, they come before the work sets.
    let sets = bySlot[slot]!.sorted { $0.position < $1.position }
    let warmups = sets.filter(\.warmup)
    let work = sets.filter { !$0.warmup }
    let shown =
      warmups.enumerated().map { i, s in past(s, number: i + 1) }
      + work.map { past($0, number: $0.position - Bounds.maxWarmups + 1) }
    return PastExercise(slotIndex: slot, exerciseId: sets[0].exerciseId, sets: shown)
  }
  return PastSession(
    workoutId: w.id, code: w.sessionCode, name: w.sessionName.value, startedAt: w.startedAt,
    durationMs: lengthMs(w), workSets: figures.workSets, volumeKg: figures.volumeKg,
    effort: effort?.workoutId == w.id ? effort?.floor : nil, exercises: exercises)
}

private func past(_ s: SetRow, number: Int) -> PastSet {
  PastSet(
    setId: s.id, warmup: s.warmup, number: number, weightKg: s.weightKg, reps: s.reps,
    seconds: s.seconds, rir: s.rir)
}
