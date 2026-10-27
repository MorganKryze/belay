import ActivityKit
import Foundation

// The one type both the app and the lock screen extension compile, so what the app describes and
// what the extension draws cannot drift apart. Every word arrives here already written in the
// person's language: the extension has no text of its own.
struct SessionActivityAttributes: ActivityAttributes {
    enum Status: String, Codable, Hashable { case due, rest, paused, done }

    struct ContentState: Codable, Hashable {
        var status: Status
        var title: String          // the next set's exercise, or the line saying every set is done
        var detail: String         // the set's place in the session and the session's name
        var statusLabel: String    // the session bar's word for the status
        var restOverTitle: String  // shown once the rest has run out
        var restOverDetail: String
        var staleLine: String      // shown when the app has not spoken for too long
        var startedAt: Date        // the session's start, pauses folded in
        var pausedAt: Date?
        var restStart: Date?
        var restEnd: Date?
        var restFrozen: Bool       // a pause that stops everything holds the rest too
    }

    var workoutId: String
}
