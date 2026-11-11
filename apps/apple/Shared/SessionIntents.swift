import AppIntents
import BelayActivity

// The Live Activity's buttons. iOS runs them in the app's process, where the launch installed
// the handler that writes to the account's store. In the extension's process no handler is
// installed, so they write nothing there.

/// ✓: logs the set the Activity showed.
struct LogSetIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = LocalizedStringResource("Noter la série", table: "Activity")
    static let isDiscoverable = false

    @Parameter(title: LocalizedStringResource("Séance", table: "Activity"))
    var workoutId: String
    @Parameter(title: LocalizedStringResource("Exercice", table: "Activity"))
    var slotIndex: Int
    @Parameter(title: LocalizedStringResource("Série", table: "Activity"))
    var position: Int

    init() {}

    init(workoutId: String, place: SetPlace) {
        self.workoutId = workoutId
        slotIndex = place.slotIndex
        position = place.position
    }

    func perform() async throws -> some IntentResult {
        if let handler = LockScreen.handler {
            _ = await handler.logShown(
                workoutId: workoutId, place: SetPlace(slotIndex: slotIndex, position: position))
        }
        return .result()
    }
}

/// +30 s on the running rest.
struct AddThirtyIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = LocalizedStringResource("Ajouter 30 secondes", table: "Activity")
    static let isDiscoverable = false

    @Parameter(title: LocalizedStringResource("Séance", table: "Activity"))
    var workoutId: String

    init() {}

    init(workoutId: String) { self.workoutId = workoutId }

    func perform() async throws -> some IntentResult {
        if let handler = LockScreen.handler { _ = await handler.addThirty(workoutId: workoutId) }
        return .result()
    }
}
