import BelayCore
import Foundation
import os

/// A past session as the store holds it now, and its writes: a set corrected or removed, the
/// session deleted. Each write is one change of the store, queued for the next sync; Health is
/// told after each, so a session deleted, or left with no set, leaves it.
@MainActor @Observable
final class PastSessionModel: SetCorrecting {
    let workoutId: String
    /// Nil once the session is gone, here or from another device.
    private(set) var session: PastSession?
    private let store: AccountStore
    private let actions: HistoryActions
    private let didWrite: () -> Void
    private let health: () -> Void

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "past")

    init(
        workoutId: String, store: AccountStore, didWrite: @escaping () -> Void, health: @escaping () -> Void,
        now: @escaping @Sendable () -> Date
    ) {
        self.workoutId = workoutId
        self.store = store
        actions = HistoryActions(store: store, now: now)
        self.didWrite = didWrite
        self.health = health
    }

    /// Follows the store while the screen shows, so a write from here or from a sync shows at once.
    func follow() async {
        let workoutId = workoutId
        let sessions = store.observe { db in
            pastSession(
                try AccountStore.history(db), workoutId: workoutId,
                efforts: try AccountStore.efforts(db))
        }
        do {
            for try await value in sessions where value != session { session = value }
        } catch {
            Self.log.error("past session not followed: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    func correct(setId: String, weightKg: Double, count: Int, rir: Int?) throws {
        try actions.correct(setId: setId, weightKg: weightKg, count: count, rir: rir)
        wrote()
    }

    func remove(setId: String) throws {
        try actions.remove(setId: setId)
        wrote()
    }

    func delete() throws {
        try actions.removeSession(workoutId: workoutId)
        wrote()
    }

    private func wrote() {
        didWrite()
        health()
    }
}
