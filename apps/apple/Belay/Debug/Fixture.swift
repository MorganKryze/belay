#if DEBUG
import AVFoundation
import BelayCore
import Foundation
import SwiftUI
import Synchronization
import WebKit

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
/// screen, its rest running; `restEnding` with the first work set logged and its rest ending 15 s
/// after the launch; `workSet` with the warm-ups logged; `full` as `workSet` with the plan
/// grown to the most slots it holds. `-BelayReduceMotion YES` forces Reduce Motion on the session's
/// cover, `-BelayVoiceOver YES` makes it behave as under VoiceOver. `-BelayHealth allowed` stands
/// in for a Health that lets Belay in and holds a weigh-in of this morning at 79,9 kg, and makes
/// the sync land an empty answer, after which the import runs; `-BelayHealth refused` for one that
/// lets Belay write nothing. Without it the app asks the simulator's own Health.
///
/// The day's modes, each on the clock `-BelayNow yyyy-MM-ddTHH:mm:ss` sets (local time) or the
/// phone's: `doneToday` with session A kept today at effort 4; `fixedWeek` on a fixed week with
/// session A due today, `restDay` with today a rest day and A tomorrow, `doneEarly` with today's
/// session B kept yesterday; `noProgram` with the starting program removed, another one to choose
/// and a session kept once, `firstLaunch` the same with none kept; `weeks` with 60 sessions over
/// the last 12 weeks, one across a DST change where the zone has one; `pastSession` with session A
/// kept yesterday, its warm-up, its sets and an effort.
///
/// The body's modes, on the same clock, each with the Health import's card answered but
/// `healthCard`'s: `bodyUsual` with five weeks of weigh-ins losing 0,1 kg a day, today's at
/// 79,9 kg, a waist of 84,5 cm three days ago, today's intake at 1 850 kcal and 128 g, and one of
/// two supplements ticked; `bodyOutOfRange` with five weeks gaining slowly; `bodyEarly` with three
/// weigh-ins, the last yesterday at 79,8 kg; `bodyFirst` with none; `healthCard` empty;
/// `weighedFromHealth` with today's weigh-in filled by the Health import; `measures`, `intake` and
/// `supplements` as `bodyUsual` with five weeks of waists, a full profile, and creatine ticked
/// every day of the last 9; `trend` as `supplements` with creatine ticked every day of the last
/// 23, a « Semaine allégée » from 19 days back and a « Note · voyage » 9 days back.
///
/// Réglages' modes: `profileEmpty` and `supplementsEmpty` with no profile and no supplement;
/// `refused` with one change of each new kind (the height, the range, a supplement « Magnésium »,
/// today's activity and steps) refused by the server; `pending0`, `pending1` and `pending2` with
/// that many changes waiting to be sent; `queueUnreadable` as `pending2`, its queue unreadable.
///
/// Accueil's « Activité » modes: `activityNone` with nothing logged, `activityOne` with a climb of
/// 1 h 30 today, `activityMany` with that climb and 8 437 steps typed today; `stepsOff` with Santé on
/// and its steps import off, `stepsNone` with both on and no steps, `stepsActivity` as `stepsNone`
/// with the climb of `activityOne`. With `-BelayHealth allowed` Santé holds 8 437 steps today,
/// which the import brings in after the first sync.
///
/// The tools' modes: `tools` with a full profile, a week of weigh-ins around 80 kg and a waist of
/// 84,5 cm two days ago, for the fields a tool opens on; `toolsEmpty` with none of them.
///
/// The instance serves loops in every mode: each one a short video made on the phone, sent 3 s
/// after it is asked, since no media ships with the app. `loopLoading` never answers for one, and
/// `loopFailed` answers each with a 404 after the same wait, `loopBroken` with a body no player reads,
/// `loopOffline` the first ask for each loop as a phone off the network, the next with the loop.
/// `mediaStale` keeps a session from before the instance said it serves loops: `/api/me` says it does.
///
/// `-BelayApi same|behind|ahead|none` stands an instance on this build's contract version, the one
/// before, the one after, or one whose version check never answers; with it, the sync lands an empty
/// answer while the versions match. `signedOut` keeps no session, the instance's address in the field.
///
/// `-BelayWatch installed|none` stands a recording link in for the paired watch, with Belay on it
/// or not; without it the fixture has no watch. Its probes say what the watch was last told,
/// « session·<n> » or « signedOut·<n> » with n the session ids published so far, and what it would
/// be handed, « session|<host> » or « signedOut »: never a token, an id or a name.
///
/// `oldWebData` stands for the launch before the update: `doneToday`'s store, with a cookie, local
/// storage and a database in the web view's data, and the erase not run, so the next launch, on
/// `keep`, is the first after the update.
enum Fixture {
    nonisolated fileprivate static let origin = "https://belay.example"
    nonisolated fileprivate static let userId = "fixture"
    /// Where the fixture's account keeps its loops, every account's beneath it.
    nonisolated static let loopsFolder = URL.cachesDirectory.appending(path: "BelayFixture/Loops", directoryHint: .isDirectory)

