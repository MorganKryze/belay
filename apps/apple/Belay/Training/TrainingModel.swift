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
    /// A warm-up counts among the exercise's warm-ups instead, and is named « Montée ».
    let warmup: Bool
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

/// Last time's sets at one load: « 62,5 kg × 8, 8 ».
struct LoadGroup: Equatable {
    let weightKg: Double
    let counts: [Int]
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
    /// What the cover shows of the open session now, read from the store by the core's rule.
    private(set) var session: SessionState?
    /// What the cover remembers of its own, which the core's rule reads with the store.
    private(set) var marks = SessionMarks()
    /// The session just finished here, until the person closes its summary.
    private(set) var summary: SessionSummary?

    private let store: AccountStore
    /// Every write to the open session goes through these, each one transaction of the store.
    private let actions: SessionActions
    private let didWrite: () -> Void
    private let now: @Sendable () -> Date
    private let timeZone: TimeZone
    @ObservationIgnored private var watch: Task<Void, Never>?
    /// Wakes the cover at its next moment: a rest's end, a hold's end, the recap's turn.
    @ObservationIgnored private var wake: Task<Void, Never>?
    @ObservationIgnored private var last: Snapshot?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "training")

    init(store: AccountStore, didWrite: @escaping () -> Void, now: @escaping @Sendable () -> Date, timeZone: TimeZone) {
        self.store = store
        actions = SessionActions(store: store, library: BundledLibrary.library, now: now, newId: UUIDv7.make)
        self.didWrite = didWrite
        self.now = now
        self.timeZone = timeZone
        // Read once now, so the first frame already shows the card; then follow every write.
        refresh()
        settleEndedEfforts(except: nil)
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
        wake?.cancel()
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
        BundledLibrary.library.exercise(id)?.name ?? id
    }

    /// Runs one action on the open session, then lets the sync know and reads the store again, so
    /// the cover shows the write once it returns, and only then.
    func act(_ action: (SessionActions) throws -> Void) throws {
        try action(actions)
        didWrite()
        refresh()
    }

    /// The RIR given for a set during its rest or its recap, remembered for the recap's turn.
    func answerRIR(setId: String, rir: Int) throws {
        try act { try $0.answerRIR(setId: setId, rir: rir) }
        mark { $0.rirAnsweredAt = now() }
    }

    /// Changes what the cover remembers (VoiceOver, a tap on the recap) and reads the state again.
    func mark(_ change: (inout SessionMarks) -> Void) {
        var marks = self.marks
        change(&marks)
        guard marks != self.marks else { return }
        self.marks = marks
        recompute()
    }

    /// The exercise's sets last time, grouped by load: « 62,5 kg × 8, 8, 7, 6 ».
    func lastTime(exerciseId: String, timed: Bool) -> [LoadGroup] {
        guard let history = last?.history else { return [] }
        return BelayCore.lastTime(history, exerciseId: exerciseId, measure: timed ? .seconds : nil)
            .map { LoadGroup(weightKg: $0.weightKg, counts: $0.counts) }
    }

    /// When the open session's latest set was done: where the rest after it starts.
    var restFrom: Date? {
        guard let workoutId = session?.workoutId else { return nil }
        return last?.history.sets.filter { $0.workoutId == workoutId && !$0.removed }
            .compactMap { Instant.date($0.doneAt) }.max()
    }

    /// The plan's RIR target for a slot of the open session.
    func rirTarget(slotIndex: Int) -> [Int] {
        guard let workoutId = session?.workoutId,
              let plan = last?.history.workouts.first(where: { $0.id == workoutId })?.plan,
              plan.indices.contains(slotIndex)
        else { return [] }
        return plan[slotIndex].rirTarget
    }

    /// Ends the open session now, as the web does, and keeps its summary for the cover.
    func finish() throws {
        let id = try actions.finish()
        didWrite()
        let history = try store.history()
        if let workout = history.workouts.first(where: { $0.id == id }) {
            summary = summarize(workout, history: history, endedAt: workout.endedAt.flatMap(Instant.date) ?? now())
        }
        settleEndedEfforts(except: id)
        refresh()
    }

    /// Drops the open session while it holds no set: nothing of it is kept.
    func stopEmpty() throws {
        try act { try $0.stopEmpty() }
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
        var unwritten: (any Error)?
        if written != left.note {
            do {
                try store.recordChanges(
                    [.workout(WorkoutChange(id: left.workoutId, at: Instant.string(now()), edit: .note(written)))],
                    active: .keep)
                didWrite()
            } catch {
                unwritten = error
            }
        }
        // Settled even when the note was not written: the floor given does not depend on it.
        try store.settleEffort(workoutId: left.workoutId)
        if let unwritten { throw unwritten }
        summary = nil
    }

    /// A summary the app's end, or a failed write, closed without settling its effort: no screen
    /// will show it again, so its effort is settled as it stands.
    private func settleEndedEfforts(except workoutId: String?) {
        do {
            try store.settleEndedEfforts(except: workoutId)
        } catch {
            Self.log.error("efforts not settled: \(AccountStore.logLabel(error), privacy: .public)")
        }
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

    /// Reads the store now, without waiting for its next observed value.
    func refresh() {
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
        last = snapshot
        if let workout = openWorkout(snapshot.history.workouts, forgotten: (sets, at)) {
            let own = sets.filter { $0.workoutId == workout.id && !$0.removed }
            let due = snapshot.active.flatMap { active in
                active.workoutId == workout.id
                    ? dueSet(history: snapshot.history, workout: workout, active: active, library: BundledLibrary.library, bar: .gym)
                    : nil
            }
            open = OpenSession(
                workoutId: workout.id, code: workout.sessionCode, name: workout.sessionName.value,
                startedAt: Instant.date(workout.startedAt) ?? at, setsPlanned: plannedWorkSets(workout.plan),
                setsDone: sessionProgress(workout.plan, sets: own).done.count,
                current: due.map { set in
                    CurrentSet(
                        exercise: exerciseName(set.exerciseId), number: set.number, of: set.of, warmup: set.warmup,
                        timed: set.timed,
                        weightKg: set.weightKg, count: set.count)
                })
        } else {
            open = nil
        }
        recompute()
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
                        lastTime: BelayCore.lastTime(snapshot.history, exerciseId: slot.exerciseId, measure: measure)
                            .map { LoadGroup(weightKg: $0.weightKg, counts: $0.counts) })
                })
        }
    }

    /// The cover's state at this moment. The recap's marks are set as it shows and cleared once a
    /// set is due again; the next moment the state changes by itself wakes this again.
    private func recompute() {
        wake?.cancel()
        guard let snapshot = last, let open, let active = snapshot.active, active.workoutId == open.workoutId else {
            session = nil
            return
        }
        let at = now()
        func read() -> SessionState {
            sessionState(history: snapshot.history, active: active, now: at, library: BundledLibrary.library, bar: .gym, marks: marks)
        }
        var state = read()
        switch state.phase {
        case .recap where marks.recapShownAt == nil:
            marks.recapShownAt = at
            state = read()
        case .due, .holding, .held:
            if marks != SessionMarks(voiceOver: marks.voiceOver) {
                marks = SessionMarks(voiceOver: marks.voiceOver)
                state = read()
            }
        default: break
        }
        if session != state { session = state }
        let restEnd = active.restEndsAt.flatMap(Instant.date)
        guard let next = Self.nextMoment(state, marks: marks, restEnd: restEnd, after: at) else { return }
        wake = Task { [weak self] in
            try? await Task.sleep(for: .seconds(next.timeIntervalSince(at)))
            guard !Task.isCancelled else { return }
            self?.recompute()
        }
    }

    /// When the state turns by itself: a rest or a hold ends, the recap gives way.
    private static func nextMoment(_ state: SessionState, marks: SessionMarks, restEnd: Date?, after at: Date)
        -> Date?
    {
        // A rest that ends under the recap shows the next set directly.
        var moments: [Date] = restEnd.map { [$0] } ?? []
        switch state.phase {
        case .resting(let rest): moments.append(rest.endsAt)
        case .announce(let announce): moments.append(announce.restEndsAt)
        case .holding(let hold): moments.append(hold.endsAt)
        default: break
        }
        if let shown = marks.recapShownAt { moments.append(shown + 2.6) }
        if let answered = marks.rirAnsweredAt { moments.append(answered + 0.9) }
        return moments.filter { $0 > at }.min()
    }
}

private extension AccountStore {
    /// The snapshot outside an observation, for the first frame and right after a write.
    func read() throws -> Snapshot {
        Snapshot(
            history: try history(), programs: try programs(), activities: try activities(),
            active: try activeSession())
    }
}
