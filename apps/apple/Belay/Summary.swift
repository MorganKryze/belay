import SwiftUI

/// A plain record of what happened, the volume first: no rings, no reward screen.
struct SummaryView: View {
    let summary: SessionSummary
    let close: () -> Void
    @State private var arrived = false

    var body: some View {
        List {
            Section {
                // In the list, not under the title: the cover's bar stays inline from the session.
                VStack(alignment: .leading, spacing: 2) {
                    if let name = summary.name, !name.isEmpty {
                        Text(name).font(.title3.weight(.semibold)).foregroundStyle(.ink)
                    }
                    Text("Séance terminée · \(Self.day(summary.endedAt))")
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                }
                VStack(alignment: .leading, spacing: 2) {
                    block("Volume", Self.volume(summary.volumeKg), unit: "kg", font: .displayHero)
                        .accessibilityIdentifier("summary-volume")
                    Text("Montée exclue · \(summary.warmupSets) séries")
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                }
                .padding(.bottom, 4)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top) {
                        block("Durée", Self.duration(summary.duration))
                        Spacer(minLength: 16)
                        block("Séries", "\(summary.workSets)").accessibilityIdentifier("summary-sets")
                        Spacer(minLength: 0)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        block("Durée", Self.duration(summary.duration))
                        block("Séries", "\(summary.workSets)").accessibilityIdentifier("summary-sets")
                    }
                }
            }
            .listRowBackground(Color.surface)

            if !summary.records.isEmpty {
                Section {
                    ForEach(summary.records) { record in
                        Text("Record\u{202F}: \(record.name), \(SessionText.load(record.load))")
                            .font(.body.weight(.medium))
                            .foregroundStyle(.ink)
                    }
                }
                .listRowBackground(Color.surface)
            }

            if !summary.exercises.isEmpty {
                Section {
                    ForEach(summary.exercises) { logged in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(logged.name).font(.body.weight(.medium)).foregroundStyle(.ink)
                            Text(line(logged)).font(.subheadline).foregroundStyle(.muted).monospacedDigit()
                        }
                        .padding(.vertical, 2)
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text("Ce que tu as noté").textCase(nil).foregroundStyle(.ink)
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
            }
        }
        .belayList()
        .navigationTitle(SessionText.short(summary.code))
        .navigationBarTitleDisplayMode(.inline)
        .scrollEdgeEffectStyle(.hard, for: .bottom)
        // The dialog before this screen already saved: one way out, at the foot, and no blue left.
        .safeAreaBar(edge: .bottom) {
            FootBar {
                QuietFootButton(title: "Fermer", action: close)
                    .accessibilityIdentifier("summary-close")
            }
        }
        .onAppear { arrived = true }
        .sensoryFeedback(.success, trigger: arrived)
    }

    private func block(
        _ title: LocalizedStringKey, _ value: String, unit: String? = nil, font: Font = .displayLoad
    ) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.muted)
            Figure(text: value, unit: unit, font: font)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }

    /// « 4 séries · meilleure 62,5 kg × 8 », or « 1 série · 62,5 kg × 8 ».
    private func line(_ logged: SessionSummary.Logged) -> String {
        let count = logged.top.counts.first ?? 0
        let top = logged.timed
            ? "\(SetText.kg(logged.top.weightKg))\u{202F}kg × \(count)\u{202F}s"
            : "\(SetText.kg(logged.top.weightKg))\u{202F}kg × \(count)"
        return logged.sets == 1
            ? String(localized: "1 série · \(top)") : String(localized: "\(logged.sets) séries · meilleure \(top)")
    }

    /// « 2 605 », whole kilograms.
    private static func volume(_ kg: Double) -> String {
        kg.formatted(.number.precision(.fractionLength(0)))
    }

    /// « samedi 7 novembre », in the person's language.
    private static func day(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    /// « 48 min », « 1 h 5 min ».
    private static func duration(_ seconds: TimeInterval) -> String {
        Duration.seconds(Int(seconds)).formatted(
            .units(allowed: [.hours, .minutes], width: .abbreviated, zeroValueUnits: .hide))
    }
}
