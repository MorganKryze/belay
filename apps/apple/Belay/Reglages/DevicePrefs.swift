import BelayCore
import Foundation
import Observation

/// The choices this phone keeps for itself, as the web keeps them in each browser: under the
/// web's key names, with the web's values and defaults, never synced. Each is read when its
/// screen opens, so a choice made in Réglages shows on the next visit.
enum DevicePrefs {
    /// One preference: `initial` unless the phone holds one of the `others`.
    struct Choice<Value: RawRepresentable & Sendable>: Sendable where Value.RawValue == String {
        let key: String
        let initial: Value

        var value: Value {
            get { UserDefaults.standard.string(forKey: key).flatMap(Value.init(rawValue:)) ?? initial }
            nonmutating set { UserDefaults.standard.set(newValue.rawValue, forKey: key) }
        }
    }

    enum Shown: String, Sendable { case shown, hidden }
    enum Theme: String, Sendable { case light, dark, system }
    enum ActivityKind: String, Sendable { case cardio, climbing, steps }
    /// The tone at a rest's end: none, one the ring switch silences, one through silent mode.
    enum RestSound: String, Sendable { case off, on, over }

    static let theme = Choice(key: "belay.theme", initial: Theme.system)
    /// Read through `WeightUnitChoice`, so every weight on screen follows a change at once.
    static let weightUnit = Choice(key: "belay.weightUnit", initial: WeightUnit.kg)
    /// Discret, where the web starts muted: a phone needs no gesture before it may ring.
    static let restSound = Choice(key: "belay.restSound", initial: RestSound.on)
    /// Séances' history with each cardio and climb in its week.
    static let historyActivities = Choice(key: "belay.historyActivities", initial: Shown.shown)
    static let pauseStops = Choice(key: "belay.pauseStops", initial: PauseStops.all)
    /// Accueil's trend card.
    static let homeTrend = Choice(key: "belay.homeTrend", initial: Shown.shown)
    /// The range pill on Accueil and Corps; the figure stays.
    static let rangePill = Choice(key: "belay.rangePill", initial: Shown.shown)
    /// Each week's average calories in Tes semaines.
    static let weekIntake = Choice(key: "belay.weekIntake", initial: Shown.shown)
    /// The volume on the summary, a past session and the history.
    static let sessionVolume = Choice(key: "belay.sessionVolume", initial: Shown.shown)
    /// Brzycki beside Epley in 1RM.
    static let brzycki = Choice(key: "belay.oneRepMaxBrzycki", initial: Shown.shown)
    /// The line under a prefilled tool field that says where its value comes from.
    static let fieldSources = Choice(key: "belay.fieldSources", initial: Shown.shown)
    /// Every key above, which a fixture launch clears so each test starts from the web's defaults.
    static var keys: [String] {
        [theme.key, weightUnit.key, pauseStops.key, restSound.key, historyActivities.key, homeTrend.key, rangePill.key,
         weekIntake.key, sessionVolume.key, brzycki.key, fieldSources.key, activityKind.key]
    }
    /// The Activité sheet's last kind.
    static let activityKind = Choice(key: "belay.activity.tab", initial: ActivityKind.climbing)
}

/// The weight unit every screen shows, one for the app: a view whose body formats a weight reads
/// `unit` and redraws when it changes. Read at first use, which comes after a fixture launch has
/// cleared the stored choices.
@MainActor @Observable final class WeightUnitChoice {
    static let shared = WeightUnitChoice()

    var unit: WeightUnit {
        didSet { DevicePrefs.weightUnit.value = unit }
    }

    private init() { unit = DevicePrefs.weightUnit.value }
}
