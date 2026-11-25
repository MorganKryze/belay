import BelayCore
import Foundation
import WatchConnectivity
import os

/// The watch's side of its iPhone: asks it live for the session, which comes back only in the
/// reply, and hands the state the iPhone publishes to the account.
@MainActor
final class PhoneLink: NSObject, WCSessionDelegate, PhoneAsking {
    /// Told each state the iPhone publishes. Set once, right after the account is made, before the
    /// main actor runs anything the delegate sends it.
    weak var account: WristAccount?

    private var activated = false
    /// Asks made before the session was activated, resumed once it is.
    private var waiting: [CheckedContinuation<Void, Never>] = []

    nonisolated private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "phone")

    /// Activates the link at once: the iPhone's state arrives only to an activated session with its
    /// delegate set. The system's session holds its delegate weakly; the app holds the link.
    override init() {
        super.init()
        if WCSession.isSupported() {
            WCSession.default.delegate = self
            WCSession.default.activate()
        } else {
            activated = true
        }
    }

    /// Nil when the iPhone is out of reach, the request fails or it answers in another version.
    nonisolated func askSession() async -> HandoverReply? {
        await activation()
        let session = WCSession.default
        guard WCSession.isSupported() else { return nil }
        guard session.activationState == .activated else {
            // An activation that failed is tried again, so the next ask can reach the iPhone
            // without a relaunch.
            session.activate()
            return nil
        }
        guard session.isReachable else { return nil }
        return await withCheckedContinuation { continuation in
            session.sendMessage(
                Handover.request,
                replyHandler: { reply in continuation.resume(returning: HandoverReply(reply)) },
                errorHandler: { error in
                    Self.log.error("session request failed: \((error as NSError).code, privacy: .public)")
                    continuation.resume(returning: nil)
                })
        }
    }

    /// Returns once the session has finished activating, whatever the outcome.
    private func activation() async {
        guard !activated else { return }
        await withCheckedContinuation { waiting.append($0) }
    }

    nonisolated func session(
        _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?
    ) {
        if let error { Self.log.error("phone link not activated: \((error as NSError).code, privacy: .public)") }
        // The state the iPhone published while the watch app was not running.
        let state = HandoverState(session.receivedApplicationContext)
        Task { @MainActor in
            activated = true
            let resumed = waiting
            waiting = []
            resumed.forEach { $0.resume() }
            if let state, let account { await account.received(state) }
        }
    }

    nonisolated func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        guard let state = HandoverState(applicationContext) else { return }
        Task { @MainActor in await account?.received(state) }
    }
}
