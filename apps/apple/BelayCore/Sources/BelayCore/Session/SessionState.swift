import Foundation

// What the cover shows, read from the stored session alone: the set due, the rest, the recap of
// an exercise, the announcement of the next one, the pause. Pure, so the screen, the lock screen
// and the writes all agree on what comes next.

/// A set ready to be logged: its place, what ✓ would write, and the line under its load.
public struct DueSet: Sendable, Equatable {
  public var place: SetPlace
  public var exerciseId: String
  public var warmup: Bool
  /// A set added past the plan.
  public var added: Bool
  public var timed: Bool
  /// The k-th work set, from 1, or the k-th warm-up while `warmup`.
  public var number: Int
  /// The work sets the slot plans, or the warm-ups computed for it.
  public var of: Int
  public var weightKg: Double
  /// Repetitions, or seconds for a timed set.
  public var count: Int
  /// The plan's range, in the slot's measure.
  public var target: [Int]
  public var progression: Progression
}

/// A timed set being held.
public struct Hold: Sendable, Equatable {
  public var due: DueSet
  public var endsAt: Date
}

/// A timed set stopped or run out, waiting for ✓.
public struct Held: Sendable, Equatable {
  public var due: DueSet
  public var seconds: Int
}

public struct Rest: Sendable, Equatable {
  public var endsAt: Date
  /// The set that follows, nil when none is left.
  public var next: DueSet?
}

/// An exercise just finished: its sets, then the RIR of its last one is asked.
public struct Recap: Sendable, Equatable {
  public var exerciseId: String
  public var sets: [DoneSet]
}

/// The next exercise, announced during the rest that leads to it.
public struct Announce: Sendable, Equatable {
  public var next: DueSet
  public var restEndsAt: Date
}

public struct Paused: Sendable, Equatable {
  /// The session's time, standing still.
  public var elapsedMs: Int
  /// The rest left when the pause began, nil when none ran.
  public var restLeftMs: Int?
}

/// A set logged in this session.
public struct DoneSet: Sendable, Equatable, Identifiable {
  public var id: String
  public var place: SetPlace
  public var exerciseId: String
  public var warmup: Bool
  public var timed: Bool
  public var weightKg: Double
  public var count: Int
  public var rir: Int?

  /// A set kept, for the correction sheet, which reads a past session's sets as it reads this one's.
  public init(
    id: String, place: SetPlace, exerciseId: String, warmup: Bool, timed: Bool, weightKg: Double,
    count: Int, rir: Int?
  ) {
    self.id = id
    self.place = place
    self.exerciseId = exerciseId
    self.warmup = warmup
    self.timed = timed
    self.weightKg = weightKg
    self.count = count
    self.rir = rir
  }
}

/// One bar per work set of the exercise shown.
public enum BarState: Sendable, Equatable { case done, current, toCome }

/// What the screen remembers of its own: when the recap showed, a tap on it, when the RIR was
/// answered, VoiceOver, and a tap on the announced rest's clock.
public struct SessionMarks: Sendable, Equatable {
  public var recapShownAt: Date?
  public var recapTapped: Bool
  public var rirAnsweredAt: Date?
  public var voiceOver: Bool
  public var restCardAsked: Bool

  public init(
    recapShownAt: Date? = nil, recapTapped: Bool = false, rirAnsweredAt: Date? = nil,
    voiceOver: Bool = false, restCardAsked: Bool = false
  ) {
    self.recapShownAt = recapShownAt
    self.recapTapped = recapTapped
    self.rirAnsweredAt = rirAnsweredAt
    self.voiceOver = voiceOver
    self.restCardAsked = restCardAsked
  }
}

public enum SessionPhase: Sendable, Equatable {
  case due(DueSet)
  case holding(Hold)
  case held(Held)
  case resting(Rest)
  case recap(Recap)
  case announce(Announce)
  case allDone(sets: Int, title: String)
  case paused(Paused)
}

