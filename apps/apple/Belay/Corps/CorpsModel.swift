import BelayCore
import Foundation
import os

/// Corps's and Accueil's view of the body entries: the trend, « Aujourd'hui » and the weigh-in
/// sheet's writes. It follows the store, so a sync or another screen shows here, and reads the day
/// again at each local midnight.
@MainActor @Observable
final class CorpsModel {
    private(set) var state: CorpsState = .first
    private(set) var rows: TodayRows
    /// The curve over `span`, recomputed when the entries or the span change.
    private(set) var series: TrendSeries
    /// Tes semaines, newest first.
    private(set) var weekRows: [WeekRow] = []
    /// The loss range the weeks are read against.
    private(set) var range = defaultTarget
    /// Every annotation in place, oldest first: the list under the weeks.
    private(set) var annotations: [AnnotationRow] = []
    /// The local day the state was read for, and when it was read, for the date under the title.
    private(set) var today: String
    private(set) var readAt: Date
    /// Mensurations, Apports and Compléments.
    private(set) var measures: MeasuresState
    private(set) var intake: IntakeState
    private(set) var supplements: [SupplementToday] = []
    /// Whether the import's card shows: Health is on this phone and the card was never answered.
    private(set) var offersImport = false
    /// The card's last « Importer les pesées » found Santé refused: the card stays and says why.
    private(set) var importRefused = false
    /// The activity level and the protein goal chosen in the tools on this phone, which Apports
    /// reads; « sédentaire » and maintenance until the person chooses.
    var choices = IntakeChoices() {
        didSet { if choices != oldValue { intake = intakeState(body, choices, now: now(), timeZone: timeZone) } }
    }
    /// Corps opens on M (R11).
    var span: TrendSpan = .month {
        didSet { series = trendSeries(body, span: span, now: now(), timeZone: timeZone) }
    }

