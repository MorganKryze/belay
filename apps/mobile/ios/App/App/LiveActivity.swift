import ActivityKit
import Foundation
import os

// What the page sends: the open session it wants on the lock screen, already written in the
// person's language. The keys are the shared type's field names, so the page and the extension
// cannot read the same description two ways.
struct SessionActivityPayload: Decodable {
    let workoutId: String
    let staleAt: Date
    let state: SessionActivityAttributes.ContentState

    // A missing value or null asks for no Activity; anything that does not decode is refused.
    static func from(_ value: Any?) throws -> SessionActivityPayload? {
        guard let value, !(value is NSNull) else { return nil }
        // JSONSerialization raises an Objective-C exception, not a Swift error, on a value it
        // cannot write, so the check comes first.
        guard JSONSerialization.isValidJSONObject(value) else {
            throw CocoaError(.coderInvalidValue)
        }
        let data = try JSONSerialization.data(withJSONObject: value)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .millisecondsSince1970
        return try decoder.decode(SessionActivityPayload.self, from: data)
    }
}

// Brings iOS's Activities in line with the page's description: one Activity at a time, for the
// session the page describes, or none.
enum LiveActivity {
    // The last session that got an Activity. A session whose Activity the person removed, or iOS
    // ended at its 8-hour limit, gets no second one: the person said no, or the session was left.
    static let shownKey = "belay.activity.shown"

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "activity")

    static func isLive(_ activity: Activity<SessionActivityAttributes>) -> Bool {
        activity.activityState == .active || activity.activityState == .stale
    }

    static func show(_ payload: SessionActivityPayload?) async {
        var current: Activity<SessionActivityAttributes>?
        for activity in Activity<SessionActivityAttributes>.activities where isLive(activity) {
            if let payload, current == nil, activity.attributes.workoutId == payload.workoutId {
                current = activity
            } else {
                // Gone at once, with no final content: the person finishes in the app, which
                // shows the summary, so nothing is left to read on the lock screen.
                await activity.end(nil, dismissalPolicy: .immediate)
            }
        }
        guard let payload else { return }
        let content = ActivityContent(state: payload.state, staleDate: payload.staleAt)
        if let current {
            await current.update(content)
            return
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              UserDefaults.standard.string(forKey: shownKey) != payload.workoutId
        else { return }
        do {
            _ = try Activity.request(
                attributes: SessionActivityAttributes(workoutId: payload.workoutId),
                content: content,
                pushType: nil
            )
            UserDefaults.standard.set(payload.workoutId, forKey: shownKey)
        } catch {
            // A refused start changes nothing and the app carries on; the content stays out of
            // the log, it describes a person's training.
            log.error("Activity request failed: \(String(describing: error), privacy: .public)")
        }
    }
}