public struct SessionState: Sendable, Equatable {
  public var workoutId: String
  public var title: String
  /// From 0, among the exercises not left out.
  public var exerciseIndex: Int
  public var exerciseCount: Int
  public var bars: [BarState]
  public var phase: SessionPhase
  /// The exercise's done sets, warm-ups first.
  public var done: [DoneSet]
  /// The work set whose RIR the foot asks, while its rest or its recap shows.
  public var askRIR: DoneSet?
  /// The exercise's note.
  public var note: String?
  public var elapsedMs: Int
  public var startedAt: Date
  public var paused: Bool
}

/// The recap stays at least this long, and this long after its RIR is answered.
let recapFloor: TimeInterval = 2.6
let afterAnswer: TimeInterval = 0.9

private func date(_ text: String) -> Date? { Instant.date(text) }

private func doneSet(_ s: SetRow) -> DoneSet {
  DoneSet(
    id: s.id, place: SetPlace(slotIndex: s.slotIndex, position: s.position),
    exerciseId: s.exerciseId, warmup: s.warmup, timed: s.seconds != nil, weightKg: s.weightKg,
    count: countOf(s), rir: s.rir)
}

/// The session's own sets still in place.
func ownSets(_ history: History, workoutId: String) -> [SetRow] {
  history.sets.filter { !$0.removed && $0.workoutId == workoutId }
}

/// The session resumed at `at`: the start moved past the pause, the rest and a chrono moved with
/// it, the pause gone. Unchanged when it runs.
func resumed(startedAt: String, active: ActiveSession, at: String) -> (
  startedAt: String, active: ActiveSession
) {
  guard let pausedAt = active.pausedAt else { return (startedAt, active) }
  var active = active
  active.restEndsAt = resumedRestEnd(
    active.restEndsAt, pausedAt: pausedAt, resumedAt: at, stops: .all)
  if var chrono = active.chrono {
    chrono.endsAt =
      resumedRestEnd(chrono.endsAt, pausedAt: pausedAt, resumedAt: at, stops: .all)
      ?? chrono.endsAt
    active.chrono = chrono
  }
  active.pausedAt = nil
  return (resumedStart(startedAt: startedAt, pausedAt: pausedAt, resumedAt: at), active)
}

/// A pause that a set logged since has ended, here or on another device, read as resumed at that
/// set's time: the time trained since stays in the session. Unchanged otherwise.
func settledPause(startedAt: String, active: ActiveSession, sets: [SetRow]) -> (
  startedAt: String, active: ActiveSession
) {
  guard let pausedAt = active.pausedAt,
    let endedBy = pauseEndedBy(pausedAt: pausedAt, doneAts: sets.map(\.doneAt))
  else { return (startedAt, active) }
  return resumed(startedAt: startedAt, active: active, at: endedBy)
}