    /// `queueUnreadable`: Réglages cannot read what waits to be sent, as when the store fails.
    static var queueUnreadable: Bool { UserDefaults.standard.string(forKey: "BelayFixture") == "queueUnreadable" }

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
            // A choice made by an earlier test stays for `keep` only; a launch argument still wins.
            if mode != "keep" { DevicePrefs.keys.forEach(UserDefaults.standard.removeObject(forKey:)) }
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
            if bodyModes.contains(mode) {
                let store = try AccountStore.open(userId: userId, origin: url, in: folder)
                try prepareBody(mode, store: store)
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
            if mode != "signedOut" {
                try session.keep(origin: origin, token: "fixture-token")
                session.remember(userId: userId, displayName: "Ada", media: mode != "mediaStale")
            }
        } catch {
            preconditionFailure("the fixture did not set up: \(error)")
        }
        let health = UserDefaults.standard.string(forKey: "BelayHealth")
        let api = apiVersion()
        let client = FixtureClient(
            refusesSync: mode == "expired", answersSync: health == "allowed" || api.set, api: api.version,
            loops: FixtureLoops(mode: mode))
        let loops = loopsFolder
        let watch: any WatchPublishing = recordedWatch ?? NoWatch()
        guard let health else {
            return AccountModel(
                secrets: secrets, http: client, sheet: FixtureSheet(), defaults: defaults, storeFolder: folder,
                loopsFolder: loops, watch: watch)
        }
        guard health == "allowed" || health == "refused" else { preconditionFailure("-BelayHealth does not read: \(health)") }
        return AccountModel(
            secrets: secrets, http: client, sheet: FixtureSheet(), defaults: defaults, storeFolder: folder,
            loopsFolder: loops, health: FixtureHealth(allowed: health == "allowed"), watch: watch)
    }

    /// `-BelayWatch`'s recording link; nil without it.
    static let recordedWatch: RecordingWatch? = {
        guard let watch = UserDefaults.standard.string(forKey: "BelayWatch") else { return nil }
        guard watch == "installed" || watch == "none" else { preconditionFailure("-BelayWatch does not read: \(watch)") }
        return RecordingWatch(installed: watch == "installed")
    }()

    /// A paired watch that keeps what it was told, in place of the system's link.
    final class RecordingWatch: WatchPublishing {
        let watchAppInstalled: Bool
        /// The session ids published so far, each once.
        private var ids: Set<String> = []
        private var signedIn = false

        init(installed: Bool) { watchAppInstalled = installed }

        func publish(_ state: [String: String]) {
            // The system keeps the published state on disk: it holds the version and the id alone.
            precondition(Set(state.keys).isSubset(of: ["v", "session"]), "the watch was told more than the session id")
            signedIn = state["session"] != nil
            if let id = state["session"] { ids.insert(id) }
        }

        /// « session·<n> » or « signedOut·<n> ».
        var told: String { "\(signedIn ? "session" : "signedOut")·\(ids.count)" }
    }

    /// The version `-BelayApi` has the instance answer, nil for none, and whether it was given.
    private static func apiVersion() -> (version: Int?, set: Bool) {
        guard let api = UserDefaults.standard.string(forKey: "BelayApi") else { return (Bounds.apiVersion, false) }
        switch api {
        case "same": return (Bounds.apiVersion, true)
        case "behind": return (Bounds.apiVersion - 1, true)
        case "ahead": return (Bounds.apiVersion + 1, true)
        case "none": return (nil, true)
        default: preconditionFailure("-BelayApi does not read: \(api)")
        }
    }

    private static let openModes: Set = [
        "running", "history", "finished", "warmups", "timed", "group", "lastSet", "twoLeft", "exerciseEnd", "paused",
        "pausedLong", "lockLogged", "restEnding", "workSet", "full",
    ]

    private static let dayModes: Set = [
        "doneToday", "fixedWeek", "restDay", "doneEarly", "noProgram", "firstLaunch", "weeks", "pastSession",
        "oldWebData",
    ]

    private static let bodyModes: Set = [
        "bodyUsual", "bodyOutOfRange", "bodyEarly", "bodyFirst", "healthCard", "weighedFromHealth", "measures", "intake",
        "supplements", "trend", "tools", "toolsEmpty", "profileEmpty", "supplementsEmpty", "refused", "pending0",
        "pending1", "pending2", "queueUnreadable", "activityNone", "activityOne", "activityMany", "stepsOff",
        "stepsNone", "stepsActivity",
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
        case "doneToday", "oldWebData":
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

    /// The store brought to a body mode, through the same actions the sheets write with, its days
    /// counted back from the fixture's today.
    private static func prepareBody(_ mode: String, store: AccountStore) throws {
        let now = Self.now
        let today = toISODate(now, timeZone: .current)
        let actions = BodyActions(store: store, now: { now }, timeZone: .current)
        let tenth = { (kg: Double) in (kg * 10).rounded() / 10 }
        if mode != "healthCard" { try store.setHealthImportOffered() }
        switch mode {
        case "bodyUsual", "measures", "intake", "supplements", "trend":
            // Seven-day ripples that cancel out, so each 7-day average stays on the line.
            let ripple = [0, 0.2, -0.1, 0.1, -0.2, 0, 0]
            for back in 0..<35 {
                try actions.weigh(date: addDays(today, -back), kg: tenth(79.9 + 0.1 * Double(back) + ripple[back % 7]))
            }
            try actions.measure(date: addDays(today, -3), waist: .set(84.5), neck: .clear, hip: .clear)
            try actions.intake(date: today, kcal: .set(1850), protein: .set(128))
            let supplements: [[String: Any]] = [
                ["id": creatineId, "name": "Créatine", "nameAt": "2026-01-01T00:00:00.000Z", "kind": "creatine", "removed": false],
                [
                    "id": "00000000-0000-7000-8000-0000000000d2", "name": "Vitamine D", "nameAt": "2026-01-01T00:00:00.000Z",
                    "kind": "other", "removed": false,
                ],
            ]
            var answer = emptyAnswer
            answer["supplements"] = supplements
            if mode == "intake" {
                answer["profile"] = [
                    "formula": "male", "formulaAt": "2026-01-01T00:00:00.000Z", "birthYear": 1990,
                    "birthYearAt": "2026-01-01T00:00:00.000Z", "heightCm": 180, "heightAt": "2026-01-01T00:00:00.000Z",
                ]
            }
            try serve(answer, to: store, active: true)
            try actions.take(supplementId: creatineId, date: today, taken: true)
            if mode == "supplements" || mode == "trend" {
                // Ta tendance's band needs a course begun before it, Compléments one still in its
                // first 14 days, which « depuis n jours » counts.
                for back in 1..<(mode == "trend" ? 23 : 9) {
                    try actions.take(supplementId: creatineId, date: addDays(today, -back), taken: true)
                }
            }
            if mode == "trend" {
                try actions.annotate(AnnotationInput(id: deloadId, date: addDays(today, -19), type: .deload, label: nil))
                try actions.annotate(AnnotationInput(id: noteId, date: addDays(today, -9), type: .note, label: "voyage"))
            }
            if mode == "measures" {
                for week in 1..<5 {
                    try actions.measure(
                        date: addDays(today, -3 - 7 * week), waist: .set(84.5 + 0.4 * Double(week)),
                        neck: week == 4 ? .set(38) : .keep, hip: week == 4 ? .set(98) : .keep)
                }
            }
        case "tools":
            for back in 0..<7 {
                try actions.weigh(date: addDays(today, -back), kg: tenth(80 + 0.1 * Double(back % 3)))
            }
            try actions.measure(date: addDays(today, -2), waist: .set(84.5), neck: .clear, hip: .clear)
            var answer = emptyAnswer
            answer["profile"] = [
                "formula": "male", "formulaAt": "2026-01-01T00:00:00.000Z", "birthYear": 1990,
                "birthYearAt": "2026-01-01T00:00:00.000Z", "heightCm": 180, "heightAt": "2026-01-01T00:00:00.000Z",
            ]
            try serve(answer, to: store, active: true)
        case "bodyOutOfRange":
            for back in 0..<35 {
                try actions.weigh(date: addDays(today, -back), kg: tenth(80.2 - 0.1 * Double(back / 5)))
            }
        case "bodyEarly":
            for (back, kg) in [(1, 79.8), (2, 79.9), (3, 80.0)] {
                try actions.weigh(date: addDays(today, -back), kg: kg)
            }
        case "refused":
            // One change of each kind the phone now writes, all refused by the server.
            try actions.setProfile(.height, .set(172))
            try actions.setTarget(minPct: 0.4, maxPct: 0.8)
            try actions.addSupplement(id: "00000000-0000-7000-8000-0000000000d3", name: "Magnésium")
            try actions.logActivity(
                ActivityInput(
                    id: "00000000-0000-7000-8000-0000000000f1", date: today,
                    fields: ActivityFields(type: "climbing", durationMin: 90, climbStyle: "boulder")))
            try actions.writeSteps(date: today, value: 8_437, own: true)
            let sent = try store.outbox(limit: nil)
            var answer = emptyAnswer
            answer["rejected"] = sent.indices.map { ["index": $0, "reason": "refused"] }
            let data = try JSONSerialization.data(withJSONObject: answer)
            try store.applyServer(sent: sent, response: JSONDecoder().decode(SyncResponse.self, from: data))
        case "pending1", "pending2", "queueUnreadable":
            // Weigh-ins the queue still holds, the sync never reaching the instance.
            for back in 0..<(mode == "pending1" ? 1 : 2) {
                try actions.weigh(date: addDays(today, -back), kg: 80)
            }
        case "activityOne", "activityMany":
            try actions.logActivity(
                ActivityInput(
                    id: "00000000-0000-7000-8000-0000000000f2", date: today,
                    fields: ActivityFields(type: "climbing", durationMin: 90, climbStyle: "boulder")))
            if mode == "activityMany" { try actions.writeSteps(date: today, value: 8_437, own: false) }
        case "stepsOff":
            try store.setHealthOn(true, now: now)
        case "stepsNone", "stepsActivity":
            try store.setHealthOn(true, now: now)
            try store.setHealthStepsOn(true)
            if mode == "stepsActivity" {
                try actions.logActivity(
                    ActivityInput(
                        id: "00000000-0000-7000-8000-0000000000f2", date: today,
                        fields: ActivityFields(type: "climbing", durationMin: 90, climbStyle: "boulder")))
            }
        case "weighedFromHealth":
            try store.setHealthOn(true, now: now)
            try store.setHealthImportOn(true)
            let morning = Calendar.current.startOfDay(for: now).addingTimeInterval(7 * 3_600)
            let sample = HealthSample(startedAt: Int64(min(morning, now).timeIntervalSince1970 * 1_000), kg: 79.9)
            _ = try store.importWeighIns([sample], anchor: "fixture", from: nil, now: now, timeZone: .current)
        default:
            break
        }
    }

    private static let creatineId = "00000000-0000-7000-8000-0000000000d1"
    private static let deloadId = "00000000-0000-7000-8000-0000000000e1"
    private static let noteId = "00000000-0000-7000-8000-0000000000e2"

    /// A sync's answer with nothing in it, for a mode to add its rows to.
    private static var emptyAnswer: [String: Any] {
        ["cursor": "fixture", "workouts": [], "sets": [], "activities": [], "rejected": [], "hasMore": false]
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
        case "restEnding":
            try passWarmups(model)
            try model.act { _ = try $0.logNext(count: nil, weightKg: nil, expecting: nil) }
            // The rest brought forward through the session's own +30 s, so it runs out while the
            // test watches the cover, after the alert has planned it.
            guard let end = model.restEndsAt else { return }
            let early = Int(end.timeIntervalSinceNow.rounded()) - 15
            try model.act { _ = try $0.addRest(seconds: -early) }
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

    /// What the rest's ends were heard as, for a test to read through `RestProbe`.
    static let restHeard = RestHeard()

    @Observable final class RestHeard {
        /// Tones played since the launch.
        fileprivate(set) var plays = 0
        /// The choice the last tone played under.
        fileprivate(set) var choice = "none"
        /// The audio session it played in: « ambient », « playback ».
        fileprivate(set) var category = "none"
        /// The sound of the rest notification last planned.
        fileprivate(set) var notificationSound = "none"

        func heard(choice: String, category: AVAudioSession.Category) {
            plays += 1
            self.choice = choice
            self.category = category.rawValue.replacingOccurrences(of: "AVAudioSessionCategory", with: "").lowercased()
        }

        func planned(sound: String?) {
            notificationSound = sound ?? "none"
        }
    }

    /// The rest tone as heard, read « choice|category|notification sound » with the count of tones
    /// as its label; nothing a person sees or hears.
    struct RestProbe: View {
        private let heard = Fixture.restHeard

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .allowsHitTesting(false)
                .accessibilityElement()
                .accessibilityIdentifier("debug-rest-tone")
                .accessibilityLabel(Text(verbatim: "\(heard.plays)"))
                .accessibilityValue(Text(verbatim: "\(heard.choice)|\(heard.category)|\(heard.notificationSound)"))
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

    /// How many times the bench press's loop was asked of the instance, and how many loops the
    /// phone keeps, for a test to read; nothing a person sees or hears.
    struct LoopProbe: View {
        var body: some View {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                let asked = FixtureLoops.asked.withLock { $0["/media/exercises/0025", default: 0] }
                let walk = FileManager.default.enumerator(at: Fixture.loopsFolder, includingPropertiesForKeys: nil)
                let kept = ((walk?.allObjects as? [URL]) ?? []).filter { $0.pathExtension == "mp4" }.count
                ZStack {
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement()
                        .accessibilityIdentifier("loop-asked")
                        .accessibilityValue(String(asked))
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement()
                        .accessibilityIdentifier("loops-kept")
                        .accessibilityValue(String(kept))
                }
            }
        }
    }

    /// How many times the instance was asked its version since the launch, for a test to read.
    struct VersionChecksProbe: View {
        var body: some View {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityElement()
                    .accessibilityIdentifier("debug-api-checks")
                    .accessibilityValue(String(FixtureClient.versionChecks.withLock { $0 }))
            }
        }
    }

    /// How many changes of any kind wait in the queue, for a test to read; nothing a person sees
    /// or hears.
    struct OutboxProbe: View {
        let store: AccountStore
        @State private var count = 0

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("fixture-outbox")
                .accessibilityValue(String(count))
                .task {
                    let counts = store.observe { db in try AccountStore.outbox(db, limit: nil).count }
                    do {
                        for try await value in counts { count = value }
                    } catch {
                        preconditionFailure("the fixture's queue is not followed: \(error)")
                    }
                }
        }
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

    /// The range and the height the store holds and how many range or profile changes wait in
    /// the queue, for a test to read: « target=0.3-0.6 height=168 queued=0 ». Nothing a person
    /// sees or hears.
    struct ProfileProbe: View {
        let store: AccountStore
        @State private var line = ""

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityIdentifier("fixture-profile")
                .accessibilityValue(line)
                .task {
                    let lines = store.observe { db in
                        let body = try AccountStore.body(db)
                        let queued = try AccountStore.outbox(db, limit: nil).filter { entry in
                            switch entry.change {
                            case .target, .profile: true
                            default: false
                            }
                        }.count
                        let target = body.target.map { "\($0.minPct)-\($0.maxPct)" } ?? "none"
                        let height = body.profile?.heightCm.map(String.init) ?? "none"
                        return "target=\(target) height=\(height) queued=\(queued)"
                    }
                    do {
                        for try await value in lines { line = value }
                    } catch {
                        preconditionFailure("the fixture's profile is not followed: \(error)")
                    }
                }
        }
    }

    /// `-BelayPull range|height|refusal|activity`: as the app goes to the background, a sync lands
    /// what another device wrote meanwhile, a range of 0,3 to 0,6 %, a height of 168 cm or a ride
    /// of 45 min yesterday, or the server refuses a weigh-in of today, so a test sees a pull land
    /// on a page left open.
    struct PullOnLeave: View {
        let store: AccountStore

        var body: some View {
            Color.clear
                .frame(width: 1, height: 1)
                .accessibilityHidden(true)
                .onReceive(NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)) { _ in
                    do {
                        try pull()
                    } catch {
                        preconditionFailure("the fixture's pull did not land: \(error)")
                    }
                }
        }

        private func pull() throws {
            let at = Instant.string(Fixture.now)
            var answer = Fixture.emptyAnswer
            var sent: [OutboxEntry] = []
            switch UserDefaults.standard.string(forKey: "BelayPull") {
            case "range": answer["target"] = ["minPct": 0.3, "maxPct": 0.6, "at": at]
            case "height":
                answer["profile"] = [
                    "formula": "male", "formulaAt": "2026-01-01T00:00:00.000Z", "birthYear": 1990,
                    "birthYearAt": "2026-01-01T00:00:00.000Z", "heightCm": 168, "heightAt": at,
                ]
            case "activity":
                answer["activities"] = [[
                    "id": "00000000-0000-7000-8000-0000000000f3",
                    "date": addDays(toISODate(Fixture.now, timeZone: .current), -1), "type": "cardio",
                    "durationMin": 45, "cardioType": "bike", "fieldsAt": at, "removed": false,
                ]]
            case "refusal":
                let actions = BodyActions(store: store, now: { Fixture.now }, timeZone: .current)
                try actions.weigh(date: toISODate(Fixture.now, timeZone: .current), kg: 81)
                sent = try store.outbox(limit: nil)
                answer["rejected"] = sent.indices.map { ["index": $0, "reason": "refused"] }
            default: return
            }
            let data = try JSONSerialization.data(withJSONObject: answer)
            try store.applyServer(sent: sent, response: JSONDecoder().decode(SyncResponse.self, from: data))
        }
    }

    /// Whether `-BelayContrast increased` asks for increased contrast, which a test cannot set.
    static var contrastIncreased: Bool { UserDefaults.standard.string(forKey: "BelayContrast") == "increased" }

    /// Whether this launch runs on the fixture.
    static var isOn: Bool { UserDefaults.standard.string(forKey: "BelayFixture") != nil }

    /// What the launch did with the old app's web data, « <records left>|<erased, skipped, failed
    /// or held> », or the plant's step while it runs, for a test that waits too long to say where.
    private static var webData = ""

    /// Whether this launch is `oldWebData`'s: the old app's data planted and the erase held.
    static var holdsOldWebData: Bool { UserDefaults.standard.string(forKey: "BelayFixture") == "oldWebData" }

    /// `oldWebData`'s launch, in place of the app's erase: the erase made owed again and the old
    /// app's data planted, for the next launch's erase to find.
    static func plantOldWebData() async {
        UserDefaults.standard.removeObject(forKey: OldAppData.doneKey)
        webData = "planting"
        await plantWebData()
        webData = "counting"
        await report("held")
    }

    /// What the app's own erase did on this launch, for the probe.
    static func record(_ outcome: OldAppData.Outcome) async {
        guard isOn else { return }
        switch outcome {
        case .erased: await report("erased")
        case .skipped: await report("skipped")
        case .failed: await report("failed")
        }
    }

    /// The probe's answer: the web data records left, then what the launch did.
    private static func report(_ outcome: String) async {
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        var records = await WKWebsiteDataStore.default().dataRecords(ofTypes: types).count
        // A planted record can take a moment to be listed.
        for _ in 0..<20 where outcome == "held" && records == 0 {
            try? await Task.sleep(for: .milliseconds(250))
            records = await WKWebsiteDataStore.default().dataRecords(ofTypes: types).count
        }
        webData = "\(records)|\(outcome)"
    }

    /// A cookie, local storage and a database written by a page, as the old app's web view left them.
    private static func plantWebData() async {
        let view = WKWebView(frame: .zero)
        let loaded = PageLoaded()
        view.navigationDelegate = loaded
        do {
            try await withCheckedThrowingContinuation { continuation in
                loaded.done = continuation
                webData = "loading"
                view.loadHTMLString("<html><body></body></html>", baseURL: URL(string: "https://localhost/"))
            }
            webData = "writing"
            _ = try await view.callAsyncJavaScript(
                """
                document.cookie = "old=1; max-age=86400; secure";
                localStorage.setItem("old", "1");
                await new Promise((resolve, reject) => {
                  const open = indexedDB.open("old", 1);
                  open.onupgradeneeded = () => open.result.createObjectStore("kept");
                  open.onerror = () => reject(open.error);
                  open.onsuccess = () => {
                    const write = open.result.transaction("kept", "readwrite");
                    write.objectStore("kept").put("1", "old");
                    write.oncomplete = () => resolve();
                    write.onerror = () => reject(write.error);
                  };
                });
                """, contentWorld: .page)
        } catch {
            preconditionFailure("the old app's web data was not planted: \(error)")
        }
    }

    /// Hands the page's load to the plant once it is done.
    private final class PageLoaded: NSObject, WKNavigationDelegate {
        var done: CheckedContinuation<Void, Error>?

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            done?.resume()
            done = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            done?.resume(throwing: error)
            done = nil
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            done?.resume(throwing: error)
            done = nil
        }
    }

    /// What the watch was last told and what it would be handed, for a test to read; nothing a
    /// person sees or hears, and never a token, an id or a name.
    struct WatchProbe: View {
        let watch: RecordingWatch
        let account: AccountModel

        var body: some View {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                ZStack {
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement()
                        .accessibilityIdentifier("debug-watch-context")
                        .accessibilityValue(watch.told)
                    Color.clear
                        .frame(width: 1, height: 1)
                        .accessibilityElement()
                        .accessibilityIdentifier("debug-watch-reply")
                        .accessibilityValue(handed)
                }
            }
        }

        private var handed: String {
            let reply = account.watchReply()
            guard reply["state"] == "session", let origin = reply["origin"].flatMap(URL.init(string:)) else {
                return "signedOut"
            }
            return "session|\(origin.host(percentEncoded: false) ?? "")"
        }
    }

    /// What the launch did with the old app's web data, for a test to read; nothing a person sees
    /// or hears.
    struct WebDataProbe: View {
        var body: some View {
            TimelineView(.periodic(from: .now, by: 0.5)) { _ in
                Color.clear
                    .frame(width: 1, height: 1)
                    .accessibilityElement()
                    .accessibilityIdentifier("debug-web-data")
                    .accessibilityValue(Fixture.webData)
            }
        }
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

/// An instance whose sync is never reachable, as on a phone with no network, refuses the token
/// when `refusesSync`, or lands with nothing new when `answersSync`, but that still answers a
/// sign-in, so a test can sign out and back in as the same person. It speaks contract version
/// `api`; nil, its version check is never answered.
private nonisolated struct FixtureClient: HTTPClient {
    /// Read by the probe: a test counts the version checks.
    static let versionChecks = Mutex(0)
    let refusesSync: Bool
    let answersSync: Bool
    let api: Int?
    let loops: FixtureLoops

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        if let url = request.url, url.path().hasPrefix("/media/exercises/") {
            let (data, status) = try await loops.answer(url.path())
            // As the instance types it: only an mp4 is kept.
            guard let response = HTTPURLResponse(
                url: url, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "video/mp4"])
            else { throw URLError(.badURL) }
            return (data, response)
        }
        let answer: String
        var status = 200
        if request.url?.path() == "/api/instance" { Self.versionChecks.withLock { $0 += 1 } }
        switch request.url?.path() {
        case "/api/sync" where refusesSync:
            answer = "{}"
            status = 401
        case "/api/sync" where answersSync:
            answer = #"{"cursor":"fixture","workouts":[],"sets":[],"activities":[],"rejected":[],"hasMore":false}"#
        case "/api/instance":
            guard let api else { throw URLError(.timedOut) }
            answer = #"{"app":"belay","api":\#(api),"origin":"\#(Fixture.origin)"}"#
        case "/auth/native/token": answer = #"{"token":"fixture-token"}"#
        case "/api/me": answer = #"{"id":"\#(Fixture.userId)","displayName":"Ada","media":true}"#
        case "/auth/logout": answer = "{}"
        default: throw URLError(.notConnectedToInternet)
        }
        guard let url = request.url,
              let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: nil, headerFields: nil)
        else { throw URLError(.badURL) }
        return (Data(answer.utf8), response)
    }
}

