import Foundation

/// The bounds every value keeps on the phone and the server alike, as the shared rules set them.
/// The vector tests compare each one with the TypeScript constant it comes from.
public enum Bounds {
  /// A set's load in kilograms: 0 to 500, on a 0.25 kg grid.
  public static let setKgMin = 0.0
  public static let setKgMax = 500.0
  public static let setKgStep = 0.25
  /// A set's count, in repetitions or in seconds held.
  public static let repsMax = 100
  public static let secondsMax = 3600
  /// 4 means "4 or more" repetitions in reserve.
  public static let rirMax = 4
  public static let maxSlots = 30
  /// Positions 0 to 2 are the warm-ups; work sets follow, up to position 49.
  public static let maxWarmups = 3
  public static let maxPosition = 49
  /// Counted in UTF-16 units, as the web counts them.
  public static let noteMax = 500
  public static let sessionNameMax = 40
  /// The plan's size as PostgreSQL writes it as text.
  public static let planMaxBytes = 16 * 1024
  /// The bounds of a slot of a plan.
  public static let slotSets = 10
  public static let slotReps = 100
  public static let slotSeconds = secondsMax
  public static let slotRestSec = 900
  public static let groupKeyMax = 16
  /// The longest name after `ds:` or `belay:` in an exercise id.
  public static let exerciseNameMax = 40
  /// No session time is before 1900.
  public static let minTime = "1900-01-01T00:00:00.000Z"
  /// How far ahead of its own clock the server takes a session's time, in milliseconds.
  public static let clockSlackMs = 5 * 60_000
}
