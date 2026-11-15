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
        intake = intakeState(.empty, now: now(), timeZone: timeZone)
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
        intake = intakeState(body, now: at, timeZone: timeZone)
        supplements = supplementsToday(body, now: at, timeZone: timeZone)
        annotations = body.annotations.filter { !$0.removed }.sorted { ($0.date, $0.id) < ($1.date, $1.id) }
        offersImport = HealthKitWriter.available && !health.offered
    }

    /// The weigh-in of `date`, if the day holds one.
    func weighIn(on date: String) -> Double? {
        body.weights.first { $0.date == date }?.weightKg
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

    /// « Importer les pesées »: the import's switch, asked of iOS now; the card is answered either way.
    func importWeighIns() async {
        _ = await turnImportOn()
        answerImport()
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
