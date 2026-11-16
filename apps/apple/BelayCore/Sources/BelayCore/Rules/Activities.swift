// What a day holds outside the gym, ported from the shared rules: its steps and the summary
// Accueil's « Activité » line gives.

/// The day's steps, if any were typed or imported; nil when none were, or they were deleted.
public func stepsOf(_ logs: [StepsRow], day: String) -> Int? {
  logs.first { $0.date == day }?.steps
}

/// What Accueil's « Activité » line says about a day: nothing yet, the steps, the one activity,
/// or how many there are, the steps counting as one.
public enum DaySummary: Sendable, Equatable {
  case none
  case steps(Int)
  case activity(ActivityRow)
  case many(Int)
}

public func activitySummary(_ activities: [ActivityRow], _ logs: [StepsRow], day: String)
  -> DaySummary
{
  let own = activities.filter { !$0.removed && $0.date == day }
  let steps = stepsOf(logs, day: day)
  let count = own.count + (steps == nil ? 0 : 1)
  if count == 0 { return .none }
  if count > 1 { return .many(count) }
  if let steps { return .steps(steps) }
  return .activity(own[0])
}

/// A day's step total as Health gives it; nil when the day holds no samples.
public struct StepsTotal: Sendable, Equatable {
  public let date: String
  public let total: Double?

  public init(date: String, total: Double?) {
    self.date = date
    self.total = total
  }
}

/// A day's steps the import writes.
public struct StepsWrite: Sendable, Equatable {
  public let date: String
  public let value: Int
}

/// Which days of steps a Health import writes (R4). The caller reads Health for today and the 6
/// days before; a total is written while the stored steps (`rows`) are empty or are this phone's
/// own last write (`own`), so a value typed on the web is never silently replaced.
public func stepsToWrite(days: [StepsTotal], rows: [String: Int?], own: [String: Int])
  -> [StepsWrite]
{
  var out: [StepsWrite] = []
  for day in days {
    guard let total = day.total else { continue }  // no samples that day
    let value = jsRound(total)
    // Past the 100 000 steps a day holds.
    guard value.isFinite, let steps = Int(exactly: value), isSteps(steps) else { continue }
    let stored = rows[day.date] ?? nil
    if let stored, stored != own[day.date] { continue }  // typed elsewhere
    if stored == steps { continue }
    out.append(StepsWrite(date: day.date, value: steps))
  }
  return out
}
