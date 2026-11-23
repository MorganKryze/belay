import BelayCore
import SwiftUI

/// Where a row of « Aujourd'hui » leads: the Activité or weigh-in sheet, or a pushed screen.
enum TodayEntry {
    case activity
    case weighIn
    case screen(Route)
}

/// « Aujourd'hui »: the day's four body entries, the same rows on Corps and on Accueil (R13), each
/// in words with its domain tile, each one element that opens its sheet or screen. Accueil heads
/// them with « Activité » (A38), and « Pas » while the steps import is on.
struct TodayRowsView: View {
    let rows: TodayRows
    /// The local day the rows were read for, so the last measure's day reads as a word.
    let today: String
    /// What the day's « Activité » row says; nil leaves the row out.
    var activity: DaySummary? = nil
    /// Today's steps as stored, while the steps import is on; nil leaves the row out.
    var steps: TodaySteps? = nil
    let open: (TodayEntry) -> Void

    var body: some View {
        Section {
            if let activity {
                row("today.activity", .activity, "figure.walk", String(localized: "Activité", table: "Activity"),
                    ActivityText.summary(activity), logged: activity != .none,
                    done: activity == .none ? nil : String(localized: "saisie", table: "Activity")) {
                    open(.activity)
                }
            }
            if let steps {
                // Read only: the steps come from Santé, never typed here.
                TodayRow(domain: .activity, symbol: "shoeprints.fill", title: String(localized: "Pas", table: "Activity"),
                         detail: stepsDetail(steps), logged: steps.value != nil, done: steps.value != nil)
                    .accessibilityValue(steps.value == nil ? "" : String(localized: "saisis", table: "Corps"))
                    .accessibilityIdentifier("today.steps")
            }
            row("today.weighIn", .body, "scalemass.fill", String(localized: "Pesée", table: "Corps"), weighIn(BodyText.weight), spoken: weighIn(BodyText.spoken), logged: rows.weighIn.kg != nil,
                done: rows.weighIn.kg == nil ? nil : String(localized: "saisie", table: "Corps")) {
                open(.weighIn)
            }
            row("today.measures", .body, "ruler.fill", String(localized: "Mensurations", table: "Corps"), measures, logged: rows.measures != nil) {
                open(.screen(.measures))
            }
            row("today.intake", .intake, "fork.knife", String(localized: "Apports", table: "Corps"), intake, logged: rows.intake.kcal != nil,
                done: rows.intake.kcal == nil && rows.intake.proteinG == nil ? nil : String(localized: "saisis", table: "Corps")) {
                open(.screen(.intake))
            }
            row("today.supplements", .intake, "pills.fill", String(localized: "Compléments", table: "Corps"), supplements, logged: rows.supplements.taken > 0) {
                open(.screen(.supplements))
            }
        } header: {
            Text("Aujourd’hui", tableName: "Corps").textCase(nil).foregroundStyle(.ink)
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
    }

    private func row(
        _ id: String, _ domain: Domain, _ symbol: String, _ title: String, _ detail: String,
        spoken: String? = nil, logged: Bool, done: String? = nil, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            TodayRow(domain: domain, symbol: symbol, title: title, detail: detail, spoken: spoken, logged: logged, done: done != nil)
        }
        .buttonStyle(.plain)
        .accessibilityValue(done ?? "")
        .accessibilityIdentifier(id)
    }

    /// The day's weight, written by `weight`: shown with the symbol, said with the unit as a word.
    private func weighIn(_ weight: (Double) -> String) -> String {
        guard let kg = rows.weighIn.kg else { return String(localized: "pas encore saisie", table: "Corps") }
        let value = weight(kg)
        return rows.weighIn.fromHealth ? String(localized: "\(value) · depuis Santé", table: "Corps") : value
    }

    private func stepsDetail(_ steps: TodaySteps) -> String {
        guard let value = steps.value else { return String(localized: "aucun pour l’instant", table: "Corps") }
        let figure = ActivityText.steps(value)
        return steps.fromHealth ? String(localized: "\(figure) · depuis Santé", table: "Corps") : figure
    }

