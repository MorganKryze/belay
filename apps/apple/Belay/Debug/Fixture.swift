#if DEBUG
import BelayCore
import Foundation
import SwiftUI
import Synchronization

/// The UI tests' account, in a debug build only: `-BelayFixture <mode>` signs in a made-up person
/// on a made-up instance that never syncs, with a store of its own in the app's caches.
/// `fresh` starts from an empty store, `running` from one with a session started, `history` from
/// one where session A was done yesterday and is open again, `finished` from `history` with one set
/// of the first exercise logged at 65 kg for 8, a record over yesterday's, `past` from one where every session
/// of the program was done once, A first, so A comes next with a last time, `keep` from the store the previous
/// launch left, so a test can relaunch onto it. `expired` starts empty on an instance that refuses
/// the token at each sync. From `history`: `warmups` as it is, its first exercise's warm-ups due;
/// `timed` with a dead hang in place of the first exercise; `group` with the first two exercises
/// in one group; `lastSet` with every planned set logged but the last, `twoLeft` but the last two;
/// `exerciseEnd` with the first exercise's last work set due and a last time for the second, so it
/// has a warm-up; `paused` paused at once; `lockLogged` with the first work set logged from the lock
/// screen, its rest running; `workSet` with the warm-ups logged; `full` as `workSet` with the plan
/// grown to the most slots it holds. `-BelayReduceMotion YES` forces Reduce Motion on the session's
/// cover, `-BelayVoiceOver YES` makes it behave as under VoiceOver.
///
/// The day's modes, each on the clock `-BelayNow yyyy-MM-ddTHH:mm:ss` sets (local time) or the
/// phone's: `doneToday` with session A kept today at effort 4; `fixedWeek` on a fixed week with
/// session A due today, `restDay` with today a rest day and A tomorrow, `doneEarly` with today's
/// session B kept yesterday; `noProgram` with the starting program removed, another one to choose
/// and a session kept once, `firstLaunch` the same with none kept; `weeks` with 60 sessions over
/// the last 12 weeks, one across a DST change where the zone has one; `pastSession` with session A
/// kept yesterday, its warm-up, its sets and an effort.
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
                    if round > 0, code == "A" { try model.stopEmpty(); break }
                    try doneYesterday(like: id, in: store, daysAgo: Double(10 - round))
                    try model.stopEmpty()
                }
            }
            if dayModes.contains(mode) {
                let store = try AccountStore.open(userId: userId, origin: url, in: folder)
                try prepareDay(mode, store: store)
            }
            if openModes.contains(mode) {
                // Through the same start and actions a tap makes, so the store holds what the app writes.
                let store = try AccountStore.open(userId: userId, origin: url, in: folder)
                // `pausedLong` starts 75 minutes back, so its pause stands past the hour.
                let startedAt = mode == "pausedLong" ? Date.now.addingTimeInterval(-75 * 60) : Date.now
                let id = try TrainingModel(store: store, didWrite: {}, now: { startedAt }, timeZone: .current).start()
                let model = TrainingModel(store: store, didWrite: {}, now: Date.init, timeZone: .current)
                if mode != "running" { try doneYesterday(like: id, in: store) }
                if mode == "exerciseEnd" {
                    try doneYesterday(like: id, in: store, daysAgo: 2, slotIndex: 1, kg: 40, reps: [10, 10, 10])
                }
                // Yesterday's session was written beside the model: it reads it before acting.
                model.refresh()
                try prepare(mode, model: model, store: store, workoutId: id)
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

    private static let openModes: Set = [
        "running", "history", "finished", "warmups", "timed", "group", "lastSet", "twoLeft", "exerciseEnd", "paused",
        "pausedLong", "lockLogged", "workSet", "full",
    ]

    private static let dayModes: Set = [
        "doneToday", "fixedWeek", "restDay", "doneEarly", "noProgram", "firstLaunch", "weeks", "pastSession",
    ]

    /// The clock `-BelayNow` sets: that local time at launch, running on from there.
    nonisolated static let clock: (@Sendable () -> Date)? = {
        guard let text = UserDefaults.standard.string(forKey: "BelayNow") else { return nil }
        let parser = DateFormatter()
        parser.locale = Locale(identifier: "en_US_POSIX")
        parser.timeZone = .current
        parser.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        guard let start = parser.date(from: text) else { preconditionFailure("-BelayNow does not read: \(text)") }
        let launch = Date.now
        return { start.addingTimeInterval(Date.now.timeIntervalSince(launch)) }
    }()

    /// The fixture's now: the launch's clock, or the phone's.
    nonisolated static var now: Date { clock?() ?? .now }

    /// The store brought to a day's mode, with what the server would send and what the phone writes.
    private static func prepareDay(_ mode: String, store: AccountStore) throws {
        let now = Self.now
        // Monday 0, as the week's days are stored.
        let today = (Calendar.current.component(.weekday, from: now) + 5) % 7
        let day = { (offset: Int) in (today + offset + 7) % 7 }
        let seed = rotationOf(try store.programs())
        switch mode {
        case "doneToday":
            // Kept today at any hour: just after midnight when 70 minutes ago was still yesterday.
            let midnight = Calendar.current.startOfDay(for: now)
            let startedAt = max(now.addingTimeInterval(-70 * 60), midnight.addingTimeInterval(60))
            let id = try kept(seed[0], startedAt: startedAt, in: store)
            try store.giveEffort(workoutId: id, floor: 4)
        case "fixedWeek":
            try serve(program(fixed: [day(0): 0, day(2): 1, day(4): 2]), to: store, active: true)
        case "restDay":
            try serve(program(fixed: [day(1): 0, day(3): 1, day(5): 2]), to: store, active: true)
        case "doneEarly":
            try serve(program(fixed: [day(-2): 0, day(0): 1, day(2): 2]), to: store, active: true)
            let rotation = rotationOf(try store.programs())
            _ = try kept(rotation[1], startedAt: now.addingTimeInterval(-86_400), in: store)
        case "noProgram", "firstLaunch":
            try serve(program(fixed: nil), to: store, active: false)
            if mode == "noProgram" {
                _ = try kept(seed[0], startedAt: now.addingTimeInterval(-3 * 86_400), in: store)
            }
        case "weeks":
            var calendar = Calendar.current
            calendar.timeZone = .current
            let shift = TimeZone.current.nextDaylightSavingTimeTransition(after: now.addingTimeInterval(-84 * 86_400))
            var round = 0
            for back in stride(from: 83, through: 0, by: -1) where ((today - back) % 7 + 7) % 7 < 5 {
                guard let date = calendar.date(byAdding: .day, value: -back, to: calendar.startOfDay(for: now)) else {
                    continue
                }
                // An hour before the clocks change on that day, so the session runs across it.
                let start =
                    shift.map { calendar.isDate($0, inSameDayAs: date) } == true
                    ? shift!.addingTimeInterval(-3_600) : date.addingTimeInterval(18 * 3_600)
                guard start < now else { continue }
                let id = try kept(seed[round % seed.count], startedAt: start, in: store)
                if round % 3 == 0 { try store.giveEffort(workoutId: id, floor: round % 5 + 1) }
                round += 1
            }
        case "pastSession":
            let id = try kept(
                seed[0], startedAt: now.addingTimeInterval(-86_400), in: store, warmup: true, name: "Pectoraux et dos")
            try store.giveEffort(workoutId: id, floor: 3)
        default:
            break
        }
        try store.settleEndedEfforts(except: nil)
    }

    /// « Haut / Bas »: three sessions with the starting program's slots, rotating or on the
    /// weekdays given (Monday 0, to the session's index). The starting program is removed, so
    /// unless this one is made active nothing is planned.
    private static func program(fixed: [Int: Int]?) throws -> [String: Any] {
        let seed = try JSONSerialization.jsonObject(with: JSONEncoder().encode(Seed.programs)) as? [String: Any]
        guard let seed, var starter = (seed["programs"] as? [[String: Any]])?.first,
              let sessions = seed["sessions"] as? [[String: Any]], let slots = seed["slots"] as? [[String: Any]]
        else { preconditionFailure("the starting program does not read") }
        let programId = "00000000-0000-7000-8000-0000000000f0"
        let sessionIds = sessions.indices.map { String(format: "00000000-0000-7000-8000-0000000000f%d", $0 + 1) }
        let days: [Any] = (0..<7).map { day in fixed?[day].map { sessionIds[$0] as Any } ?? NSNull() }
        starter["removed"] = true
        starter["removedAt"] = "2026-01-01T00:00:00.000Z"
        let mine: [String: Any] = [
            "id": programId, "name": "Haut / Bas", "removed": false,
            "schedule": ["mode": fixed == nil ? "rotation" : "fixed", "days": days],
        ]
        let ownSessions = sessions.enumerated().map { index, session in
            session.merging(["id": sessionIds[index], "programId": programId]) { $1 }
        }
        let ownSlots = slots.enumerated().compactMap { index, slot -> [String: Any]? in
            guard let place = sessions.firstIndex(where: { $0["id"] as? String == slot["sessionId"] as? String })
            else { return nil }
            return slot.merging([
                "id": String(format: "00000000-0000-7000-8000-%012lx", 0x100 + index), "sessionId": sessionIds[place],
            ]) { $1 }
        }
        return [
            "cursor": "fixture", "workouts": [], "sets": [], "activities": [], "rejected": [], "hasMore": false,
            "programs": [starter, mine], "programSessions": ownSessions, "programSlots": ownSlots,
            "activeProgram": ["programId": programId, "at": "2026-01-01T00:00:00.000Z"],
        ]
    }

    /// The answer applied as a sync's; `active` false leaves the starting program's pointer, on
    /// the removed program.
    private static func serve(_ answer: [String: Any], to store: AccountStore, active: Bool) throws {
        var answer = answer
        if !active { answer["activeProgram"] = nil }
        let data = try JSONSerialization.data(withJSONObject: answer)
        try store.applyServer(sent: [], response: JSONDecoder().decode(SyncResponse.self, from: data))
    }

    /// A session kept: started at `startedAt`, three work sets of its first exercise (a warm-up
    /// first when asked) and three of its second, ended 64 minutes later, under `name` when given;
    /// its id.
    private static func kept(
        _ session: LetteredTemplate, startedAt start: Date, in store: AccountStore, warmup: Bool = false,
        name: String? = nil
    ) throws -> String {
        let id = UUIDv7.make(at: start)
        let at = { (minutes: Double) in Instant.string(start.addingTimeInterval(minutes * 60)) }
        var sets: [Change] = []
        let rows: [(slot: Int, position: Int, warmup: Bool, kg: Double, reps: Int)] =
            (warmup ? [(0, 0, true, 40, 8)] : [])
            + (0..<3).map { (0, Bounds.maxWarmups + $0, false, 62.5, 8 - $0) }
            + (0..<3).map { (1, Bounds.maxWarmups + $0, false, 40, 10) }
        for (index, row) in rows.enumerated() where session.slots.indices.contains(row.slot) {
            let done = at(Double(index + 1) * 4)
            sets.append(
                .set(
                    SetChange(
                        id: UUIDv7.make(at: start.addingTimeInterval(Double(index + 1) * 240)), workoutId: id, at: done,
                        edit: .create(
                            .init(
                                slotIndex: row.slot, position: row.position,
                                exerciseId: session.slots[row.slot].exerciseId, warmup: row.warmup,
                                values: SetValues(
                                    weightKg: row.kg, reps: row.reps, seconds: .null, rir: row.warmup ? nil : 2),
                                doneAt: done)))))
        }
        let started = Change.workout(
            WorkoutChange(
                id: id, at: at(0),
                edit: .start(
                    .init(
                        // The store names a start after its program session, and the seed's have no
                        // name: a named one is kept with no program session.
                        sessionCode: session.code, sessionId: name == nil ? .value(session.sessionId) : .null,
                        sessionName: name.map { .value($0) } ?? .null, plan: session.slots, startedAt: at(0)))))
        let ended = Change.workout(WorkoutChange(id: id, at: at(64), edit: .ended(at(64))))
        try store.recordChanges([started] + sets + [ended], active: .keep)
        return id
    }

    /// Seconds the ruler waits before keeping its count as the draft, when a test stretches it.
    static var draftDelay: Double { UserDefaults.standard.double(forKey: "BelayDraftDelay") }

    /// Reduce Motion forced on, for the test that checks the cover only fades.
    static var reduceMotion: Bool { UserDefaults.standard.bool(forKey: "BelayReduceMotion") }

    /// VoiceOver taken as running, for the test that checks the recap waits for a tap.
    static var voiceOver: Bool { UserDefaults.standard.bool(forKey: "BelayVoiceOver") }

    /// The open session brought to the mode's state, through the session's actions.
    private static func prepare(_ mode: String, model: TrainingModel, store: AccountStore, workoutId: String) throws {
        switch mode {
        case "finished":
            try passWarmups(model)
            var logged: SetChange?
            try model.act {
                try $0.choose(weightKg: 65, count: 8)
                logged = try $0.logNext(count: nil, weightKg: nil, expecting: nil)
            }
            if let logged { try model.answerRIR(setId: logged.id, rir: 2) }
            // The other sets as prefilled, so the cover opens on the finish flag.
            while model.open?.current != nil {
                try model.act {
                    _ = try $0.logNext(count: nil, weightKg: nil, expecting: nil)
                    try $0.skipRest()
                }
            }
        case "timed":
            try model.act { try $0.replace(slotIndex: 0, with: "belay:dead-hang") }
        case "group":
            guard var plan = try store.history().workouts.first(where: { $0.id == workoutId })?.plan else { return }
            plan[0].groupKey = "a"
            plan[1].groupKey = "a"
            let at = Instant.string(.now)
            try store.recordChanges([.workout(WorkoutChange(id: workoutId, at: at, edit: .plan(plan)))], active: .keep)
        case "lastSet", "twoLeft":
            let left = mode == "lastSet" ? 1 : 2
            while let open = model.open, open.setsPlanned - open.setsDone > left {
                try model.act {
                    _ = try $0.logNext(count: nil, weightKg: nil, expecting: nil)
                    try $0.skipRest()
                }
            }
        case "workSet":
            try passWarmups(model)
        case "full":
            try passWarmups(model)
            while let count = try store.history().workouts.first(where: { $0.id == workoutId })?.plan.count,
                  count < Bounds.maxSlots
            {
                try model.act { try $0.addExercise("ds:0313") }
            }
        case "exerciseEnd":
            try passWarmups(model)
            while case .due(let due)? = model.session?.phase, due.place.slotIndex == 0, due.number < due.of {
                try model.act {
                    _ = try $0.logNext(count: nil, weightKg: nil, expecting: nil)
                    try $0.skipRest()
                }
            }
        case "paused", "pausedLong":
            try model.act { try $0.pause() }
        case "lockLogged":
            try passWarmups(model)
            guard case .due(let due)? = model.session?.phase else { return }
            try model.act { _ = try LockScreenActions.logShown(due.place, workoutId: workoutId, using: $0) }
        default:
            break
        }
    }

    /// Logs the warm-ups due, as their ✓ would.
    private static func passWarmups(_ model: TrainingModel) throws {
        while case .due(let due)? = model.session?.phase, due.warmup {
            try model.act { _ = try $0.logNext(count: nil, weightKg: nil, expecting: nil) }
        }
    }

    /// Whether the cover runs its changes on the spring or the fade, for a test to read;
    /// nothing a person sees or hears.
    struct MotionProbe: View {
        /// The animation the cover runs its changes on.
        let animation: Animation

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("fixture-motion")
                .accessibilityValue(animation == Motion.fade ? "fade" : animation == Motion.spring ? "spring" : "other")
        }
    }

    /// The same session done a day earlier, or `daysAgo`, its first exercise at 62,5 kg for 8, 8, 7 and 6,
    /// or the exercise of `slotIndex` at the load and counts given.
    private static func doneYesterday(
        like openId: String, in store: AccountStore, daysAgo: Double = 1, slotIndex: Int = 0, kg: Double = 62.5,
        reps: [Int] = [8, 8, 7, 6]
    ) throws {
        guard let open = try store.history().workouts.first(where: { $0.id == openId }) else { return }
        let start = Date.now.addingTimeInterval(-86_400 * daysAgo)
        let id = UUIDv7.make(at: start)
        let at = { (minutes: Double) in Instant.string(start.addingTimeInterval(minutes * 60)) }
        let exercise = open.plan[slotIndex].exerciseId
        let sets = reps.enumerated().map { round, reps in
            Change.set(
                SetChange(
                    id: UUIDv7.make(at: start.addingTimeInterval(Double(round + 1) * 180)), workoutId: id,
                    at: at(Double(round + 1) * 3),
                    edit: .create(
                        .init(
                            slotIndex: slotIndex, position: Bounds.maxWarmups + round, exerciseId: exercise,
                            warmup: false, values: SetValues(weightKg: kg, reps: reps, seconds: .null, rir: 2),
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

    /// The effort and note the store holds for the latest session, for a test to read:
    /// « floor=4 settled=true note=… ». Nothing a person sees or hears.
    struct SummaryProbe: View {
        let store: AccountStore
        @State private var line = ""

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("fixture-summary")
                .accessibilityValue(line)
                .task {
                    let lines = store.observe { db in
                        let effort = try AccountStore.efforts(db).last
                        let note = try AccountStore.history(db).workouts.last?.note
                        return "floor=\(effort?.floor.map(String.init) ?? "none") settled=\(effort?.settled ?? false) note=\(note ?? "")"
                    }
                    do {
                        for try await value in lines { line = value }
                    } catch {
                        preconditionFailure("the fixture's summary is not followed: \(error)")
                    }
                }
        }
    }

    /// The active program the store holds and how many active-program changes wait in the
    /// queue, for a test to read: « active=<id> queued=1 ». Nothing a person sees or hears.
    struct ActiveProbe: View {
        let store: AccountStore
        @State private var line = ""

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("fixture-active")
                .accessibilityValue(line)
                .task {
                    let lines = store.observe { db in
                        let queued = try AccountStore.outbox(db, limit: nil).filter { entry in
                            if case .activeProgram = entry.change { true } else { false }
                        }.count
                        return "active=\(try AccountStore.programs(db).activeId ?? "none") queued=\(queued)"
                    }
                    do {
                        for try await value in lines { line = value }
                    } catch {
                        preconditionFailure("the fixture's active program is not followed: \(error)")
                    }
                }
        }
    }

    /// The past-session changes waiting in the queue, for a test to read: « removed=1 sets=0 », a
    /// session's removal and a set's correction or removal. Nothing a person sees or hears.
    struct HistoryProbe: View {
        let store: AccountStore
        @State private var line = ""

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("fixture-history")
                .accessibilityValue(line)
                .task {
                    let lines = store.observe { db in
                        let queued = try AccountStore.outbox(db, limit: nil).map(\.change)
                        let removed = queued.filter { change in
                            if case .workout(let workout) = change, case .removed = workout.edit { true } else { false }
                        }.count
                        let sets = queued.filter { change in
                            guard case .set(let set) = change else { return false }
                            switch set.edit {
                            case .values, .removed: return true
                            case .create: return false
                            }
                        }.count
                        return "removed=\(removed) sets=\(sets)"
                    }
                    do {
                        for try await value in lines { line = value }
                    } catch {
                        preconditionFailure("the fixture's history is not followed: \(error)")
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
