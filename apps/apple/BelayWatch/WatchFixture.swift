#if DEBUG
import BelayCore
import Foundation

/// The watch on a scripted iPhone and instance, for the UI tests: `-BelayWatchFixture` names the
/// state to reach (`asking`, `phoneOut`, `phoneSignedOut`, `connected`, `unreached`, `refused`,
/// `signedOutHere`, or `phoneBack`: out of reach at the first ask, then handing the session), and
/// `-BelayWatchKeep YES` relaunches on what the previous launch kept. The token stays in memory and
/// the preferences in a suite of their own, so a run touches neither the Keychain nor the app's own
/// preferences.
enum WatchFixture {
    private static let suite = "cloud.libresoftware.belay.watch.fixture"
    static let host = "belay.example"

    /// The account the fixture names, or nil for a launch without one.
    static func account() -> WristAccount? {
        let arguments = UserDefaults.standard
        guard let mode = arguments.string(forKey: "BelayWatchFixture") else { return nil }
        guard let defaults = UserDefaults(suiteName: suite) else { return nil }
        if !arguments.bool(forKey: "BelayWatchKeep") { defaults.removePersistentDomain(forName: suite) }

        let handed = HandoverReply.session(
            HandedSession(origin: "https://\(host)", token: "fixture-token", userId: "ana", name: "Ana", id: "fixture"))
        let phone: ScriptedPhone
        let server: ScriptedServer
        switch mode {
        case "asking": (phone, server) = (ScriptedPhone(answers: false, nil), ScriptedServer(status: 200))
        case "phoneOut": (phone, server) = (ScriptedPhone(nil), ScriptedServer(status: 200))
        case "phoneBack": (phone, server) = (ScriptedPhone(nil, handed), ScriptedServer(status: 200))
        case "phoneSignedOut": (phone, server) = (ScriptedPhone(.signedOut), ScriptedServer(status: 200))
        case "unreached": (phone, server) = (ScriptedPhone(handed), ScriptedServer(status: nil))
        case "refused": (phone, server) = (ScriptedPhone(handed), ScriptedServer(status: 401))
        default: (phone, server) = (ScriptedPhone(handed), ScriptedServer(status: 200))
        }
        let account = WristAccount(secrets: MemoryStore(), defaults: defaults, http: server, phone: phone)
        if mode == "signedOutHere" { account.signOutHere() }
        return account
    }
}

/// A token kept in memory, for one launch.
private final class MemoryStore: SecretStore, @unchecked Sendable {
    private let lock = NSLock()
    private var kept: (origin: String, token: String)?

    func read(origin: String) -> String? {
        lock.withLock { kept?.origin == origin ? kept?.token : nil }
    }

    func write(origin: String, token: String) throws {
        lock.withLock { kept = (origin, token) }
    }

    func clear() throws {
        lock.withLock { kept = nil }
    }
}

/// An iPhone that gives its answers in turn and then repeats the last, or never answers.
private actor ScriptedPhone: PhoneAsking {
    private let answers: Bool
    private var replies: [HandoverReply?]

    init(answers: Bool = true, _ replies: HandoverReply?...) {
        self.answers = answers
        self.replies = replies
    }

    func askSession() async -> HandoverReply? {
        if !answers { try? await Task.sleep(for: .seconds(3_600)) }
        return replies.count > 1 ? replies.removeFirst() : replies.first ?? nil
    }
}

/// An instance that names Ana with `status`, or cannot be reached when `status` is nil.
private struct ScriptedServer: HTTPClient {
    let status: Int?

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        guard let status, let url = request.url,
            let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.cannotConnectToHost) }
        return (Data(#"{"id":"ana","displayName":"Ana"}"#.utf8), response)
    }
}
#endif