/// The set due in `workout`: a set the person added, else the next turn of the shared rule with
/// its warm-ups first, the warm-ups coming before a slot's first work set when a working load is
/// known. Its values are the draft's at that place, else the prefill.
public func dueSet(
  history: History, workout: WorkoutRow, active: ActiveSession, library: ExerciseLibrary,
  bar: Plates
) -> DueSet? {
  let plan = workout.plan
  let sets = ownSets(history, workoutId: workout.id)
  let taken = Set(sets.map { SetPlace(slotIndex: $0.slotIndex, position: $0.position) })
  let draft = active.draft

  func make(_ place: SetPlace, warmup: Bool, number: Int, of: Int, values: (Double, Int))
    -> DueSet
  {
    let slot = plan[place.slotIndex]
    let chosen = draft?.place == place ? draft : nil
    let weight = chosen?.weightKg ?? values.0
    let count = chosen?.count ?? values.1
    return DueSet(
      place: place, exerciseId: slot.exerciseId, warmup: warmup,
      added: !warmup && place.position - Bounds.maxWarmups >= slot.sets,
      timed: slot.measure == .seconds, number: number, of: of, weightKg: weight, count: count,
      target: slot.repRange,
      progression: progression(
        history: history, slot: slot, setIndex: place.position - Bounds.maxWarmups,
        warmup: warmup, weightKg: weight, count: count))
  }

  if let added = active.added, plan.indices.contains(added.slotIndex),
    plan[added.slotIndex].skipped != true,
    let position = stride(
      from: Bounds.maxWarmups + plan[added.slotIndex].sets, through: added.position, by: 1
    ).first(where: { !taken.contains(SetPlace(slotIndex: added.slotIndex, position: $0)) })
  {
    let round = position - Bounds.maxWarmups
    return make(
      SetPlace(slotIndex: added.slotIndex, position: position), warmup: false, number: round + 1,
      of: plan[added.slotIndex].sets,
      values: workValues(history, plan: plan, sets: sets, slotIndex: added.slotIndex, round: round))
  }
  guard let turn = sessionProgress(plan, sets: sets).next else { return nil }
  let slot = plan[turn.slotIndex]
  let workPlace = SetPlace(slotIndex: turn.slotIndex, position: Bounds.maxWarmups + turn.round)
  var work = workValues(
    history, plan: plan, sets: sets, slotIndex: turn.slotIndex, round: turn.round)
  if draft?.place == workPlace, let kg = draft?.weightKg { work.0 = kg }

  let started = sets.contains { $0.slotIndex == turn.slotIndex && !$0.warmup }
  if !started, slot.measure != .seconds, let exercise = library.exercise(slot.exerciseId) {
    let loads = warmups(slot, workKg: work.0 > 0 ? work.0 : nil, exercise: exercise, bar: bar)
    for (i, load) in loads.enumerated() {
      let place = SetPlace(slotIndex: turn.slotIndex, position: i)
      if taken.contains(place) { continue }
      return make(
        place, warmup: true, number: i + 1, of: loads.count,
        values: (load.weightKg, load.reps ?? 0))
    }
  }
  return make(workPlace, warmup: false, number: turn.round + 1, of: slot.sets, values: work)
}

/// A work set's load and count: the load of the slot's previous set in this session (a load
/// chosen carries on), else last time's; the count by the shared prefill, else the previous set
/// of this session, else the plan's low target.
private func workValues(
  _ history: History, plan: [Slot], sets: [SetRow], slotIndex: Int, round: Int
) -> (Double, Int) {
  let slot = plan[slotIndex]
  let previous = sets.filter {
    $0.slotIndex == slotIndex && !$0.warmup && measureOfSet($0) == slot.measure
  }.max { $0.position < $1.position }
  let last = prefill(
    history, exerciseId: slot.exerciseId, setIndex: round, measure: slot.measure)
  let weight = previous?.weightKg ?? last?.weightKg ?? 0
  let count =
    last.map { $0.seconds ?? $0.reps ?? 0 } ?? previous.map(countOf) ?? slot.repRange.first ?? 0
  return (weight, count)
}

/// The exercise whose last planned work set (its group's last round) was the session's latest
/// set, nil when the latest set left its exercise open.
private func finishedExercise(_ plan: [Slot], sets: [SetRow]) -> SetRow? {
  guard let latest = sets.max(by: { precedes($0.doneAt, $1.doneAt) }), !latest.warmup,
    plan.indices.contains(latest.slotIndex)
  else { return nil }
  let done = sessionProgress(plan, sets: sets).done
  let group = liveGroup(plan, slotIndex: latest.slotIndex)
  let open = workOrder(plan).contains {
    group.contains($0.slotIndex) && !done.contains(turnKey($0))
  }
  return open ? nil : latest
}

