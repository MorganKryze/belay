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
  /// The most changes one sync request carries; the rest go in the next round.
  public static let maxChanges = 500
  /// How far ahead of its own clock the server takes a session's time, in milliseconds.
  public static let clockSlackMs = 5 * 60_000

  /// A weigh-in: 20 to 400 kg, on a 0.1 kg grid (`isWeighingKg`).
  public static let weighInKgMin = 20.0
  public static let weighInKgMax = 400.0
  /// A measure is kept to the tenth of a centimetre within its field's bounds (`isMeasureCm`).
  public static func measureCm(_ field: MeasureField) -> ClosedRange<Double> {
    switch field {
    case .waist: 40...200
    case .neck: 20...80
    case .hip: 50...200
    }
  }
  /// A day's intake, in whole kilocalories and grams of protein, from 0.
  public static let kcalMax = 10_000
  public static let proteinGMax = 500
  /// Counted in UTF-16 units, as the web counts them.
  public static let annotationLabelMax = 80
  /// No body entry is dated before 1900.
  public static let minDate = "1900-01-01"

  /// The loss range, in percent per week: 0.25 to 1 on a 0.05 grid, its bounds 0.1 apart at least.
  public static let target = (min: 0.25, max: 1.0, step: 0.05)
  public static let targetGap = 0.1
  /// The tools take ages 15 to 100; the profile's birth year follows from them.
  public static let ageYears = 15...100
  /// The profile's height, in whole centimetres.
  public static let heightCm = 120...230
  /// Counted in UTF-16 units once trimmed, as the web counts them.
  public static let supplementNameMax = 40
  /// An activity lasts 5 to 480 minutes, by 5.
  public static let activityMinutes = 5...480
  public static let activityMinutesStep = 5
  public static let climbRuns = 0...200
  /// Whole steps; the stepper's 100 is only its nudge, a typed 8 437 is fine.
  public static let steps = 0...100_000
  public static let stepsStep = 100
  /// The contract's words for an activity, in the web's order.
  public static let activityKinds = ["cardio", "climbing"]
  public static let cardioTypes = ["run", "bike", "row", "walk", "swim", "other"]
  public static let climbStyles = ["boulder", "route"]
  public static let climbColors = ["yellow", "green", "blue", "red", "black", "purple", "white"]
  /// The French scale, the same list for boulders and routes: 5a, 5a+, 5b … 8c, 8c+.
  public static let climbGrades = ["5", "6", "7", "8"].flatMap { n in
    ["a", "b", "c"].flatMap { l in ["\(n)\(l)", "\(n)\(l)+"] }
  }
}
