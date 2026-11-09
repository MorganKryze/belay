import ActivityKit
import BelayActivity
import BelayCore
import Foundation
import UIKit
import UserNotifications
import os

/// The exercise library bundled with the app, read once; empty when the build lacks it.
enum BundledLibrary {
    static let library: ExerciseLibrary = {
        if let url = Bundle.main.url(forResource: "index", withExtension: "json"),
           let data = try? Data(contentsOf: url), let library = try? ExerciseLibrary(indexJSON: data) {
            return library
        }
        Logger(subsystem: "cloud.libresoftware.belay", category: "activity").error("exercise library not read")
        // A hand-written empty list always reads.
        return try! ExerciseLibrary(indexJSON: Data("[]".utf8))
    }()
}

extension ActivityWords {
    /// The Activity's and the alert's words, in the phone's language.
    static func phone(_ library: ExerciseLibrary) -> ActivityWords {
        ActivityWords(
            name: { library.exercise($0)?.name ?? $0 },
            setOf: { String(localized: "Série \($0) sur \($1)", table: "Alert") },
            warmup: String(localized: "Montée", table: "Alert"),
            load: { kg, count, timed in
                if timed { return String(localized: "\(count) s", table: "Alert") }
                // A set with no added load shows its count alone: never a body weight.
                guard kg > 0 else { return String(localized: "× \(count)", table: "Alert") }
                let load = kg.formatted(.number.precision(.fractionLength(0...2)))
                return String(localized: "\(load) kg × \(count)", table: "Alert")
            },
            rest: String(localized: "Repos", table: "Alert"),
            next: { k, load in String(localized: "Ensuite · série \(k) · \(load)", table: "Alert") },
            paused: String(localized: "En pause", table: "Alert"),
            stoppedAt: { String(localized: "Séance arrêtée à \($0)", table: "Alert") },
            allDone: String(localized: "Tout est noté", table: "Alert"),
            restOver: String(localized: "Repos terminé", table: "Alert"),
            stale: String(localized: "Ouvre Belay pour continuer", table: "Alert"))
    }
}

/// Follows the signed-in account's store and keeps one Live Activity and one rest alert true to
/// the open session: started, updated when what they show changes, ended with the session.
final class LiveActivityController {
    private typealias Content = BelayActivity.ActivityContent

    private let account: AccountModel
    private let alert = RestAlert()
    private let words = ActivityWords.phone(BundledLibrary.library)
    private var followed: AccountStore?
    private var following: Task<Void, Never>?
    /// What the Activity shows, as last handed to the system.
    private var shown: Content?
    /// Whether the system has heard of a read since launch, so a leftover Activity is settled once.
    private var synced = false
    /// Runs the system calls one after the other, in the order the states came.
    private var queue: Task<Void, Never>?
    private var asked = false
    private var foreground: NSObjectProtocol?

    private nonisolated static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "activity")

    init(account: AccountModel) {
        self.account = account
        // No sync before the first read: ending everything first would end the open session's
        // Activity, and a launch in the background could not start it again.
        trackStore()
        // An Activity can only start in front: coming back starts the one that could not.
        foreground = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.enqueue(self?.shown) }
        }
    }

    private func trackStore() {
        let store = withObservationTracking { account.store } onChange: { [weak self] in
            Task { @MainActor in self?.trackStore() }
        }
        guard store !== followed else { return }
        followed = store
        following?.cancel()
        following = nil
        guard let store else {
            // Signed out, no session is open: any Activity ends, a leftover the controller never
            // showed included, so this read goes to the system even when nothing was shown.
            synced = false
            return show(nil)
        }
        following = Task { [weak self] in await self?.follow(store) }
    }

    private func follow(_ store: AccountStore) async {
        let reads = store.observe { db in
            Snapshot(history: try AccountStore.history(db), active: try AccountStore.activeSession(db))
        }
        do {
            for try await snapshot in reads { show(state(snapshot)) }
        } catch {
            Self.log.error("session not followed: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    private func state(_ snapshot: Snapshot) -> SessionState? {
        guard let active = snapshot.active,
              let workout = snapshot.history.workouts.first(where: { $0.id == active.workoutId }),
              workout.endedAt == nil, !workout.removed
        else { return nil }
        return sessionState(
            history: snapshot.history, active: active, now: Date(), library: BundledLibrary.library, bar: .gym,
            marks: activityMarks)
    }

    private func show(_ state: SessionState?) {
        alert.apply(state.map { restAlert($0, words: words) ?? .cancel } ?? .cancel)
        let content = state.flatMap { activityContent($0, words: words) }
        if content != nil { askPermissionOnce() }
        guard activityNeedsSync(from: shown, to: content, synced: synced) else { return }
        synced = true
        shown = content
        enqueue(content)
    }

    private func enqueue(_ content: Content?) {
        let previous = queue
        queue = Task {
            await previous?.value
            await Self.sync(content)
        }
    }

    /// One Activity, for `content`'s session: the one already there is updated, every other ended.
    private nonisolated static func sync(_ content: Content?) async {
        let all = Activity<SessionActivityAttributes>.activities
        let mine = content.flatMap { c in all.first { $0.attributes.workoutId == c.workoutId } }
        for activity in all where activity.id != mine?.id {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
        guard let content else { return }
        let next = ActivityKit.ActivityContent(state: content, staleDate: content.staleAt)
        if let mine {
            await mine.update(next)
        } else if await MainActor.run(body: { UIApplication.shared.applicationState == .active }) {
            do {
                _ = try Activity.request(attributes: SessionActivityAttributes(workoutId: content.workoutId), content: next)
            } catch {
                log.error("activity not started: \((error as NSError).code, privacy: .public)")
            }
        }
    }

    /// Asked once, at the first session open in front; refused, the in-app alert still rings.
    private func askPermissionOnce() {
        guard !asked, UIApplication.shared.applicationState == .active else { return }
        #if DEBUG
            // The UI tests' fixture never meets a system prompt.
            if Fixture.isOn { return }
        #endif
        asked = true
        Task {
            do {
                _ = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
            } catch {
                Self.log.error("notifications not asked: \((error as NSError).code, privacy: .public)")
            }
        }
    }
}

/// What the Activity reads, in one read of the store.
private nonisolated struct Snapshot: Sendable {
    let history: History
    let active: ActiveSession?
}
