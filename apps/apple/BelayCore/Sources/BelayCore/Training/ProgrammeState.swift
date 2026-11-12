import Foundation

// Séances' Programme segment: the active program, its week on fixed days, its sessions in the
// order they come with one mark at most, and its rhythm. Read from the schedule rules only.

/// A day of the fixed week, Monday 0: the session it holds, or a rest day.
public struct WeekDay: Sendable, Equatable, Identifiable {
  public struct Session: Sendable, Equatable {
    public var sessionId: String
    public var code: String
    public var name: String?
  }

  public var weekday: Int
  /// The calendar day in this week, `YYYY-MM-DD`.
  public var day: String
  /// Nil on a rest day.
  public var session: Session?
  public var isToday: Bool

  public var id: Int { weekday }
}

/// How many days of the week hold a session, and how many rest.
public struct PerWeek: Sendable, Equatable {
  public var sessions: Int
  public var rest: Int
}

/// The rhythm in words: the rotation's letters in turn, or the session days a week.
public enum Rhythm: Sendable, Equatable {
  case rotation(letters: [String])
  case fixed(sessions: Int)
}

/// A session of the active program as its row shows it.
public struct SessionRowState: Sendable, Equatable, Identifiable {
  public enum Mark: Sendable, Equatable {
    /// The session the day offers next.
    case next
    /// Open, here or on another device.
    case running
    /// Kept today.
    case doneToday
    /// The next one, on a fixed week, falls tomorrow.
    case tomorrow
  }

  public var sessionId: String
  public var code: String
  public var name: String?
  /// The day's plan's size, session C's no-climbing slots included when the week asks for them.
  public var exercises: Int
  public var minutes: Int
  /// The weekdays, Monday 0, that hold it on a fixed week; empty in rotation.
  public var days: [Int]
  public var mark: Mark?

  public var id: String { sessionId }
}

public struct ProgrammeState: Sendable, Equatable {
  /// The live active program; nil when none is.
  public var program: ProgramRow?
  /// Monday first, on a fixed week; nil in rotation, where a week would invent days.
  public var week: [WeekDay]?
  public var perWeek: PerWeek?
  public var sessions: [SessionRowState]
  public var rhythm: Rhythm
}

public func programmeState(
  history: History, programs: StoredPrograms, activities: [ActivityRow], now: Date,
  timeZone: TimeZone
) -> ProgrammeState {
  let workouts = history.workouts
  let today = toISODate(now, timeZone: timeZone)
  let rotation = rotationOf(programs)
  let program = programs.programs.first { $0.id == programs.activeId && !$0.removed }
  let fixed = fixedWeek(programs, rotation: rotation)
  let order = weekOrder(workouts, programs, rotation: rotation, today: today, timeZone: timeZone)
  // On fixed days the week's order from today, whose first card is the next; in rotation the
  // next session leads, then the rotation's order from there.
  let cards: [WeekCard]
  let next: WeekCard?
  if let order {
    cards = order
    next = order.first
  } else {
    let first = nextInRotation(workouts, rotation: rotation, activeAt: programs.activeAt)
    let at = first.flatMap { f in rotation.firstIndex { $0.sessionId == f.sessionId } } ?? 0
    cards = (rotation[at...] + rotation[..<at]).map { WeekCard(session: $0, next: nil, days: []) }
    next = cards.first
  }
  let open = openWorkout(workouts, forgotten: (history.sets, now))
  let tomorrow = Day.add(today, 1)
  let sessions = cards.map { card in
    let s = card.session
    let mark: SessionRowState.Mark? =
      if let open, startedAs(open, s) {
        .running
      } else if let last = lastFinished(workouts, session: s), dayOf(last, timeZone: timeZone) == today {
        .doneToday
      } else if card.session.sessionId == next?.session.sessionId {
        card.next == tomorrow ? .tomorrow : .next
      } else {
        nil
      }
    let plan = planFor(s, activities: activities, date: today)
    return SessionRowState(
      sessionId: s.sessionId, code: s.code, name: s.name, exercises: plan.count,
      minutes: estimatedMinutes(plan), days: card.days, mark: mark)
  }
  let monday = Day.weekOf(today).start
  return ProgrammeState(
    program: program,
    week: fixed.map { week in
      week.enumerated().map { i, session in
        let day = Day.add(monday, i)
        return WeekDay(
          weekday: i, day: day,
          session: session.map { .init(sessionId: $0.sessionId, code: $0.code, name: $0.name) },
          isToday: day == today)
      }
    },
    perWeek: fixed.map { PerWeek(sessions: sessionDays($0), rest: 7 - sessionDays($0)) },
    sessions: sessions,
    rhythm: fixed.map { .fixed(sessions: sessionDays($0)) }
      ?? .rotation(letters: rotation.map(\.code)))
}