    private var body: BodyRead
    private var health: HealthSettings = .off
    private let store: AccountStore
    private let actions: BodyActions
    private let didWrite: () -> Void
    private let runHealth: () -> Void
    private let turnImportOn: () async -> Bool
    /// The clock and zone the day is read in; the sheets date their entries by them too.
    let now: @Sendable () -> Date
    let timeZone: TimeZone
    @ObservationIgnored private var watch: Task<Void, Never>?
    @ObservationIgnored private var midnight: Task<Void, Never>?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "corps")

    init(
        store: AccountStore, didWrite: @escaping () -> Void, runHealth: @escaping () -> Void,
        turnImportOn: @escaping () async -> Bool,
        now: @escaping @Sendable () -> Date, timeZone: TimeZone
    ) {
        self.store = store
        actions = BodyActions(store: store, now: now, timeZone: timeZone)
        self.didWrite = didWrite
        self.runHealth = runHealth
        self.turnImportOn = turnImportOn
        self.now = now
        self.timeZone = timeZone
        body = BodyRead.empty
        let at = now()
        readAt = at
        today = toISODate(at, timeZone: timeZone)
        rows = corpsState(.empty, health: .off, now: now(), timeZone: timeZone).1
        series = trendSeries(.empty, span: .month, now: now(), timeZone: timeZone)
        measures = measuresState(.empty, now: now(), timeZone: timeZone)
        intake = intakeState(.empty, IntakeChoices(), now: now(), timeZone: timeZone)
        refresh()
        watch = Task { [weak self, store] in
            do {
                for try await body in store.observe({ try AccountStore.body($0) }) { self?.show(body) }
            } catch {
                Self.log.error("body not followed: \(AccountStore.logLabel(error), privacy: .public)")
            }
        }
        midnight = everyMidnight(now: now, timeZone: timeZone) { [weak self] in self?.refresh() }
    }

    isolated deinit {
        watch?.cancel()
        midnight?.cancel()
    }

    /// Reads the entries and the day again: on return to the foreground, at midnight, after a write.
    func refresh() {
        do {
            show(try store.body())
        } catch {
            Self.log.error("body not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    private func show(_ body: BodyRead) {
        do {
            health = try store.healthSettings()
        } catch {
            Self.log.error("health settings not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
        let at = now()
        self.body = body
        readAt = at
        today = toISODate(at, timeZone: timeZone)
        (state, rows) = corpsState(body, health: health, now: at, timeZone: timeZone)
        series = trendSeries(body, span: span, now: at, timeZone: timeZone)
        weekRows = weeks(body, now: at, timeZone: timeZone)
        range = targetRange(body)
        measures = measuresState(body, now: at, timeZone: timeZone)
        intake = intakeState(body, choices, now: at, timeZone: timeZone)
        supplements = supplementsToday(body, now: at, timeZone: timeZone)
        annotations = body.annotations.filter { !$0.removed }.sorted { ($0.date, $0.id) < ($1.date, $1.id) }
        offersImport = HealthKitWriter.available && !health.offered
    }

    /// The weigh-in of `date`, if the day holds one.
    func weighIn(on date: String) -> Double? {
        body.weights.first { $0.date == date }?.weightKg
    }

    /// What the tools open on: the profile, the 7-day average or the last weigh-in, the last
    /// measures. A tool reads it once, when its page opens.
    var toolDefaults: ToolDefaults { BelayCore.toolDefaults(body, now: now(), timeZone: timeZone) }

    /// The profile as it stands, for the update a tool offers when its value differs.
    var profile: ProfileRow? { body.profile }

    /// « Mettre à jour » in a tool: the profile takes the formula or the height typed there.
    func setFormula(_ formula: ProfileFormula) {
        write("profile not saved") { try actions.setProfile(.formula, .set(formula)) }
    }

    func setHeight(_ cm: Int) {
        write("profile not saved") { try actions.setProfile(.height, .set(cm)) }
    }

    func setBirthYear(_ year: Int) {
        write("profile not saved") { try actions.setProfile(.birthYear, .set(year)) }
    }

    /// Profil's « Effacer »: the fact is written empty, so every device learns of it.
    func clearProfile(_ fact: ProfileFact) {
        write("profile not cleared") {
            switch fact {
            case .formula: try actions.setProfile(.formula, .clear)
            case .birthYear: try actions.setProfile(.birthYear, .clear)
            case .height: try actions.setProfile(.height, .clear)
            }
        }
    }

    /// The loss range as Profil leaves it; one already shown writes nothing.
    func setRange(_ range: TargetRange) {
        guard isTargetRange(range) else { return }
        write("range not saved") { try actions.setTarget(minPct: range.minPct, maxPct: range.maxPct) }
    }

    /// Mes compléments: the supplements still on the list, in the order they came.
    var supplementList: [SupplementRow] { body.supplements.filter { !$0.removed } }

    /// A supplement's name, removed or not, for a refusal that names it.
    func supplementName(_ id: String) -> String? { body.supplements.first { $0.id == id }?.name }

    /// The days a supplement was ticked, which stay once it leaves the list.
    func daysMarked(supplementId: String) -> Int {
        Set(body.logs.filter { $0.supplementId == supplementId }.map(\.date)).count
    }

    /// A new supplement, with an id of its own.
    func addSupplement(name: String) {
        write("supplement not added") { try actions.addSupplement(id: UUIDv7.make(at: now()), name: name) }
    }

    func renameSupplement(id: String, name: String) {
        write("supplement not renamed") { try actions.renameSupplement(id: id, name: name) }
    }

    func removeSupplement(id: String) {
        write("supplement not removed") { try actions.removeSupplement(id: id) }
    }

    /// The latest weigh-in up to today, the sheet's grey placeholder.
    var lastWeighIn: Double? {
        body.weights.filter { $0.date <= today && $0.weightKg != nil }.max { $0.date < $1.date }?.weightKg
    }

    func weigh(date: String, kg: Double) {
        write("weigh-in not saved") { try actions.weigh(date: date, kg: kg) }
    }

    func deleteWeighIn(date: String) {
        write("weigh-in not deleted") { try actions.deleteWeight(date: date) }
    }

    /// The measures of `date`, if the day holds any.
    func measure(on date: String) -> MeasureRow? {
        body.measures.first { $0.date == date }
    }

    /// The latest value of `field` up to today, the measures sheet's grey placeholder.
    func lastMeasure(_ field: MeasureField) -> Double? {
        let cm = { (row: MeasureRow) -> Double? in
            switch field {
            case .waist: row.waistCm
            case .neck: row.neckCm
            case .hip: row.hipCm
            }
        }
        return body.measures.filter { $0.date <= today && cm($0) != nil }.max { $0.date < $1.date }.flatMap(cm)
    }

    /// The intake of `date`, if the day holds one.
    func intake(on date: String) -> IntakeRow? {
        body.intake.first { $0.date == date }
    }

    func measure(date: String, waist: FieldEdit<Double>, neck: FieldEdit<Double>, hip: FieldEdit<Double>) {
        write("measures not saved") { try actions.measure(date: date, waist: waist, neck: neck, hip: hip) }
    }

    /// The day's total, both fields in one write.
    func logIntake(date: String, kcal: FieldEdit<Int>, protein: FieldEdit<Int>) {
        write("intake not saved") { try actions.intake(date: date, kcal: kcal, protein: protein) }
    }

    /// Today's box of a supplement, ticked or not (R20).
    func take(supplementId: String, taken: Bool) {
        write("supplement not logged") { try actions.take(supplementId: supplementId, date: today, taken: taken) }
    }

    /// A new annotation, or an edit of the one with `input`'s id.
    func annotate(_ input: AnnotationInput) {
        write("annotation not saved") { try actions.annotate(input) }
    }

    func removeAnnotation(id: String) {
        write("annotation not removed") { try actions.removeAnnotation(id: id) }
    }

    /// « Importer les pesées »: Santé and its import turned on, iOS asked now. The import's switch
    /// answers the card, so it leaves once the import is on; refused, it stays and says why.
    func importWeighIns() async {
        let on = await turnImportOn()
        importRefused = !on
        if on { refresh() }
    }

    /// « Pas maintenant »: the card never shows again; Réglages keeps the switch.
    func answerImport() {
        do {
            try store.setHealthImportOffered()
        } catch {
            Self.log.error("import card not answered: \(AccountStore.logLabel(error), privacy: .public)")
        }
        refresh()
    }

    private func write(_ failure: String, _ change: () throws -> Void) {
        do {
            try change()
            didWrite()
            runHealth()
        } catch {
            Self.log.error("\(failure, privacy: .public): \(AccountStore.logLabel(error), privacy: .public)")
        }
        refresh()
    }
}

/// A fact of Profil, for its « Effacer ».
enum ProfileFact: String, CaseIterable {
    case formula, birthYear, height
}

/// What Apports reads from the tools: the level's PAL and the protein goal.
struct IntakeChoices: Equatable {
    var pal = ToolMemory().pal.pal
    var goal = ToolMemory().goal
}

private func intakeState(_ body: BodyRead, _ choices: IntakeChoices, now: Date, timeZone: TimeZone) -> IntakeState {
    intakeState(body, pal: choices.pal, goal: choices.goal, now: now, timeZone: timeZone)
}
