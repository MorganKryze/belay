import BelayCore
import SwiftUI

/// Séances' Historique segment: the sessions kept and, unless Réglages says « Séances seules », the
/// cardio and climbs, newest first, one section per week from Monday; or, before the first one,
/// what will show here.
struct HistorySection: View {
    let weeks: [HistoryWeek]
    /// Opens Activité on the activity tapped.
    let open: (ActivityRow) -> Void
    /// Réglages › Séances › Historique.
    @AppStorage(DevicePrefs.historyActivities.key) private var activities = DevicePrefs.historyActivities.initial
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The weeks as listed: without the activities, a week that held only them goes too.
    private var shown: [HistoryWeek] {
        guard activities == .hidden else { return weeks }
        return weeks.compactMap { week in
            var sessions = week
            sessions.items = week.items.filter { if case .session = $0 { true } else { false } }
            return sessions.items.isEmpty ? nil : sessions
        }
    }

    var body: some View {
        let weeks = shown
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
                    ForEach(week.items) { item in
                        switch item {
                        case .session(let row): HistoryRowView(row: row)
                        case .activity(let activity): ActivityRowView(activity: activity) { open(activity) }
                        }
                    }
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
        // Written out rather than as an interval, whose spacing around the dash varies by system.
        let day = Date.FormatStyle().day().month(.abbreviated)
        return "\(start.formatted(day)) – \(end.formatted(day))"
    }

    /// « 3 séances · 2 h 40 ». The middot is held to the count, so a wrapped line never opens on it.
    private static func size(_ week: HistoryWeek) -> String {
        "\(String(localized: "\(week.count) séances", table: "Seances"))\u{00A0}· \(SessionText.duration(ms: week.durationMs))"
    }
}

/// A session kept: its letter, its day, its name, then its length, volume and the effort this
/// phone holds for it. A tap opens it.
private struct HistoryRowView: View {
    let row: HistoryRow
    /// Réglages › Séances › Volume.
    @AppStorage(DevicePrefs.sessionVolume.key) private var volume = DevicePrefs.sessionVolume.initial
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
    private var figures: String {
        HistoryText.figures(durationMs: row.durationMs, volumeKg: volume == .shown ? row.volumeKg : nil)
    }

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

/// A cardio or a climb: its tile, its day, then the web's words for it. A tap opens it in Activité.
private struct ActivityRowView: View {
    let activity: ActivityRow
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        Button(action: open) {
            Group {
                // At the largest sizes the tile rises above the words, as a session's does.
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 8) {
                        tile
                        words
                    }
                } else {
                    HStack(spacing: 14) {
                        tile
                        words
                    }
                }
            }
            .padding(.vertical, 6)
            .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([day, text].joined(separator: ", "))
        .accessibilityHint(Text("Ouvre l’activité", tableName: "Seances"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("history.activity")
    }

    /// The session letter's size, so the rows of a week line up.
    private var tile: some View {
        DomainTile(
            domain: .activity, symbol: activity.kind == "climbing" ? "figure.climbing" : "figure.run", side: 48,
            corner: 13)
    }

    /// « Mercredi 7 octobre ».
    private var day: String { BodyText.date(activity.date).map { WeekdayText.day($0).capitalizedFirst } ?? activity.date }
    /// « Escalade · 1 h 30 », « Vélo · 45 min ».
    private var text: String { ActivityText.activity(activity) }

    private var words: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(day).font(.body.weight(.semibold)).foregroundStyle(.ink)
            Text(text).font(.subheadline.weight(.medium)).foregroundStyle(.ink).monospacedDigit()
        }
        .fixedSize(horizontal: false, vertical: true)
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
        Instant.date(startedAt).map { WeekdayText.day($0).capitalizedFirst } ?? ""
    }

    /// « 41 min · 6 140 kg », or « 41 min » without the volume.
    static func figures(durationMs: Int, volumeKg: Double?) -> String {
        let duration = SessionText.duration(ms: durationMs)
        return volumeKg.map { "\(duration) · \(volume($0))" } ?? duration
    }

    /// « 6 140 kg » or « 13 536 lb », whole, in the unit chosen; the summary's too. The sum is
    /// converted as a whole, not load by load, as the web does.
    static func volume(_ kg: Double) -> String {
        let figure = SetText.unit == .kg ? kg : kgToLb(kg)
        return "\(figure.formatted(.number.precision(.fractionLength(0))))\u{202F}\(SetText.symbol)"
    }
}
