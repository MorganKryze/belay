#if DEBUG
import BelayCore
import Foundation
import Synchronization

/// The UI tests' account, in a debug build only: `-BelayFixture <mode>` signs in a made-up person
/// on a made-up instance that never answers, with a store of its own in the app's caches.
/// `fresh` starts from an empty store, `running` from one with a session started, `keep` from the
/// store the previous launch left, so a test can relaunch onto it.
enum Fixture {
    private static let origin = "https://belay.example"
    private static let userId = "fixture"

    static func account() -> AccountModel? {
        guard let mode = UserDefaults.standard.string(forKey: "BelayFixture") else { return nil }
        guard let defaults = UserDefaults(suiteName: "belay.fixture"), let url = URL(string: origin) else {
            preconditionFailure("the fixture's defaults do not open")
        }
        let folder = URL.cachesDirectory.appending(path: "BelayFixture", directoryHint: .isDirectory)
        let secrets = FixtureSecrets()
        let session = StoredSession(store: secrets, defaults: defaults)
        // A fixture that cannot set itself up must stop the test run, not pass on another state.
        do {
            if mode != "keep", FileManager.default.fileExists(atPath: folder.path) {
                try FileManager.default.removeItem(at: folder)
            }
            if mode == "running" {
                // Through the same start a tap makes, so the store holds what the app writes.
                let store = try AccountStore.open(userId: userId, origin: url, in: folder)
                _ = try TrainingModel(store: store, didWrite: {}, now: Date.init, timeZone: .current).start()
            }
            defaults.set(origin, forKey: StoredInstance.key)
            try session.keep(origin: origin, token: "fixture-token")
            session.remember(userId: userId)
        } catch {
            preconditionFailure("the fixture did not set up: \(error)")
        }
        return AccountModel(secrets: secrets, http: OfflineClient(), defaults: defaults, storeFolder: folder)
    }
}

/// A token kept for this launch only.
private nonisolated final class FixtureSecrets: SecretStore {
    private let kept = Mutex<(origin: String, token: String)?>(nil)

    func read(origin: String) -> String? {
        kept.withLock { $0?.origin == origin ? $0?.token : nil }
    }

    func write(origin: String, token: String) throws {
        kept.withLock { $0 = (origin, token) }
    }

    func clear() throws {
        kept.withLock { $0 = nil }
    }
}

/// An instance that is never reachable, as on a phone with no network.
private nonisolated struct OfflineClient: HTTPClient {
    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        throw URLError(.notConnectedToInternet)
    }
}
#endif
