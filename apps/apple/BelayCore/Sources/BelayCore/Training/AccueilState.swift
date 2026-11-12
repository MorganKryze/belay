import Foundation

// Accueil's state: one pure function of the store and the local day, so the screen draws it and
// the Watch can read the same. The precedence is the web's: a session open, else one done today,
// else what the day's plan asks for, else nothing planned.

/// The session open here or on another device, as Accueil's card shows it.
public struct OpenCard: Sendable, Equatable {
  public var workoutId: String
  public var code: String
  public var name: String?
  public var startedAt: String
  /// The plan's work sets, and how many of them are done.
  public var setsPlanned: Int
  public var setsDone: Int

  public init(
    workoutId: String, code: String, name: String?, startedAt: String, setsPlanned: Int,
    setsDone: Int
  ) {
    self.workoutId = workoutId
    self.code = code
    self.name = name
    self.startedAt = startedAt
    self.setsPlanned = setsPlanned
    self.setsDone = setsDone
  }
}

/// Today's session done: the session kept, the day it counts on (today, or an earlier day for a
/// fixed day's session done early), its length, its work sets, and its effort when this phone
/// holds one.
public struct DoneCard: Sendable, Equatable {
  public var workoutId: String
  public var code: String
  public var name: String?
  public var on: String
  public var durationMs: Int
  public var workSets: Int
  /// The floor, 1 to 5, given on this phone; nil when it holds none.
  public var effort: Int?

  public init(
    workoutId: String, code: String, name: String?, on: String, durationMs: Int, workSets: Int,
    effort: Int?
  ) {
    self.workoutId = workoutId
    self.code = code
    self.name = name
    self.on = on
    self.durationMs = durationMs
    self.workSets = workSets
    self.effort = effort
  }
}

/// The session the day offers, with the day's plan (session C's no-climbing slots included when
/// the week asks for them) and its size.
public struct NextCard: Sendable, Equatable {
  public var sessionId: String
  public var code: String
  public var name: String?
  public var plan: [Slot]
  public var exercises: Int
  public var minutes: Int

  public init(_ session: LetteredTemplate, plan: [Slot]) {
    sessionId = session.sessionId
    code = session.code
    name = session.name
    self.plan = plan
    exercises = plan.count
    minutes = estimatedMinutes(plan)
  }
}

/// The next session named quietly under a card: on its day on a fixed week, with no day in
/// rotation.
public struct NextLine: Sendable, Equatable {
  public var sessionId: String
  public var code: String
  public var name: String?
  public var day: String?

  public init(_ session: LetteredTemplate, day: String?) {
    sessionId = session.sessionId
    code = session.code
    name = session.name
    self.day = day
  }
}

public enum AccueilState: Sendable, Equatable {
  case running(OpenCard)
  case doneToday(DoneCard, next: NextLine?)
  /// In rotation.
  case next(NextCard)
  /// Today's session on a fixed week; `weekday`, Monday 0, is today's.
  case due(NextCard, weekday: Int)
  /// A fixed week's day with no session.
  case rest(next: NextLine)
  /// Nothing planned, and a session was kept once.
  case none
  /// Nothing planned, and no session ever kept.
  case first
}

/// The effort this phone holds for a session, nil when it holds no floor.
func effortOf(_ workoutId: String, in efforts: [SessionEffort]) -> Int? {
  efforts.first { $0.workoutId == workoutId }?.floor
}

public func accueilState(
  history: History, programs: StoredPrograms, activities: [ActivityRow],
  efforts: [SessionEffort], now: Date, timeZone: TimeZone
) -> AccueilState {
  let workouts = history.workouts
  if let open = openWorkout(workouts, forgotten: (history.sets, now)) {
    let own = history.sets.filter { $0.workoutId == open.id && !$0.removed }
    return .running(
      OpenCard(
        workoutId: open.id, code: open.sessionCode, name: open.sessionName.value,
        startedAt: open.startedAt, setsPlanned: plannedWorkSets(open.plan),
        setsDone: sessionProgress(open.plan, sets: own).done.count))
  }
  let today = toISODate(now, timeZone: timeZone)
  let rotation = rotationOf(programs)
  let plan = dayPlan(workouts, programs, rotation: rotation, today: today, timeZone: timeZone)
  func done(_ w: WorkoutRow, on: String, durationMs: Int, workSets: Int) -> DoneCard {
    DoneCard(
      workoutId: w.id, code: w.sessionCode, name: w.sessionName.value, on: on,
      durationMs: durationMs, workSets: workSets, effort: effortOf(w.id, in: efforts))
  }
  // As the web names the next session under a card: today's while it is due, else the next
  // session day's, or the next in rotation with no day.
  let ahead: NextLine? =
    switch plan {
    case .rotation(let next): next.map { NextLine($0, day: nil) }
    case .due(let session, _): NextLine(session, day: today)
    case .done(_, _, _, let next), .rest(let next): NextLine(next.session, day: next.day)
    }
  if let finished = finishedOn(history, day: today, timeZone: timeZone) {
    return .doneToday(
      done(
        finished.workout, on: today, durationMs: finished.durationMs, workSets: finished.workSets),
      next: ahead)
  }
  let card = { (session: LetteredTemplate) in
    NextCard(session, plan: planFor(session, activities: activities, date: today))
  }
  switch plan {
  case .rest(let next):
    return .rest(next: NextLine(next.session, day: next.day))
  case .done(_, let workout, let on, _):
    return .doneToday(
      done(
        workout, on: on, durationMs: lengthMs(workout),
        workSets: workSetsOf(history, workoutId: workout.id)),
      next: ahead)
  case .due(let session, _):
    return .due(card(session), weekday: Day.weekday(today))
  case .rotation(let next?):
    return .next(card(next))
  case .rotation(nil):
    let kept = workouts.contains { $0.endedAt != nil && !$0.removed }
    return kept ? .none : .first
  }
}

/// An ended session's length in milliseconds, 0 when a time does not read; clamped, as Int is 32
/// bits on the Watch.
func lengthMs(_ w: WorkoutRow) -> Int {
  guard let ended = w.endedAt.flatMap(Instant.milliseconds),
    let started = Instant.milliseconds(w.startedAt)
  else { return 0 }
  return Int(clamping: ended - started)
}