/// The fixture instance's loops: what each request gets, and how many times each path was asked.
nonisolated final class FixtureLoops: Sendable {
    /// Read by the probe: a test counts the requests for the bench press's loop.
    static let asked = Mutex<[String: Int]>([:])
    private let mode: String

    init(mode: String) { self.mode = mode }

    func answer(_ path: String) async throws -> (Data, Int) {
        let asked = Self.asked.withLock { asked in
            asked[path, default: 0] += 1
            return asked[path, default: 0]
        }
        if mode == "loopLoading" { try await Task.sleep(for: .seconds(3_600)) }
        try await Task.sleep(for: .seconds(3))
        if mode == "loopOffline", asked == 1 { throw URLError(.notConnectedToInternet) }
        if mode == "loopFailed" { return (Data(), 404) }
        if mode == "loopBroken" { return (Data("not a video".utf8), 200) }
        return (try await Self.video.value, 200)
    }

    /// Made once per launch, however many rows ask at once.
    private static let video = Task { try await make() }

    /// Eight frames of a square fading from grey to ink.
    private static func make() async throws -> Data {
        let url = FileManager.default.temporaryDirectory.appending(path: "fixture-loop.mp4")
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        let side = 96
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(
            mediaType: .video,
            outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: side, AVVideoHeightKey: side])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                kCVPixelBufferWidthKey as String: side, kCVPixelBufferHeightKey as String: side,
            ])
        writer.add(input)
        writer.startWriting()
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<8 {
            while !input.isReadyForMoreMediaData { try await Task.sleep(for: .milliseconds(10)) }
            var buffer: CVPixelBuffer?
            CVPixelBufferCreate(nil, side, side, kCVPixelFormatType_32BGRA, nil, &buffer)
            guard let buffer else { throw URLError(.cannotCreateFile) }
            CVPixelBufferLockBaseAddress(buffer, [])
            let shade = UInt8(200 - frame * 20)
            memset(CVPixelBufferGetBaseAddress(buffer), Int32(shade), CVPixelBufferGetDataSize(buffer))
            CVPixelBufferUnlockBaseAddress(buffer, [])
            adaptor.append(buffer, withPresentationTime: CMTime(value: CMTimeValue(frame), timescale: 4))
        }
        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else { throw writer.error ?? URLError(.cannotCreateFile) }
        return try Data(contentsOf: url)
    }
}