    private var measures: String {
        guard let last = rows.measures else { return String(localized: "pas encore saisies", table: "Corps") }
        let cm = BodyText.cm(last.cm)
        let day = BodyText.day(last.date, today: today)
        switch last.field {
        case .waist: return String(localized: "taille \(cm) · \(day)", table: "Corps")
        case .neck: return String(localized: "cou \(cm) · \(day)", table: "Corps")
        case .hip: return String(localized: "hanches \(cm) · \(day)", table: "Corps")
        }
    }

    private var intake: String {
        let kcal = rows.intake.kcal.map { String(localized: "\(BodyText.whole($0))\u{202F}kcal", table: "Corps") }
        let protein = rows.intake.proteinG.map {
            String(localized: "\(BodyText.whole($0))\u{202F}g de protéines", table: "Corps")
        }
        let parts = [kcal, protein].compactMap(\.self)
        return parts.isEmpty ? String(localized: "pas encore saisis", table: "Corps") : parts.joined(separator: " · ")
    }

    private var supplements: String {
        let s = rows.supplements
        guard s.total > 0 else { return String(localized: "aucun pour l’instant", table: "Corps") }
        return String(localized: "\(s.taken) sur \(s.total)", table: "Corps")
    }
}

/// Today's steps, nil before any, and whether this phone's import wrote them.
struct TodaySteps: Equatable {
    let value: Int?
    let fromHealth: Bool
}

/// One row: the domain tile, the name, its state under it. At the largest sizes the tile goes
/// above the words, so the words keep the row's width.
private struct TodayRow: View {
    let domain: Domain
    let symbol: String
    let title: String
    let detail: String
    /// The detail as VoiceOver says it, when it differs from the text shown.
    var spoken: String? = nil
    let logged: Bool
    /// The day's entry is in: a ✓ before its value, said by the row's value.
    let done: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 14))
        layout {
            DomainTile(domain: domain, symbol: symbol)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(.ink)
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    if done {
                        Image(systemName: "checkmark")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.ink)
                            .accessibilityHidden(true)
                    }
                    Text(detail)
                        .accessibilityLabel(spoken ?? detail)
                        .font(.subheadline)
                        .foregroundStyle(logged ? .ink : .muted)
                        .monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

/// The body's figures in the person's language: weights in the unit chosen, tenths of cm, whole kcal and g.
enum BodyText {
    /// « 79,9 », the tenth always shown.
    static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1)))
    }

    /// A body weight's figure in `unit`, as the web shows it: « 80,4 » in kilos, its tenth always
    /// shown, « 177,25 » or « 177,5 » in pounds, to the quarter. Never grouped, so a field can take it back.
    static func figure(_ kg: Double, _ unit: WeightUnit = SetText.unit) -> String {
        weighingFromKg(kg, unit).formatted(
            .number.grouping(.never).precision(.fractionLength(1...(unit == .kg ? 1 : 2))))
    }

    /// « 80,4 kg », « 177,25 lb »: the symbol never translated, after a narrow no-break space.
    static func weight(_ kg: Double) -> String { "\(figure(kg))\u{202F}\(SetText.symbol)" }

    /// « 80,4 kilos », « 177,25 livres »: the same weight as VoiceOver says it, the unit as a word.
    static func spoken(_ kg: Double) -> String { "\(figure(kg)) \(SetText.unitWord)" }

    static func cm(_ value: Double) -> String { "\(number(value))\u{202F}cm" }

    /// « 1 850 », grouped as the language groups.
    static func whole(_ value: Int) -> String { value.formatted(.number) }

    /// « 0,7 % » in French, « 0.7% » in English: the sign as each language writes it.
    static func percent(_ figure: String) -> String {
        String(localized: "\(figure)\u{202F}%", table: "Corps")
    }

    /// A day as a word: « aujourd’hui », a weekday within the week, else its date.
    static func day(_ date: String, today: String) -> String {
        if date == today { return String(localized: "aujourd’hui", table: "Corps") }
        guard let day = self.date(date) else { return date }
        if date >= addDays(today, -6) { return day.formatted(.dateTime.weekday(.wide)) }
        return day.formatted(.dateTime.day().month(.wide))
    }

    /// A local day at noon, so a chart's mark sits mid-day in any zone.
    static func date(_ iso: String) -> Date? {
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }
}