/// The cover's state at `now`.
public func sessionState(
  history: History, active: ActiveSession, now: Date, library: ExerciseLibrary, bar: Plates,
  marks: SessionMarks
) -> SessionState {
  guard let workout = history.workouts.first(where: { $0.id == active.workoutId }) else {
    preconditionFailure("the open session is always stored")
  }
  let plan = workout.plan
  let sets = ownSets(history, workoutId: workout.id)
  let settled = settledPause(startedAt: workout.startedAt, active: active, sets: sets)
  let device = settled.active
  let progress = sessionProgress(plan, sets: sets)
  let due = dueSet(history: history, workout: workout, active: device, library: library, bar: bar)
  let elapsed = Int(
    sessionElapsed(startedAt: settled.startedAt, pausedAt: device.pausedAt, now: now))
  let restAt = restClock(pausedAt: device.pausedAt, now: now, stops: .all)
  let restEnd = device.restEndsAt.flatMap(date).flatMap { $0 > restAt ? $0 : nil }
  let title = workout.sessionName.value ?? workout.sessionCode
  let workDone = sets.filter { !$0.warmup }.count
  let latestWork = sets.filter { !$0.warmup }.max { precedes($0.doneAt, $1.doneAt) }

  let finished = finishedExercise(plan, sets: sets)
  let recapPassed: Bool = {
    if marks.recapTapped { return true }
    guard !marks.voiceOver, let shown = marks.recapShownAt, now >= shown + recapFloor else {
      return false
    }
    let answered = marks.rirAnsweredAt ?? (finished?.rir != nil ? shown : nil)
    return answered.map { now >= $0 + afterAnswer } ?? false
  }()

  var shownSlot = due?.place.slotIndex ?? latestWork?.slotIndex ?? device.slotIndex
  let phase: SessionPhase
  if device.pausedAt != nil {
    phase = .paused(
      Paused(
        elapsedMs: elapsed,
        restLeftMs: restEnd.map { Int(($0.timeIntervalSince(restAt) * 1000).rounded()) }))
  } else if let finished, progress.next == nil, !recapPassed, due?.added != true {
    shownSlot = finished.slotIndex
    phase = .recap(Recap(exerciseId: finished.exerciseId, sets: slotSets(sets, finished.slotIndex)))
  } else if let finished, let restEnd, let due {
    if !recapPassed {
      shownSlot = finished.slotIndex
      phase = .recap(
        Recap(exerciseId: finished.exerciseId, sets: slotSets(sets, finished.slotIndex)))
    } else if marks.restCardAsked {
      phase = .resting(Rest(endsAt: restEnd, next: due))
    } else {
      phase = .announce(Announce(next: due, restEndsAt: restEnd))
    }
  } else if let restEnd {
    phase = .resting(Rest(endsAt: restEnd, next: due))
  } else if let due {
    if let chrono = device.chrono, chrono.place == due.place, let end = date(chrono.endsAt) {
      phase =
        end > now
        ? .holding(Hold(due: due, endsAt: end)) : .held(Held(due: due, seconds: chrono.seconds))
    } else {
      phase = .due(due)
    }
  } else {
    phase = .allDone(sets: workDone, title: title)
  }

  let live = liveSlots(plan)
  let slot = plan.indices.contains(shownSlot) ? plan[shownSlot] : nil
  let done = slotSets(sets, shownSlot)
  let rounds = max(
    slot?.sets ?? 0,
    (done.filter { !$0.warmup }.map(\.place.position).max() ?? -1)
      - Bounds.maxWarmups + 1)
  let bars: [BarState] = (0..<rounds).map { round in
    if progress.done.contains(turnKey(Turn(slotIndex: shownSlot, round: round)))
      || done.contains(where: { $0.place.position == Bounds.maxWarmups + round })
    {
      return .done
    }
    if let due, !due.warmup,
      due.place == SetPlace(slotIndex: shownSlot, position: Bounds.maxWarmups + round)
    {
      return .current
    }
    return .toCome
  }
  // The RIR is asked while the rest after the set runs, or while its exercise's recap shows.
  let asksNow: Bool = {
    switch phase {
    case .resting, .recap, .announce: return true
    default: return false
    }
  }()
  // A warm-up logged since, from the lock screen during that rest, leaves the question in place.
  let ask = latestWork.flatMap { s in
    asksNow && s.rir == nil && s.seconds == nil ? doneSet(s) : nil
  }
  return SessionState(
    workoutId: workout.id, title: title, exerciseIndex: live.firstIndex(of: shownSlot) ?? 0,
    exerciseCount: live.count, bars: bars, phase: phase, done: done, askRIR: ask,
    note: workout.exerciseNotes[String(shownSlot)], elapsedMs: elapsed,
    startedAt: date(settled.startedAt) ?? now, paused: device.pausedAt != nil)
}

private func slotSets(_ sets: [SetRow], _ slotIndex: Int) -> [DoneSet] {
  sets.filter { $0.slotIndex == slotIndex }.sorted { $0.position < $1.position }.map(doneSet)
}
