import BelayCore
import Foundation
import os

/// The exercise library bundled with the app, read once for the session, the lock screen's
/// actions and the Live Activity. A build without it logs the reason and runs on an empty one.
enum BundledLibrary {
    static let library = ExerciseLibrary.bundled(at: Bundle.main.url(forResource: "index", withExtension: "json")) {
        Logger(subsystem: "cloud.libresoftware.belay", category: "library")
            .error("exercise library not read: \($0, privacy: .public)")
    }
}
