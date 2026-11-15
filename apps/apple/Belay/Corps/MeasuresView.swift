import BelayCore
import Charts
import SwiftUI

/// Mensurations: the last waist large, its change since the first in words, the waist's curve,
/// then every day measured, newest first. « + » opens the measures sheet.
struct MeasuresView: View {
    let corps: CorpsModel
    @State private var adding = false

    var body: some View {
        let state = corps.measures
        List {
            Section {
                VStack(alignment: .leading, spacing: 10) {
                    DomainChip(domain: .body, text: String(localized: "Tour de taille", table: "Entries"), symbol: "ruler.fill")
                    if let waist = state.waist {
                        Figure(text: BodyText.number(waist.cm), value: waist.cm, unit: "cm")
                        if let words = change(state) {
                            Text(words)
                                .font(.subheadline)
                                .foregroundStyle(.muted)
                                .accessibilityIdentifier("measures-change")
                        }
                        if state.curve.count > 1 { WaistChart(points: state.curve) }
                    } else {
                        Text("Pas encore de tour de taille", tableName: "Entries")
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.ink)
                        Text("Ta courbe commence à ta première mesure.", tableName: "Entries")
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                    }
                }
                .padding(.vertical, 10)
            } footer: {
                if state.history.isEmpty { footer }
            }
            .listRowBackground(Color.surface)
            if !state.history.isEmpty {
                Section {
                    ForEach(Array(state.history.enumerated()), id: \.element.date) { index, row in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(BodyText.longDay(row.date, today: corps.today))
                                .font(.body.weight(.semibold))
                                .foregroundStyle(.ink)
                            Text(fields(row))
                                .font(.subheadline)
                                .foregroundStyle(.muted)
                                .monospacedDigit()
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("measure-\(index)")
                    }
                } header: {
                    Text("Historique", tableName: "Entries").textCase(nil).foregroundStyle(.ink)
                } footer: {
                    footer
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
            }
        }
        .belayList()
        .navigationTitle(Text("Mensurations", tableName: "Entries"))
        .largeTitleOnly()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = true } label: {
                    Image(systemName: "plus").fontWeight(.semibold)
                }
                .accessibilityLabel(Text("Ajouter des mensurations", tableName: "Entries"))
                .accessibilityIdentifier("measures-add")
            }
        }
        .sheet(isPresented: $adding) { MeasuresSheet(corps: corps) }
    }

    private var footer: some View {
        Text("Cou et hanches servent à l’outil Masse grasse.", tableName: "Entries").foregroundStyle(.muted)
    }

    /// « 1,5 cm de moins depuis le 7 septembre », in words either way, never as a judgement.
    private func change(_ state: MeasuresState) -> String? {
        guard let change = state.changeCm, let first = state.first, let day = BodyText.date(first.date) else { return nil }
        let since = day.formatted(.dateTime.day().month(.wide))
        let cm = BodyText.cm(abs(change))
        if change < 0 { return String(localized: "\(cm) de moins depuis le \(since)", table: "Entries") }
        if change > 0 { return String(localized: "\(cm) de plus depuis le \(since)", table: "Entries") }
        return String(localized: "le même depuis le \(since)", table: "Entries")
    }

    /// « taille 84,5 cm · cou 38,0 cm · hanches 98,0 cm », the fields the day holds.
    private func fields(_ row: MeasureRow) -> String {
        [
            row.waistCm.map { String(localized: "taille \(BodyText.cm($0))", table: "Entries") },
            row.neckCm.map { String(localized: "cou \(BodyText.cm($0))", table: "Entries") },
            row.hipCm.map { String(localized: "hanches \(BodyText.cm($0))", table: "Entries") },
        ]
        .compactMap(\.self).joined(separator: " · ")
    }
}

/// The waist by day in the body's shade, its axis on the right. VoiceOver reads it as one
/// sentence from the first waist to the last.
private struct WaistChart: View {
    let points: [Point]

    var body: some View {
        let low = (points.map(\.value).min() ?? 0).rounded(.down)
        let high = (points.map(\.value).max() ?? 0).rounded(.up)
        Chart(points, id: \.date) { point in
            if let day = BodyText.date(point.date) {
                LineMark(x: .value("Jour", day), y: .value("Taille", point.value))
                    .foregroundStyle(Color.bodyShade)
                    .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round))
                PointMark(x: .value("Jour", day), y: .value("Taille", point.value))
                    .foregroundStyle(Color.bodyShade)
            }
        }
        .chartXAxis(.hidden)
        .chartYScale(domain: low...max(high, low + 1))
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 3)) { _ in
                AxisGridLine().foregroundStyle(.line)
                AxisValueLabel().foregroundStyle(.muted)
            }
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .frame(height: 110)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(summary)
        .accessibilityIdentifier("measures-curve")
    }

    private var summary: String {
        guard let first = points.first, let last = points.last else { return "" }
        return String(
            localized: "Tour de taille, de \(BodyText.cm(first.value)) à \(BodyText.cm(last.value))", table: "Entries")
    }
}

extension BodyText {
    /// A day as a history's heading: « Aujourd’hui », « Hier », else « Lundi 5 octobre ».
    static func longDay(_ date: String, today: String) -> String {
        if date == today { return String(localized: "Aujourd’hui", table: "Entries") }
        if date == addDays(today, -1) { return String(localized: "Hier", table: "Entries") }
        guard let day = self.date(date) else { return date }
        let words = day.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return words.prefix(1).uppercased() + words.dropFirst()
    }
}
