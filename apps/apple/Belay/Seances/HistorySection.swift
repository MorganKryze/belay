import BelayCore
import SwiftUI

/// Séances' Historique segment: the sessions kept, newest first, one section per week from Monday;
/// or, before the first one, what will show here.
struct HistorySection: View {
    let weeks: [HistoryWeek]
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if weeks.isEmpty {
            Section {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Aucune séance", tableName: "Seances")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.ink)
                    Text("Tes séances faites apparaîtront ici, semaine par semaine.", tableName: "Seances")
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 10)
            }
            .listRowBackground(Color.surface)
        } else {
            ForEach(weeks) { week in
                Section {
                    ForEach(week.rows) { HistoryRowView(row: $0) }
                } header: {
                    header(week)
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
            }
        }
    }

    /// The week's name, then its count and length: beside it, or under it at the largest sizes.
    private func header(_ week: HistoryWeek) -> some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        return layout {
            Text(Self.name(week)).foregroundStyle(.ink)
            if !typeSize.isAccessibilitySize { Spacer(minLength: 0) }
            Text(Self.size(week))
                .font(.subheadline)
                .foregroundStyle(.muted)
                .monospacedDigit()
        }
        .textCase(nil)
    }

    /// « Cette semaine », or « 28 sept. – 4 oct. ».
    private static func name(_ week: HistoryWeek) -> String {
        guard !week.isCurrent else { return String(localized: "Cette semaine", table: "Seances") }
        guard let start = HistoryText.date(week.start), let end = HistoryText.date(week.end) else { return week.start }
        return (start..<end).formatted(.interval.day().month(.abbreviated))
    }

    /// « 3 séances · 2 h 40 ».
    private static func size(_ week: HistoryWeek) -> String {
        "\(String(localized: "\(week.count) séances", table: "Seances")) · \(DoneTiles.duration(week.durationMs))"
    }
}

/// A session kept: its letter, its day, its name, then its length, volume and the effort this
/// phone holds for it. A tap opens it.
private struct HistoryRowView: View {
    let row: HistoryRow
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        NavigationLink(value: Route.past(workoutId: row.workoutId)) {
            Group {
                // At the largest sizes the tile rises above the words, so they keep the row's width.
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 8) {
                        LetterTile(letter: row.code)
                        words
                    }
                } else {
                    HStack(spacing: 14) {
                        LetterTile(letter: row.code)
                        words
                    }
                }
            }
            .padding(.vertical, 6)
            .frame(minHeight: 56)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(Text("Ouvre la séance", tableName: "Seances"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("history.row")
    }

    private var day: String { HistoryText.day(row.startedAt) }
    private var figures: String { HistoryText.figures(durationMs: row.durationMs, volumeKg: row.volumeKg) }

    /// « Séance C, Lundi 5 octobre, Fessiers, 41 min · 6 140 kg, Soutenu ».
    private var label: String {
        ([SessionText.short(row.code), day, row.name.flatMap { $0.isEmpty ? nil : $0 }, figures]
            + [row.effort.map(EffortText.word)])
            .compactMap { $0 }.joined(separator: ", ")
    }

    private var words: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(day).font(.body.weight(.semibold)).foregroundStyle(.ink)
            if let name = row.name, !name.isEmpty {
                Text(name).font(.subheadline).foregroundStyle(.muted)
            }
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .lastTextBaseline, spacing: 6) { line }
                VStack(alignment: .leading, spacing: 3) { line }
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(.ink)
            .monospacedDigit()
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var line: some View {
        Text(figures).lineLimit(1).fixedSize()
        if let effort = row.effort {
            HStack(alignment: .lastTextBaseline, spacing: 5) {
                EffortGlyph(floor: effort)
                Text(EffortText.word(effort)).lineLimit(1).fixedSize()
            }
        }
    }
}

/// How the history writes a session's day, hour and figures.
enum HistoryText {
    /// A `YYYY-MM-DD` day at its local midnight.
    static func date(_ day: String) -> Date? {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return Calendar.current.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// « Lundi 5 octobre », where the person is.
    static func day(_ startedAt: String) -> String {
        guard let date = Instant.date(startedAt) else { return "" }
        let text = date.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return text.prefix(1).localizedUppercase + text.dropFirst()
    }

    /// « 41 min · 6 140 kg ».
    static func figures(durationMs: Int, volumeKg: Double) -> String {
        "\(DoneTiles.duration(durationMs)) · \(volume(volumeKg))"
    }

    /// « 6 140 kg », whole kilograms.
    static func volume(_ kg: Double) -> String {
        "\(kg.formatted(.number.precision(.fractionLength(0))))\u{202F}kg"
    }
}
