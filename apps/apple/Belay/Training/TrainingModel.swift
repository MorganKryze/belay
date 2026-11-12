import BelayCore
import Foundation
import os

/// A session of the active program as it would start today, as Accueil's card and its preview
/// show it.
struct NextSession: Equatable {
    let sessionId: String?
    let code: String
    let name: String?
    /// The slots of the day's plan, the no-climbing ones included when the week asks for them.
    let exercises: Int
    /// The plan's work sets.
    let sets: Int
    let minutes: Int
    /// When it was last kept and how long it lasted; nil the first time.
    let last: LastKept?
    /// The live slots of that plan, as the preview lists them.
    let plan: [PlannedExercise]
}

/// The last time a session was kept: the day it started and its length.
struct LastKept: Equatable {
    let startedAt: Date
    let durationMs: Int
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

/// One exercise of the open session, as the programme lists it.
struct ProgrammeExercise: Equatable, Identifiable {
    /// A set of the exercise: done, up next, or to come.
    struct Row: Equatable, Identifiable {
        let place: SetPlace
        let warmup: Bool
        /// Its number among the warm-ups or among the work sets, from 1.
        let number: Int
        /// Past the plan.
        let added: Bool
        let state: BarState
        /// What was logged, or what ✓ would log for the set up next; nil for a set to come.
        let weightKg: Double?
        let count: Int?

        var id: String { "\(place.slotIndex)-\(place.position)" }
    }

    let slotIndex: Int
    let exerciseId: String
    let skipped: Bool
    let note: String?
    let timed: Bool
    let target: [Int]
    let rows: [Row]

    var id: Int { slotIndex }
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
    let efforts: [SessionEffort]
}

/// A live program as the program sheet lists it: its name and how many sessions it rotates.
struct ProgramChoice: Equatable, Identifiable {
    let id: String
    /// Nil for a program the person never named.
    let name: String?
    let starter: Bool
    let sessions: Int
}

/// The session screens' view of the account's store: the program's sessions, the open one, and
/// the start. It follows the store, so a write from anywhere (a sync, another screen) shows here.
@MainActor @Observable
final class TrainingModel {
    private(set) var open: OpenSession?
    /// What the cover shows of the open session now, read from the store by the core's rule.
    private(set) var session: SessionState?
    /// What the cover remembers of its own, which the core's rule reads with the store.
    private(set) var marks = SessionMarks()
    /// The session just finished here, until the person closes its summary.
    private(set) var summary: SessionSummary?
    /// The open session's whole plan, as its programme lists it.
    private(set) var programme: [ProgrammeExercise] = []
    /// What Accueil shows for the day, decided by the core's rule.
    private(set) var accueil: AccueilState?
    /// What Séances' Programme segment shows, decided by the core's rule.
    private(set) var programmeState: ProgrammeState?
    /// Séances' Historique: the sessions kept, by week, newest first.
    private(set) var weeks: [HistoryWeek] = []
    /// Every session of the active program as it would start today, in the rotation's order.
    private(set) var sessions: [NextSession] = []
    /// The moment the day was last read, so the screens name the day it was read for.
    private(set) var readAt: Date
    /// The live programs in the shared order, and the active one.
    private(set) var programs: [ProgramChoice] = []
    private(set) var activeProgramId: String?

    private let store: AccountStore
    /// Every write to the open session goes through these, each one transaction of the store.
    private let actions: SessionActions
    /// The writes outside a session: the active program, a past session.
    private let history: HistoryActions
    private let didWrite: () -> Void
    /// Told when Health may have something new: a session finished, a summary left.
    private let health: () -> Void
    private let now: @Sendable () -> Date
    private let timeZone: TimeZone
    @ObservationIgnored private var watch: Task<Void, Never>?
    /// Wakes the cover at its next moment: a rest's end, a hold's end, the recap's turn.
    @ObservationIgnored private var wake: Task<Void, Never>?
    @ObservationIgnored private var last: Snapshot?
    /// Reads the day again at each local midnight, while the app is on screen.
    @ObservationIgnored private var midnight: Task<Void, Never>?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "training")

