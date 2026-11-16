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
