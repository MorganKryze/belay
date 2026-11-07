import Foundation

// A session's own copy of the plan: what session C adds in a week with no climbing.

/// The day's plan: the session's slots, then its no-climbing slots, marked, when no climb is
/// recorded in the week of `date` (Monday to Sunday). Judged once, at the start: a session
/// already started never changes when a climb is recorded later. Two devices adding slots at once
/// can leave a stored session past `Bounds.maxSlots`: the plan keeps the first ones so it always
/// starts.
public func planFor(_ session: LetteredTemplate, activities: [ActivityRow], date: String)
  -> [Slot]
{
  var extra: [Slot] = []
  if let noClimbing = session.noClimbing, !climbedThisWeek(activities, date: date) {
    extra = noClimbing.map { slot in
      var marked = slot
      marked.rule = .noClimbing
      return marked
    }
  }
  return Array((session.slots + extra).prefix(Bounds.maxSlots))
}

/// Session C's rule reads this: a climb not removed, any day of `date`'s week.
public func climbedThisWeek(_ activities: [ActivityRow], date: String) -> Bool {
  let (start, end) = Day.weekOf(date)
  return activities.contains {
    !$0.removed && $0.kind == "climbing" && !precedes($0.date, start) && !precedes(end, $0.date)
  }
}

/// Calendar days as `YYYY-MM-DD`, the person's local date. Arithmetic runs on UTC midnights, so
/// no daylight-saving change can shift a day; the text compares in date order.
enum Day {
  private static let dayMs: Int64 = 86_400_000

  /// UTC midnight of `day`, in milliseconds. Every day here is one the device wrote; the web
  /// throws on one that does not read, and so does this.
  private static func midnight(_ day: String) -> Int64 {
    guard let ms = Instant.milliseconds("\(day)T00:00Z") else {
      preconditionFailure("not a day: \(day)")
    }
    return ms
  }

  private static func day(ms: Int64) -> String { String(Instant.string(ms: ms).prefix(10)) }

  static func add(_ day: String, _ days: Int) -> String {
    Self.day(ms: midnight(day) + Int64(days) * dayMs)
  }

  /// Monday 0 to Sunday 6, as a schedule's days.
  static func weekday(_ day: String) -> Int {
    let days = midnight(day) / dayMs
    // 1970-01-01 was a Thursday, weekday 3.
    return Int(((days % 7) + 7 + 3) % 7)
  }

  /// The week from Monday to Sunday that holds `day`.
  static func weekOf(_ day: String) -> (start: String, end: String) {
    let start = add(day, -weekday(day))
    return (start, add(start, 6))
  }
}
