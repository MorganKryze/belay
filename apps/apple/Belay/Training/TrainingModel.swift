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
    /// The live slots of that plan, as the preview lists them.
    let plan: [PlannedExercise]
}

/// One exercise of the next session, before it starts.
struct PlannedExercise: Equatable, Identifiable {
    let slotIndex: Int
    let name: String
    let sets: Int
    /// Seconds for a timed exercise; repetitions otherwise.
    let timed: Bool
    let repRange: [Int]
    /// Last time's work sets, the counts of equal loads in a row grouped.
    let lastTime: [LoadGroup]

    var id: Int { slotIndex }
}

/// The set up next in the open session, as the card and the accessory lead with it.
struct CurrentSet: Equatable {
    let exercise: String
    /// Its number among the exercise's work sets, from 1, and how many there are.
    let number: Int
    let of: Int
    let timed: Bool
    /// Nil when the person has to type it.
    let weightKg: Double?
    let count: Int?
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
    /// Nil once every planned set is done.
    let current: CurrentSet?
}

/// The open session as its cover shows it: each exercise of the plan with its work sets, and the
/// set up next by the shared turn rule.
struct CoverState: Equatable {
    let workoutId: String
    let code: String
    let name: String?
    let startedAt: Date
    let exercises: [CoverExercise]
    let next: Turn?
    let setsPlanned: Int
    let setsDone: Int
}

/// One exercise of the cover: a slot of the plan not skipped today.
struct CoverExercise: Equatable, Identifiable {
    let slotIndex: Int
    let exerciseId: String
    let name: String
    /// Seconds for a timed exercise; repetitions otherwise.
    let timed: Bool
    let repRange: [Int]
    let rirTarget: [Int]
    /// Last time's work sets, the counts of equal loads in a row grouped.
    let lastTime: [LoadGroup]
    let sets: [CoverSet]

    var id: Int { slotIndex }
}

/// Last time's sets at one load: « 62,5 kg × 8, 8 ».
struct LoadGroup: Equatable {
    let weightKg: Double
    let counts: [Int]
}

/// A work set of the cover: what was done, or what is offered for it.
struct CoverSet: Equatable, Identifiable {
    let slotIndex: Int
    let position: Int
    /// Its number among the slot's work sets, from 1.
    let number: Int
    let done: Bool
    /// Nil when nothing done before tells the load: the person types it.
    let weightKg: Double?
    let count: Int?
    let rir: Int?

    var id: String { "\(slotIndex)-\(position)" }
}

/// A session just finished, as its summary shows it.
struct SessionSummary: Equatable {
    struct Logged: Equatable, Identifiable {
        let slotIndex: Int
        let name: String
        let sets: Int
        let timed: Bool
        /// The set with the most load, then the highest count.
        let top: LoadGroup

        var id: Int { slotIndex }
    }

    /// A record of the session: the exercise and the set that beat every earlier session's.
    struct Record: Equatable, Identifiable {
        let name: String
        let load: Load

        var id: String { name }
    }

    let workoutId: String
    let code: String
    let name: String?
    /// The session's note as the summary opened on it.
    let note: String?
    /// The floor given here, 1 to 5, or none yet.
    var effort: Int?
    let endedAt: Date
    let duration: TimeInterval
    let workSets: Int
    let warmupSets: Int
    /// The work sets' kilograms times reps, warm-ups and timed sets left out.
    let volumeKg: Double
    let records: [Record]
    let exercises: [Logged]
}

/// Why a session did not start, or a set was not taken.
enum TrainingError: Error {
    /// No active program, or one with no session that can be started.
    case nothingToStart
    /// The set asked for is not a work set of the open session.
    case noSuchSet
}

/// What the store holds that the session screens read.
private nonisolated struct Snapshot: Sendable {
    let history: History
    let programs: StoredPrograms
    let activities: [ActivityRow]
    let active: ActiveSession?
}

