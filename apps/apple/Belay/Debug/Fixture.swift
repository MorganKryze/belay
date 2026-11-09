#if DEBUG
import BelayCore
import Foundation
import SwiftUI
import Synchronization

/// The UI tests' account, in a debug build only: `-BelayFixture <mode>` signs in a made-up person
/// on a made-up instance that never syncs, with a store of its own in the app's caches.
/// `fresh` starts from an empty store, `running` from one with a session started, `history` from
/// one where session A was done yesterday and is open again, `past` from one where every session
/// of the program was done once, A first, so A comes next with a last time, `keep` from the store the previous
/// launch left, so a test can relaunch onto it. `expired` starts empty on an instance that refuses
/// the token at each sync.
enum Fixture {
    nonisolated fileprivate static let origin = "https://belay.example"
    nonisolated fileprivate static let userId = "fixture"

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
            if mode == "past" {
                let store = try AccountStore.open(userId: userId, origin: url, in: folder)
                let model = TrainingModel(store: store, didWrite: {}, now: Date.init, timeZone: .current)
                // Each session started, done some days back and its open copy deleted, until A
                // comes round again; the bound only stops a program the loop cannot go round.
                for round in 0..<8 {
                    let id = try model.start()
                    let code = try store.history().workouts.first(where: { $0.id == id })?.sessionCode
                    if round > 0, code == "A" { try model.delete(); break }
                    try doneYesterday(like: id, in: store, daysAgo: Double(10 - round))
                    try model.delete()
                }
            }
            if mode == "running" || mode == "history" {
                // Through the same start a tap makes, so the store holds what the app writes.
                let store = try AccountStore.open(userId: userId, origin: url, in: folder)
                let id = try TrainingModel(store: store, didWrite: {}, now: Date.init, timeZone: .current).start()
                if mode == "history" { try doneYesterday(like: id, in: store) }
            }
            defaults.set(origin, forKey: StoredInstance.key)
            try session.keep(origin: origin, token: "fixture-token")
            session.remember(userId: userId, displayName: "Ada")
        } catch {
            preconditionFailure("the fixture did not set up: \(error)")
        }
        return AccountModel(
            secrets: secrets, http: FixtureClient(refusesSync: mode == "expired"), sheet: FixtureSheet(),
            defaults: defaults, storeFolder: folder)
    }

    /// The same session done a day earlier, or `daysAgo`, its first exercise at 62,5 kg for 8, 8, 7 and 6.
    private static func doneYesterday(like openId: String, in store: AccountStore, daysAgo: Double = 1) throws {
        guard let open = try store.history().workouts.first(where: { $0.id == openId }) else { return }
        let start = Date.now.addingTimeInterval(-86_400 * daysAgo)
        let id = UUIDv7.make(at: start)
        let at = { (minutes: Double) in Instant.string(start.addingTimeInterval(minutes * 60)) }
        let exercise = open.plan[0].exerciseId
        let sets = [8, 8, 7, 6].enumerated().map { round, reps in
            Change.set(
                SetChange(
                    id: UUIDv7.make(at: start.addingTimeInterval(Double(round + 1) * 180)), workoutId: id,
                    at: at(Double(round + 1) * 3),
                    edit: .create(
                        .init(
                            slotIndex: 0, position: Bounds.maxWarmups + round, exerciseId: exercise,
                            warmup: false, values: SetValues(weightKg: 62.5, reps: reps, seconds: .null, rir: 2),
                            doneAt: at(Double(round + 1) * 3)))))
        }
        let started = Change.workout(
            WorkoutChange(
                id: id, at: at(0),
                edit: .start(
                    .init(
                        sessionCode: open.sessionCode, sessionId: open.sessionId, sessionName: .null,
                        plan: open.plan, startedAt: at(0)))))
        let ended = Change.workout(WorkoutChange(id: id, at: at(60), edit: .ended(at(60))))
        try store.recordChanges([started] + sets + [ended], active: .keep)
    }

    /// How many set changes of the open session wait in the queue, for a test to read; nothing a
    /// person sees or hears.
    struct QueueProbe: View {
        let store: AccountStore
        @State private var count = 0

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("fixture-queue")
                .accessibilityValue(String(count))
                .task {
                    let counts = store.observe { db in
                        let open = try AccountStore.activeSession(db)?.workoutId
                        return try AccountStore.outbox(db, limit: nil).filter { entry in
                            if case .set(let change) = entry.change { change.workoutId == open } else { false }
                        }.count
                    }
                    do {
                        for try await value in counts { count = value }
                    } catch {
                        preconditionFailure("the fixture's queue is not followed: \(error)")
                    }
                }
        }
    }

    /// Whether `-BelayContrast increased` asks for increased contrast, which a test cannot set.
    static var contrastIncreased: Bool { UserDefaults.standard.string(forKey: "BelayContrast") == "increased" }

    /// Whether this launch runs on the fixture.
    static var isOn: Bool { UserDefaults.standard.string(forKey: "BelayFixture") != nil }
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

/// An instance whose sync is never reachable, as on a phone with no network, or refuses the token
/// when `refusesSync`, but that still answers a sign-in, so a test can sign out and back in as the
/// same person.
private nonisolated struct FixtureClient: HTTPClient {
    let refusesSync: Bool

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let answer: String
        var status = 200
        switch request.url?.path() {
        case "/api/sync" where refusesSync:
            answer = "{}"
            status = 401
        case "/api/instance": answer = #"{"app":"belay","api":1,"origin":"\#(Fixture.origin)"}"#
        case "/auth/native/token": answer = #"{"token":"fixture-token"}"#
        case "/api/me": answer = #"{"id":"\#(Fixture.userId)","displayName":"Ada"}"#
        case "/auth/logout": answer = "{}"
        default: throw URLError(.notConnectedToInternet)
        }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.badURL) }
        return (Data(answer.utf8), response)
    }
}

/// The sign-in sheet, answered at once with a code the fixture's instance takes.
private struct FixtureSheet: SignInSheet {
    func open(_ url: URL) async -> Result<URL, SignInFailure> {
        guard let callback = URL(string: "\(SignInFlow.callbackScheme)://signin?code=fixture") else {
            return .failure(.failed)
        }
        return .success(callback)
    }
}
#endif
