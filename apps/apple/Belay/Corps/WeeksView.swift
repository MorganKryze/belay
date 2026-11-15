import BelayCore
import SwiftUI

/// Tes semaines, newest first, each with its loss and its range in words, then the annotations
/// with the row that adds one. A gain reads « prise » in ink, never red (R9).
struct WeeksView: View {
    let weeks: [WeekRow]
    let range: TargetRange
    let annotations: [AnnotationRow]
    let add: () -> Void
    let edit: (AnnotationRow) -> Void

    var body: some View {
        Section {
            ForEach(Array(weeks.enumerated()), id: \.element.summary.start) { index, week in
                WeekLine(week: week, range: range).accessibilityIdentifier("week-\(index)")
            }
        } header: {
            Text("Tes semaines", tableName: "Corps").textCase(nil).foregroundStyle(.ink)
        } footer: {
            let low = BodyText.percent(targetMin), high = "\(BodyText.percent(targetMax))\u{202F}%"
            Text("Ta fourchette se règle dans ton profil, de \(low) à \(high) par semaine.", tableName: "Trend")
                .foregroundStyle(.muted)
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)

        Section {
            ForEach(annotations, id: \.id) { row in
                if AnnotationKind.chosen.contains(row.type) {
                    Button { edit(row) } label: { AnnotationLine(row: row) }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityHint(Text("Modifier ou supprimer", tableName: "Trend"))
                } else {
                    AnnotationLine(row: row).accessibilityElement(children: .combine)
                }
            }
            Button(action: add) {
                Label {
                    Text("Ajouter une annotation", tableName: "Trend")
                } icon: {
                    Image(systemName: "plus")
                }
                .font(.body.weight(.medium))
                .foregroundStyle(.ink)
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("trend-annotate")
        } header: {
            Text("Annotations", tableName: "Trend").textCase(nil).foregroundStyle(.ink)
        } footer: {
            Text(
                "Pendant les 14 jours de créatine, le poids monte souvent d’1 à 2\u{202F}kg d’eau\u{202F}: ce n’est pas du gras.",
                tableName: "Trend"
            )
            .foregroundStyle(.muted)
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
    }
}

/// One week: its span or « Cette semaine », its change or « à suivre », its weigh-ins and average,
/// the annotations' words, and its range unless still running.
private struct WeekLine: View {
    let week: WeekRow
    let range: TargetRange

    private var title: String {
        if week.isCurrent { return String(localized: "Cette semaine", table: "Trend") }
        guard let start = BodyText.date(week.summary.start), let end = BodyText.date(week.summary.end) else {
            return week.summary.start
        }
        return (start..<end).formatted(.interval.day().month(.abbreviated))
    }

    private var change: String? {
        if week.isCurrent { return String(localized: "à suivre", table: "Trend") }
        guard let loss = week.summary.lossPct else { return nil }
        let figure = "\(BodyText.number(abs(loss)))\u{202F}%"
        return loss < 0
            ? String(localized: "prise \(figure)", table: "Trend") : String(localized: "perte \(figure)", table: "Trend")
    }

    private var line: String {
        var parts = [String(localized: "\(week.summary.count) pesées", table: "Trend")]
        if let kg = week.summary.averageKg { parts.append(BodyText.kg(kg)) }
        parts += week.annotations.map { mark in
            switch mark.kind {
            case .deload: String(localized: "allégée", table: "Trend")
            case .dietBreak: String(localized: "pause diète", table: "Trend")
            case .note, .unknown: mark.label ?? mark.kind.name.lowercased()
            }
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) {
                    Text(title)
                    Spacer(minLength: 8)
                    if let change { Text(change) }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                    if let change { Text(change) }
                }
            }
            .font(.body.weight(.semibold))
            .foregroundStyle(.ink)
            .monospacedDigit()
            Text(line).font(.subheadline).foregroundStyle(.muted).monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
            if !week.isCurrent {
                switch week.inRange {
                case true?:
                    RangePill(text: LocalizedStringKey(String(localized: "dans ta fourchette", table: "Corps")))
                case false?:
                    let low = BodyText.percent(range.minPct), high = "\(BodyText.percent(range.maxPct))\u{202F}%"
                    Text(String(localized: "hors de ta fourchette, \(low) à \(high)", table: "Corps"))
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.muted)
                        .monospacedDigit()
                        .fixedSize(horizontal: false, vertical: true)
                case nil:
                    EmptyView()
                }
            }
        }
        .padding(.vertical, 4)
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
    }
}

/// An annotation: its kind's tile, its kind and label, and from when or on which day.
private struct AnnotationLine: View {
    let row: AnnotationRow

    private var title: String {
        row.label.map { "\(row.type.name) · \($0)" } ?? row.type.name
    }

    private var when: String {
        let day = BodyText.date(row.date)?.formatted(.dateTime.day().month(.wide)) ?? row.date
        return row.type == .note
            ? String(localized: "le \(day)", table: "Trend") : String(localized: "à partir du \(day)", table: "Trend")
    }

    var body: some View {
        HStack(spacing: 14) {
            DomainTile(domain: .rest, symbol: row.type.symbol)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(.ink)
                Text(when).font(.subheadline).foregroundStyle(.muted)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(minHeight: 52)
        .contentShape(.rect)
    }
}
