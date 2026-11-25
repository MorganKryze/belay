import BelayCore
import Foundation
import Observation
import WatchConnectivity
import os

/// Where the account tells its watch what changed: the published state and whether a watch with
/// Belay on it is paired.
protocol WatchPublishing: AnyObject {
    func publish(_ state: [String: String])
    var watchAppInstalled: Bool { get }
}

/// No watch: nothing is published and none is installed.
final class NoWatch: WatchPublishing {
    func publish(_ state: [String: String]) {}
    var watchAppInstalled: Bool { false }
}

/// The iPhone's side of its watch: answers the watch's live request for the session and publishes
/// the account's state, which the system keeps for the watch, as the application context. The token
/// goes only in the reply; the context holds the version and the session's id.
@Observable
final class WatchLink: NSObject, WCSessionDelegate, WatchPublishing {
    /// Whether a paired watch has Belay on it, as the system last said.
    private(set) var watchAppInstalled = false

    /// The answer to the watch's request, built on the main actor.
    private nonisolated let answer: @MainActor @Sendable () -> [String: String]
    /// The last state published, sent again once the session is activated or the watch app appears.
    @ObservationIgnored private var last: [String: String]?

    nonisolated private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "watch")

    private init(answer: @escaping @MainActor @Sendable () -> [String: String]) {
        self.answer = answer
        super.init()
    }

    /// Made in the app's init, before any scene: a request from the watch can launch the app in the
    /// background, and the system delivers it only to an activated session with its delegate set.
    /// The account holds the link; the system's session holds its delegate weakly.
    static func start(answer: @escaping @MainActor () -> [String: String]) -> WatchLink {
        let link = WatchLink(answer: answer)
        if WCSession.isSupported() {
            WCSession.default.delegate = link
            WCSession.default.activate()
        }
        return link
    }

    func publish(_ state: [String: String]) {
        guard state != last else { return }
        last = state
        send()
    }

    /// The last state, to a paired watch with Belay on it; a session not yet activated sends it once
    /// it is.
    private func send() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        watchAppInstalled = session.activationState == .activated && session.isPaired && session.isWatchAppInstalled
        guard watchAppInstalled, let last else { return }
        do {
            try session.updateApplicationContext(last)
        } catch {
            Self.log.error("watch state not sent: \((error as NSError).code, privacy: .public)")
        }
    }

    nonisolated func session(
        _ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?
    ) {
        if let error { Self.log.error("watch session not activated: \((error as NSError).code, privacy: .public)") }
        Task { @MainActor in send() }
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in send() }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    /// The iPhone moved to another watch: the system asks for a new activation.
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    /// The watch's request, answered from the account on the main actor; anything else gets an
    /// empty reply and no token.
    nonisolated func session(
        _ session: WCSession, didReceiveMessage message: [String: Any],
        replyHandler: @escaping ([String: Any]) -> Void
    ) {
        guard Handover.isRequest(message) else { return replyHandler([:]) }
        // The system lets the handler be called once from any queue; it is called once, below.
        nonisolated(unsafe) let reply = replyHandler
        Task { @MainActor [answer] in reply(answer()) }
    }
}
