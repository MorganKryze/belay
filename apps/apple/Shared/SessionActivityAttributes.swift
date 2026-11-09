import ActivityKit
import BelayActivity

/// The session's Live Activity: its content is what the app decided to show, so the extension
/// draws it without reading the store.
nonisolated struct SessionActivityAttributes: ActivityAttributes {
    typealias ContentState = BelayActivity.ActivityContent
    let workoutId: String
}