/// Health as `-BelayHealth` says it answers: allowed, it takes every write and holds one weigh-in
/// from a scale, this morning at 79,9 kg; refused, it lets Belay write nothing and reads as empty,
/// as iOS answers a refused read.
private nonisolated struct FixtureHealth: HealthWriting {
    let allowed: Bool

    func access() async -> HealthAccess {
        let permission: HealthPermission = allowed ? .allowed : .denied
        return HealthAccess(available: true, workouts: permission, effort: permission, weighIns: permission)
    }

    func authorize() async throws {}

    func save(_ w: HealthObject, syncId: String) async -> HealthOutcome { allowed ? .written : .denied }

    func delete(syncId: String) async -> HealthOutcome { allowed ? .removed : .denied }

    func overlaps(startedAt: Int64, endedAt: Int64) async -> Bool { false }

    func relateEffort(score: Int, syncId: String, effortSyncId: String) async -> HealthOutcome {
        allowed ? .written : .denied
    }

    func saveWeighIn(kg: Double, at: Int64, syncId: String, version: Int64) async -> HealthOutcome {
        allowed ? .written : .denied
    }

    func deleteWeighIn(syncId: String) async -> HealthOutcome { allowed ? .removed : .denied }

    func readWeighIns(anchor: String?, since: Int64) async -> (samples: [HealthSample], anchor: String)? {
        let now = Fixture.now
        let morning = Calendar.current.startOfDay(for: now).addingTimeInterval(7 * 3_600)
        let sample = HealthSample(startedAt: Int64(min(morning, now).timeIntervalSince1970 * 1_000), kg: 79.9)
        return (allowed && anchor == nil ? [sample] : [], "fixture-health")
    }

    /// Allowed, today holds 8 437 steps and the days before none; refused, iOS answers as an empty
    /// Health.
    func readDaySteps(days: [String], timeZone: TimeZone) async -> [String: Double?]? {
        let today = toISODate(Fixture.now, timeZone: timeZone)
        return Dictionary(uniqueKeysWithValues: days.map { ($0, allowed && $0 == today ? 8_437 : nil) })
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