    init(
        store: AccountStore, didWrite: @escaping () -> Void, health: @escaping () -> Void = {},
        now: @escaping @Sendable () -> Date, timeZone: TimeZone
    ) {
        self.store = store
        actions = SessionActions(store: store, library: BundledLibrary.library, now: now, newId: UUIDv7.make)
        history = HistoryActions(store: store, now: now)
        readAt = now()
        self.didWrite = didWrite
        self.health = health
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
                        activities: try AccountStore.activities(db), active: try AccountStore.activeSession(db),
                        efforts: try AccountStore.efforts(db))
                }
                for try await snapshot in snapshots { self?.show(snapshot) }
            } catch {
                Self.log.error("store not followed: \(AccountStore.logLabel(error), privacy: .public)")
            }
        }
        midnight = Task { [weak self, now, timeZone] in
            while !Task.isCancelled {
                var calendar = Calendar(identifier: .gregorian)
                calendar.timeZone = timeZone
                let at = now()
                let next = calendar.nextDate(
                    after: at, matching: DateComponents(hour: 0, minute: 0, second: 0), matchingPolicy: .nextTime)
                // A second past midnight, so the day read is surely the new one.
                let wait = (next ?? at.addingTimeInterval(3_600)).timeIntervalSince(at) + 1
                try? await Task.sleep(for: .seconds(wait))
                guard !Task.isCancelled else { return }
                self?.refresh()
            }
        }
    }

    isolated deinit {
        watch?.cancel()
        wake?.cancel()
        midnight?.cancel()
    }

    /// Makes a live program the active one, as one change sent on the next sync.
    func chooseProgram(_ programId: String) throws {
        try history.chooseProgram(programId)
        didWrite()
        refresh()
    }

    /// Starts the next session, or takes up the one already open, here or elsewhere; its id.
    func start() throws -> String {
        let snapshot = try store.read()
        guard let template = template(snapshot, at: now()) else { throw TrainingError.nothingToStart }
        return try start(template, snapshot: snapshot)
    }

    /// Starts a session of the active program, in turn or not, with today's plan for it; or takes
    /// up the one already open, here or elsewhere, so there is never a second. Its id.
    func start(sessionId: String) throws -> String {
        let snapshot = try store.read()
        guard let template = rotationOf(snapshot.programs).first(where: { $0.sessionId == sessionId }) else {
            throw TrainingError.nothingToStart
        }
        return try start(template, snapshot: snapshot)
    }

    /// A session of the active program as it would start today, or nil when it is not one.
    func preview(_ sessionId: String) -> NextSession? {
        sessions.first { $0.sessionId == sessionId }
    }

    private func start(_ template: LetteredTemplate, snapshot: Snapshot) throws -> String {
        let at = now()
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

    /// The open session's whole plan as stored now: each exercise with its sets.
    private func readProgramme() -> [ProgrammeExercise] {
        guard let state = session, let snapshot = last,
              let workout = snapshot.history.workouts.first(where: { $0.id == state.workoutId })
        else { return [] }
        let sets = snapshot.history.sets.filter { $0.workoutId == workout.id && !$0.removed }
        let due: DueSet? =
            switch state.phase {
            case .due(let due): due
            case .holding(let hold): hold.due
            case .held(let held): held.due
            case .resting(let rest): rest.next
            case .announce(let announce): announce.next
            default: nil
            }
        let added = snapshot.active?.added
        return workout.plan.enumerated().map { index, slot in
            let own = sets.filter { $0.slotIndex == index }
            let warmups = own.filter(\.warmup).sorted { $0.position < $1.position }
            var rows = warmups.enumerated().map { i, set in
                ProgrammeExercise.Row(
                    place: SetPlace(slotIndex: index, position: set.position), warmup: true, number: i + 1, added: false,
                    state: .done, weightKg: set.weightKg, count: countOf(set))
            }
            if let due, due.warmup, due.place.slotIndex == index {
                rows.append(
                    .init(
                        place: due.place, warmup: true, number: warmups.count + 1, added: false, state: .current,
                        weightKg: due.weightKg, count: due.count))
            }
            let planned = Bounds.maxWarmups + slot.sets - 1
            let last = ([planned] + own.filter { !$0.warmup }.map(\.position)
                + [added, due?.place].compactMap { $0?.slotIndex == index ? $0?.position : nil }).max() ?? planned
            for position in Bounds.maxWarmups...max(planned, last) {
                let place = SetPlace(slotIndex: index, position: position)
                let done = own.first { !$0.warmup && $0.position == position }
                let next = due.map { !$0.warmup && $0.place == place } ?? false
                // A set past the plan shows once it is done or asked for.
                if position > planned, done == nil, !next, added != place { continue }
                rows.append(
                    .init(
                        place: place, warmup: false, number: position - Bounds.maxWarmups + 1, added: position > planned,
                        state: done != nil ? .done : next ? .current : .toCome,
                        weightKg: done?.weightKg ?? (next ? due?.weightKg : nil),
                        count: done.map(countOf) ?? (next ? due?.count : nil)))
            }
            return ProgrammeExercise(
                slotIndex: index, exerciseId: slot.exerciseId, skipped: slot.skipped == true,
                note: workout.exerciseNotes[String(index)], timed: slot.measure == .seconds, target: slot.repRange,
                rows: rows)
        }
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
        health()
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
        // The effort is settled now, so Health can take it, whatever became of the note.
        health()
        if let unwritten { throw unwritten }
        summary = nil
    }

    /// Whether Health holds the workout of `workoutId`, now and after each change of the record.
    func heldInHealth(_ workoutId: String) -> AsyncThrowingStream<Bool, any Error> {
        store.observe { db in
            if case .workout = try AccountStore.healthWritten(db, key: sessionKey(workoutId)) { true } else { false }
        }
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
        readAt = at
        let state = accueilState(
            history: snapshot.history, programs: snapshot.programs, activities: snapshot.activities,
            efforts: snapshot.efforts, now: at, timeZone: timeZone)
        if accueil != state { accueil = state }
        let choices = programOrder(snapshot.programs).map { program in
            var alone = snapshot.programs
            alone.activeId = program.id
            return ProgramChoice(
                id: program.id, name: program.name, starter: program.id == Seed.programs.activeId,
                sessions: rotationOf(alone).count)
        }
        if programs != choices { programs = choices }
        let active = snapshot.programs.programs.contains { $0.id == snapshot.programs.activeId && !$0.removed }
            ? snapshot.programs.activeId : nil
        if activeProgramId != active { activeProgramId = active }
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
        let programme = BelayCore.programmeState(
            history: snapshot.history, programs: snapshot.programs, activities: snapshot.activities, now: at,
            timeZone: timeZone)
        if programmeState != programme { programmeState = programme }
        let kept = historyWeeks(snapshot.history, efforts: snapshot.efforts, now: at, timeZone: timeZone)
        if weeks != kept { weeks = kept }
        let described = rotationOf(snapshot.programs).map { describe($0, snapshot: snapshot, at: at) }
        if sessions != described { sessions = described }
    }

    /// A session as it would start at `at`: today's plan for it, each exercise's last time, and
    /// when it was last kept.
    private func describe(_ template: LetteredTemplate, snapshot: Snapshot, at: Date) -> NextSession {
        let plan = planFor(template, activities: snapshot.activities, date: toISODate(at, timeZone: timeZone))
        let last = lastFinished(snapshot.history.workouts, session: template).flatMap { workout -> LastKept? in
            guard let started = Instant.date(workout.startedAt) else { return nil }
            let ended = workout.endedAt.flatMap(Instant.date) ?? started
            return LastKept(startedAt: started, durationMs: Int(ended.timeIntervalSince(started) * 1_000))
        }
        return NextSession(
            sessionId: template.sessionId, code: template.code, name: template.name,
            exercises: plan.count, sets: plannedWorkSets(plan), minutes: estimatedMinutes(plan), last: last,
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

    /// The cover's state at this moment. The recap's marks are set as it shows and cleared once a
    /// set is due again; the next moment the state changes by itself wakes this again.
    private func recompute() {
        wake?.cancel()
        guard let snapshot = last, let open, let active = snapshot.active, active.workoutId == open.workoutId else {
            session = nil
            programme = []
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
        let plan = readProgramme()
        if programme != plan { programme = plan }
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

/// The cover's correction sheet writes through the open session's actions.
extension TrainingModel: SetCorrecting {
    func correct(setId: String, weightKg: Double, count: Int, rir: Int?) throws {
        try act { try $0.correct(setId: setId, weightKg: weightKg, count: count, rir: rir) }
    }

    func remove(setId: String) throws {
        try act { try $0.remove(setId: setId) }
    }
}

private extension AccountStore {
    /// The snapshot outside an observation, for the first frame and right after a write.
    func read() throws -> Snapshot {
        Snapshot(
            history: try history(), programs: try programs(), activities: try activities(),
            active: try activeSession(), efforts: try efforts())
    }
}
