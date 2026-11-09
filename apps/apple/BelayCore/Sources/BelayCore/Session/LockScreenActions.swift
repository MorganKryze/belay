import Foundation

/// What the Live Activity's buttons do, through the same writes as the screen. False: nothing
/// was written (no session open, another one, another set due, a pause, a timed set, no rest),
/// and the Activity is set to what is true.
public enum LockScreenActions {
  /// Logs the set the Activity showed, as it showed it; a second tap corrects it.
  public static func logShown(_ place: SetPlace, workoutId: String, using actions: SessionActions)
    throws -> Bool
  {
    try actions.logShown(place, workoutId: workoutId)
  }

  /// 30 s more on the running rest.
  public static func addThirty(workoutId: String, using actions: SessionActions) throws -> Bool {
    try actions.addThirty(workoutId: workoutId)
  }
}
