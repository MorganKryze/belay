import BelayCore
import Foundation
import os

/// The session the schedule offers next, as Accueil's card shows it.
struct NextSession: Equatable {
    let sessionId: String?
    let code: String
    let name: String?
    /// The slots of the day's plan, the no-climbing ones included when the week asks for them.
    let exercises: Int
    let minutes: Int
}

/// The session open on this phone, or on another device, as the card and the accessory show it.
struct OpenSession: Equatable {
    let workoutId: String
    let code: String
    let name: String?
    let startedAt: Date
    /// The plan's work sets, and how many of them are done.
    let setsPlanned: Int
    let setsDone: Int
}

/// Why a session did not start.
enum TrainingError: Error {
    /// No active program, or one with no session that can be started.
    case nothingToStart
}

/// What the store holds that the session screens read.
private nonisolated struct Snapshot: Sendable {
    let history: History
    let programs: StoredPrograms
    let activities: [ActivityRow]
}

/// The session screens' view of the account's store: the next session, the open one, and the
/// start. It follows the store, so a write from anywhere (a sync, another screen) shows here.
@MainActor @Observable
final class TrainingModel {
    private(set) var next: NextSession?
    private(set) var open: OpenSession?

    private let store: AccountStore
    private let didWrite: () -> Void
    private let now: () -> Date
    private let timeZone: TimeZone
    @ObservationIgnored private var watch: Task<Void, Never>?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "training")

    init(store: AccountStore, didWrite: @escaping () -> Void, now: @escaping () -> Date, timeZone: TimeZone) {
        self.store = store
        self.didWrite = didWrite
        self.now = now
        self.timeZone = timeZone
        // Read once now, so the first frame already shows the card; then follow every write.
        refresh()
        watch = Task { [weak self, store] in
            do {
                let snapshots = store.observe { db in
                    Snapshot(
                        history: try AccountStore.history(db), programs: try AccountStore.programs(db),
                        activities: try AccountStore.activities(db))
                }
                for try await snapshot in snapshots { self?.show(snapshot) }
            } catch {
                Self.log.error("store not followed: \(AccountStore.logLabel(error), privacy: .public)")
            }
        }
    }

    isolated deinit {
        watch?.cancel()
    }

    /// Starts the next session, or takes up the one already open, here or elsewhere; its id.
    func start() throws -> String {
        let snapshot = try store.read()
        let at = now()
        guard let template = template(snapshot, at: at) else { throw TrainingError.nothingToStart }
        let plan = planFor(template, activities: snapshot.activities, date: toISODate(at, timeZone: timeZone))
        let time = Instant.string(at)
        // The store writes the session's name as it stands now, so the name here is a placeholder.
        let asked = WorkoutStart(
            id: UUIDv7.make(at: at), at: time,
            start: .init(
                sessionCode: template.code, sessionId: .value(template.sessionId), sessionName: .null,
                plan: plan, startedAt: time))
        let id = try store.startWorkout(asked, now: at)
        didWrite()
        // At once, not at the next observed value: the cover opening now reads `open`.
        refresh()
        return id
    }

    /// The exercise's name, as the library holds it (English in both languages, as on the web);
    /// its id when this build's library does not know it.
    func exerciseName(_ id: String) -> String {
        Self.names[id] ?? id
    }

    private func refresh() {
        do {
            show(try store.read())
        } catch {
            Self.log.error("store not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    /// The session the schedule offers at `at`, where the person is.
    private func template(_ snapshot: Snapshot, at: Date) -> LetteredTemplate? {
        plannedNext(
            snapshot.history.workouts, programs: snapshot.programs, rotation: rotationOf(snapshot.programs),
            today: toISODate(at, timeZone: timeZone), timeZone: timeZone)
    }

    private func show(_ snapshot: Snapshot) {
        let at = now()
        let sets = snapshot.history.sets
        if let workout = openWorkout(snapshot.history.workouts, forgotten: (sets, at)) {
            let own = sets.filter { $0.workoutId == workout.id && !$0.removed }
            open = OpenSession(
                workoutId: workout.id, code: workout.sessionCode, name: workout.sessionName.value,
                startedAt: Instant.date(workout.startedAt) ?? at, setsPlanned: plannedWorkSets(workout.plan),
                setsDone: sessionProgress(workout.plan, sets: own).done.count)
        } else {
            open = nil
        }
        next = template(snapshot, at: at).map { template in
            let plan = planFor(template, activities: snapshot.activities, date: toISODate(at, timeZone: timeZone))
            return NextSession(
                sessionId: template.sessionId, code: template.code, name: template.name,
                exercises: plan.count, minutes: estimatedMinutes(plan))
        }
    }

    /// Exercise names by id, from the library bundled with the app.
    private static let names: [String: String] = {
        // The library ships inside the app; a build without it shows ids, and says so in the log.
        guard let url = Bundle.main.url(forResource: "index", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let rows = try? JSONSerialization.jsonObject(with: data) as? [[Any]]
        else {
            log.error("exercise library not read")
            return [:]
        }
        var names: [String: String] = [:]
        for row in rows {
            if row.count > 1, let id = row[0] as? String, let name = row[1] as? String { names[id] = name }
        }
        return names
    }()
}

private extension AccountStore {
    /// The snapshot outside an observation, for the first frame and right after a write.
    func read() throws -> Snapshot {
        Snapshot(history: try history(), programs: try programs(), activities: try activities())
    }
}
