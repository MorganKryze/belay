import Foundation

// A program's week on fixed days, what today asks for and the next session. A session counts on
// the calendar day it started, where the person is: that day is read in `timeZone`.

/// The calendar day `date` falls on in `timeZone`, as `YYYY-MM-DD`.
public func toISODate(_ date: Date, timeZone: TimeZone) -> String {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = timeZone
  let c = calendar.dateComponents([.year, .month, .day], from: date)
  let pad = { (n: Int?) in n.map { $0 < 10 ? "0\($0)" : "\($0)" } ?? "NaN" }
  return "\(c.year.map(String.init) ?? "NaN")-\(pad(c.month))-\(pad(c.day))"
}

/// The day a session started on, where the person is; a start that does not read gives the
/// web's `NaN-NaN-NaN`, a day no other matches.
public func dayOf(_ w: WorkoutRow, timeZone: TimeZone) -> String {
  guard let start = Instant.date(w.startedAt) else { return "NaN-NaN-NaN" }
  return toISODate(start, timeZone: timeZone)
}

/// Seven entries, Monday first: the session each weekday holds, nil on a rest day.
public typealias Week = [LetteredTemplate?]

/// The active program's days as rotation sessions, by id: a session set aside, removed, emptied
/// or moved to another program leaves its day a rest day, and the day comes back with it. A
/// week that holds no session offers nothing, so the program runs in rotation instead.
public func fixedWeek(_ p: StoredPrograms, rotation: [LetteredTemplate]) -> Week? {
  guard let program = p.programs.first(where: { $0.id == p.activeId && !$0.removed }),
    program.schedule.mode == .fixed
  else { return nil }
  let days = program.schedule.days
  let week: Week = (0..<7).map { i in
    guard i < days.count, let id = days[i] else { return nil }
    return rotation.first { $0.sessionId == id }
  }
  return week.contains { $0 != nil } ? week : nil
}

/// Finished and kept; one recorded by letter only counts since the program became active, as a
/// letter names another session elsewhere.
func counts(_ w: WorkoutRow, since: Double) -> Bool {
  w.endedAt != nil && !w.removed && (recordedSession(w) != nil || parsedMs(w.startedAt) >= since)
}

/// The instant a program became active, in milliseconds; with none, every session counts.
func sinceOf(_ activeAt: String?) -> Double { activeAt.map(parsedMs) ?? -.infinity }

/// The nearest session day 1 to 7 days from `day`, forward or back.
private func sessionDay(_ week: Week, from day: String, step: Int) -> String {
  // A fixed week holds a session day, so one of the next seven days is one.
  let k = (1...7).first { week[Day.weekday(Day.add(day, step * $0))] != nil }!
  return Day.add(day, step * k)
}

/// A session on its day.
public struct Planned: Sendable, Equatable {
  public var session: LetteredTemplate
  public var day: String
}

/// What today asks for: in rotation the next session; on fixed days today's session, due until
/// it is done after the previous session day, so a session done early counts for its day and a
/// missed one is never carried over; or a rest day. Off rotation, with the next session day.
public enum DayPlan: Sendable, Equatable {
  case rotation(next: LetteredTemplate?)
  case due(LetteredTemplate, next: Planned)
  /// `on`: the day the workout counts on.
  case done(LetteredTemplate, workout: WorkoutRow, on: String, next: Planned)
  case rest(next: Planned)
}

public func dayPlan(
  _ workouts: [WorkoutRow], _ p: StoredPrograms, rotation: [LetteredTemplate], today: String,
  timeZone: TimeZone
) -> DayPlan {
  guard let week = fixedWeek(p, rotation: rotation) else {
    return .rotation(next: nextInRotation(workouts, rotation: rotation, activeAt: p.activeAt))
  }
  let day = sessionDay(week, from: today, step: 1)
  // sessionDay lands on a day that holds a session.
  let next = Planned(session: week[Day.weekday(day)]!, day: day)
  guard let session = week[Day.weekday(today)] else { return .rest(next: next) }
  let after = sessionDay(week, from: today, step: -1)
  let since = sinceOf(p.activeAt)
  var workout: WorkoutRow?
  for w in workouts {
    let on = dayOf(w, timeZone: timeZone)
    if !counts(w, since: since) || !startedAs(w, session) || !precedes(after, on)
      || precedes(today, on)
    {
      continue
    }
    // Times compared as instants; two starts at the same instant: the greater id, on every
    // device.
    let ahead = workout.map { parsedMs(w.startedAt) - parsedMs($0.startedAt) } ?? 1
    if ahead > 0 || (ahead == 0 && workout.map { precedes($0.id, w.id) } == true) { workout = w }
  }
  guard let workout else { return .due(session, next: next) }
  return .done(session, workout: workout, on: dayOf(workout, timeZone: timeZone), next: next)
}

/// The session to offer next: in rotation the next one; on fixed days today's while it is due,
/// else the next session day's.
public func plannedNext(
  _ workouts: [WorkoutRow], programs: StoredPrograms, rotation: [LetteredTemplate],
  today: String, timeZone: TimeZone
) -> LetteredTemplate? {
  switch dayPlan(workouts, programs, rotation: rotation, today: today, timeZone: timeZone) {
  case .rotation(let next): next
  case .due(let session, _): session
  case .done(_, _, _, let next), .rest(let next): next.session
  }
}
