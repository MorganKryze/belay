import BelayCore
import Foundation

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

    static let theme = Choice(key: "belay.theme", initial: Theme.system)
    static let pauseStops = Choice(key: "belay.pauseStops", initial: PauseStops.all)
    /// Accueil's trend card.
    static let homeTrend = Choice(key: "belay.homeTrend", initial: Shown.shown)
    /// The range pill on Accueil and Corps; the figure stays.
    static let rangePill = Choice(key: "belay.rangePill", initial: Shown.shown)
    /// The volume on the summary, a past session and the history.
    static let sessionVolume = Choice(key: "belay.sessionVolume", initial: Shown.shown)
    /// Brzycki beside Epley in 1RM.
    static let brzycki = Choice(key: "belay.oneRepMaxBrzycki", initial: Shown.shown)
    /// The line under a prefilled tool field that says where its value comes from.
    static let fieldSources = Choice(key: "belay.fieldSources", initial: Shown.shown)
    /// The Activité sheet's last kind.
    static let activityKind = Choice(key: "belay.activity.tab", initial: ActivityKind.climbing)
}
