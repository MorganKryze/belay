import Foundation

// What Séances shows of a fixed week: how many days hold a session, which days each one holds,
// and the sessions as cards in the order their days come.

/// How many days of the week hold a session.
public func sessionDays(_ w: Week) -> Int { w.count(where: { $0 != nil }) }

/// The weekdays, Monday 0, that hold this session.
public func daysOf(_ w: Week, sessionId: String) -> [Int] {
  w.indices.filter { w[$0]?.sessionId == sessionId }
}

/// A rotation session with its next day, nil when the week gives it none, and its weekdays.
public struct WeekCard: Sendable, Equatable {
  public var session: LetteredTemplate
  public var next: String?
  public var days: [Int]
}

/// The rotation by each session's next day, from today (skipped once today's session is done),
/// so the first card is `plannedNext`'s; sessions with no day follow in rotation order. Nil in
/// rotation.
public func weekOrder(
  _ workouts: [WorkoutRow], _ p: StoredPrograms, rotation: [LetteredTemplate], today: String,
  timeZone: TimeZone
) -> [WeekCard]? {
  guard let week = fixedWeek(p, rotation: rotation) else { return nil }
  let doneToday: String? =
    switch dayPlan(workouts, p, rotation: rotation, today: today, timeZone: timeZone) {
    case .done(let session, _, _, _): session.sessionId
    default: nil
    }
  let cards = rotation.map { session in
    let from = session.sessionId == doneToday ? 1 : 0
    let k = (from...7).first {
      week[Day.weekday(Day.add(today, $0))]?.sessionId == session.sessionId
    }
    return WeekCard(
      session: session, next: k.map { Day.add(today, $0) },
      days: daysOf(week, sessionId: session.sessionId))
  }
  // The day text compares in date order; a session with no day goes last, and ties keep the
  // rotation order.
  return
    cards
    .enumerated()
    .sorted { a, b in
      switch (a.element.next, b.element.next) {
      case (let x?, let y?) where x != y: precedes(x, y)
      case (nil, _?): false
      case (_?, nil): true
      default: a.offset < b.offset
      }
    }
    .map(\.element)
}