/// The session screens' view of the account's store: the next session, the open one, and the
/// start. It follows the store, so a write from anywhere (a sync, another screen) shows here.
@MainActor @Observable
final class TrainingModel {
    private(set) var next: NextSession?
    private(set) var open: OpenSession?
    private(set) var cover: CoverState?
    /// When the rest after the last set ends, as the store holds it; it may be past.
    private(set) var restEnd: Date?
    /// When the open session's last set was done: where the rest after it starts.
    private(set) var restFrom: Date?
    /// The session just finished here, until the person closes its summary.
    private(set) var summary: SessionSummary?

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
                        activities: try AccountStore.activities(db), active: try AccountStore.activeSession(db))
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

    /// Records a work set of the open session, its change in the queue and the rest after it, in
    /// one write; the cover shows it done once that write returns.
    func tick(slotIndex: Int, position: Int, weightKg: Double, count: Int, rir: Int?) throws {
        let snapshot = try store.read()
        let at = now()
        let history = snapshot.history
        guard let workout = openWorkout(history.workouts, forgotten: (history.sets, at)),
              workout.plan.indices.contains(slotIndex)
        else { throw TrainingError.noSuchSet }
        let slot = workout.plan[slotIndex]
        let turn = Turn(slotIndex: slotIndex, round: position - Bounds.maxWarmups)
        guard turn.round >= 0, turn.round < slot.sets else { throw TrainingError.noSuchSet }
        let timed = slot.measure == .seconds
        let doneAt = Instant.string(at)
        let own = history.sets.filter { $0.workoutId == workout.id && !$0.removed }
        var done = sessionProgress(workout.plan, sets: own).done
        done.insert(turnKey(turn))
        let next = nextTurn(workout.plan, done: done, from: turn)
        let input = SetInput(
            id: UUIDv7.make(at: at), workoutId: workout.id, slotIndex: slotIndex, position: position,
            exerciseId: slot.exerciseId, warmup: false,
            values: SetValues(
                weightKg: weightKg, reps: timed ? nil : count, seconds: timed ? .value(count) : .null,
                rir: timed ? nil : rir),
            doneAt: doneAt)
        let active = ActiveSession(
            workoutId: workout.id, slotIndex: next?.slotIndex ?? slotIndex,
            restEndsAt: restEndsAt(workout.plan, done: done, after: turn, doneAt: doneAt))
        _ = try store.recordSet(input, at: doneAt, active: active)
        didWrite()
        refresh()
    }

    /// Moves the end of the open session's rest, or ends the rest with nil.
    func moveRest(to end: Date?) throws {
        guard let workoutId = open?.workoutId,
              try store.moveRest(of: workoutId, to: end.map(Instant.string))
        else { return }
        didWrite()
        refresh()
    }

    /// Ends the open session now, as the web does, and keeps its summary for the cover.
    func finish() throws {
        let snapshot = try store.read()
        let at = now()
        let history = snapshot.history
        guard let workout = openWorkout(history.workouts, forgotten: (history.sets, at)) else { return }
        let time = Instant.string(at)
        try store.recordChanges(
            [.workout(WorkoutChange(id: workout.id, at: time, edit: .ended(time)))], active: .clear)
        didWrite()
        var ended = workout
        ended.endedAt = time
        summary = summarize(ended, history: history, endedAt: at)
        refresh()
    }

    /// Removes the open session as the web's « Supprimer la séance » does: one change, its sets
    /// going with it, queued in the write that forgets it as this device's open session.
    func delete() throws {
        let snapshot = try store.read()
        let at = now()
        guard let workout = openWorkout(snapshot.history.workouts, forgotten: (snapshot.history.sets, at)) else { return }
        let time = Instant.string(at)
        try store.recordChanges([.workout(WorkoutChange(id: workout.id, at: time, edit: .removed(true)))], active: .clear)
        didWrite()
        refresh()
    }

    /// The floor given on the summary, or none: kept on this phone at once, never queued.
    func giveEffort(_ floor: Int?) throws {
        guard let workoutId = summary?.workoutId else { return }
        try store.giveEffort(workoutId: workoutId, floor: floor)
        summary?.effort = floor
    }

    /// The summary is left: its note, when changed, is written and queued, and the effort, given
    /// or not, is settled. Only then is the summary let go, so a write that fails keeps it, and the
    /// note typed, on screen.
    func closeSummary(note: String) throws {
        guard let left = summary else { return }
        let trimmed = fitNote(note.trimmingCharacters(in: .whitespacesAndNewlines))
        let written: String? = trimmed.isEmpty ? nil : trimmed
        if written != left.note {
            try store.recordChanges(
                [.workout(WorkoutChange(id: left.workoutId, at: Instant.string(now()), edit: .note(written)))],
                active: .keep)
            didWrite()
        }
        try store.settleEffort(workoutId: left.workoutId)
        summary = nil
    }

    /// The shared summary rule's figures, read against the history the session ends in.
    private func summarize(_ workout: WorkoutRow, history: History, endedAt: Date) -> SessionSummary {
        let sets = history.sets
        let totals = BelayCore.summary(workout, sets: liveSets(history), history: history)
        let work = sets.filter { $0.workoutId == workout.id && !$0.removed && !$0.warmup }
        let logged = workout.plan.indices.compactMap { index -> SessionSummary.Logged? in
            let own = work.filter { $0.slotIndex == index }
            let top = own.max { ($0.weightKg, countOf($0)) < ($1.weightKg, countOf($1)) }
            guard let top else { return nil }
            return SessionSummary.Logged(
                slotIndex: index, name: exerciseName(top.exerciseId), sets: own.count,
                timed: measureOfSet(top) == .seconds, top: LoadGroup(weightKg: top.weightKg, counts: [countOf(top)]))
        }
        let started = Instant.date(workout.startedAt) ?? endedAt
        return SessionSummary(
            workoutId: workout.id, code: workout.sessionCode, name: workout.sessionName.value, note: workout.note,
            effort: nil, endedAt: endedAt,
            duration: max(0, endedAt.timeIntervalSince(started)), workSets: work.count,
            warmupSets: totals.warmupSets, volumeKg: totals.volumeKg,
            records: totals.records.map { .init(name: exerciseName($0.exerciseId), load: $0.load) },
            exercises: logged)
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
            let cover = coverOf(workout, sets: own, history: snapshot.history)
            open = OpenSession(
                workoutId: workout.id, code: workout.sessionCode, name: workout.sessionName.value,
                startedAt: Instant.date(workout.startedAt) ?? at, setsPlanned: cover.setsPlanned,
                setsDone: cover.setsDone, current: Self.current(cover))
            self.cover = cover
            restEnd = snapshot.active.flatMap { $0.workoutId == workout.id ? $0.restEndsAt : nil }
                .flatMap(Instant.date)
            restFrom = own.compactMap { Instant.date($0.doneAt) }.max()
        } else {
            open = nil
            cover = nil
            restEnd = nil
            restFrom = nil
        }
        next = template(snapshot, at: at).map { template in
            let plan = planFor(template, activities: snapshot.activities, date: toISODate(at, timeZone: timeZone))
            return NextSession(
                sessionId: template.sessionId, code: template.code, name: template.name,
                exercises: plan.count, minutes: estimatedMinutes(plan),
                plan: liveSlots(plan).map { index in
                    let slot = plan[index]
                    let measure: Measure? = slot.measure == .seconds ? .seconds : nil
                    return PlannedExercise(
                        slotIndex: index, name: exerciseName(slot.exerciseId), sets: slot.sets,
                        timed: measure != nil, repRange: slot.repRange,
                        lastTime: lastTime(snapshot.history, exerciseId: slot.exerciseId, measure: measure)
                            .map { LoadGroup(weightKg: $0.weightKg, counts: $0.counts) })
                })
        }
    }

    /// The set the turn rule offers next, with what the cover offers for it.
    private static func current(_ cover: CoverState) -> CurrentSet? {
        guard let turn = cover.next,
              let exercise = cover.exercises.first(where: { $0.slotIndex == turn.slotIndex }),
              exercise.sets.indices.contains(turn.round)
        else { return nil }
        let set = exercise.sets[turn.round]
        return CurrentSet(
            exercise: exercise.name, number: set.number, of: exercise.sets.count, timed: exercise.timed,
            weightKg: set.weightKg, count: set.count)
    }

    /// The plan's live slots with their work sets: a done set as it was logged; one to do with last
    /// time's same set, else the set just done before it here, else the plan's low count.
    private func coverOf(_ workout: WorkoutRow, sets own: [SetRow], history: History) -> CoverState {
        let plan = workout.plan
        let progress = sessionProgress(plan, sets: own)
        let exercises = liveSlots(plan).map { index in
            let slot = plan[index]
            let timed = slot.measure == .seconds
            let measure: Measure? = timed ? .seconds : nil
            let work = own.filter { !$0.warmup && $0.slotIndex == index }
            var before: SetRow?
            let rows = (0..<slot.sets).map { round in
                let position = Bounds.maxWarmups + round
                if let set = work.first(where: { $0.position == position }) {
                    before = set
                    return CoverSet(
                        slotIndex: index, position: position, number: round + 1, done: true,
                        weightKg: set.weightKg, count: countOf(set), rir: set.rir)
                }
                let offered = prefill(history, exerciseId: slot.exerciseId, setIndex: round, measure: measure)
                    ?? before.map { Load(weightKg: $0.weightKg, reps: $0.reps, seconds: $0.seconds) }
                // With nothing done before, a timed hold starts with no added load; a load is typed.
                return CoverSet(
                    slotIndex: index, position: position, number: round + 1, done: false,
                    weightKg: offered?.weightKg ?? (timed ? 0 : nil),
                    count: offered.map { $0.seconds ?? $0.reps ?? slot.repRange[0] } ?? slot.repRange.first,
                    rir: slot.rirTarget.first)
            }
            return CoverExercise(
                slotIndex: index, exerciseId: slot.exerciseId, name: exerciseName(slot.exerciseId),
                timed: timed, repRange: slot.repRange, rirTarget: slot.rirTarget,
                lastTime: lastTime(history, exerciseId: slot.exerciseId, measure: measure)
                    .map { LoadGroup(weightKg: $0.weightKg, counts: $0.counts) },
                sets: rows)
        }
        return CoverState(
            workoutId: workout.id, code: workout.sessionCode, name: workout.sessionName.value,
            startedAt: Instant.date(workout.startedAt) ?? now(), exercises: exercises, next: progress.next,
            setsPlanned: plannedWorkSets(plan), setsDone: progress.done.count)
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
        Snapshot(
            history: try history(), programs: try programs(), activities: try activities(),
            active: try activeSession())
    }
}
