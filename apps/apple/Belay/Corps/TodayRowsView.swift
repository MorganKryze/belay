import BelayCore
import SwiftUI

/// Where a row of « Aujourd'hui » leads: the weigh-in's sheet, or a pushed screen.
enum TodayEntry {
    case weighIn
    case screen(Route)
}

/// « Aujourd'hui »: the day's four body entries, the same rows on Corps and on Accueil (R13), each
/// in words with its domain tile, each one element that opens its sheet or screen.
struct TodayRowsView: View {
    let rows: TodayRows
    /// The local day the rows were read for, so the last measure's day reads as a word.
    let today: String
    let open: (TodayEntry) -> Void

    var body: some View {
        Section {
            row("today.weighIn", .body, "scalemass.fill", String(localized: "Pesée", table: "Corps"), weighIn, logged: rows.weighIn.kg != nil) {
                open(.weighIn)
            }
            row("today.measures", .body, "ruler.fill", String(localized: "Mensurations", table: "Corps"), measures, logged: rows.measures != nil) {
                open(.screen(.measures))
            }
            row("today.intake", .intake, "fork.knife", String(localized: "Apports", table: "Corps"), intake, logged: rows.intake.kcal != nil) {
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
        logged: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            TodayRow(domain: domain, symbol: symbol, title: title, detail: detail, logged: logged)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(id)
    }

    private var weighIn: String {
        guard let kg = rows.weighIn.kg else { return String(localized: "pas encore saisie", table: "Corps") }
        let value = BodyText.kg(kg)
        return rows.weighIn.fromHealth ? String(localized: "\(value) · depuis Santé", table: "Corps") : value
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

/// One row: the domain tile, the name, its state under it. At the largest sizes the tile goes
/// above the words, so the words keep the row's width.
private struct TodayRow: View {
    let domain: Domain
    let symbol: String
    let title: String
    let detail: String
    let logged: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 14))
        layout {
            DomainTile(domain: domain, symbol: symbol)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(.ink)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(logged ? .ink : .muted)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }
}

/// The body's figures in the person's language: tenths of kg and cm, whole kcal and g.
enum BodyText {
    /// « 79,9 », the tenth always shown.
    static func number(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(1)))
    }

    static func kg(_ value: Double) -> String { "\(number(value))\u{202F}kg" }

    static func cm(_ value: Double) -> String { "\(number(value))\u{202F}cm" }

    /// « 1 850 », grouped as the language groups.
    static func whole(_ value: Int) -> String { value.formatted(.number) }

    /// « 0,5 », « 1 »: a range's bound as the person set it.
    static func percent(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
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
