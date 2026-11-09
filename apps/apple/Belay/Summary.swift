import BelayCore
import SwiftUI

/// A plain record of what happened: the session and its end under a finish flag, the effort to
/// give if the person wants, the shared summary's figures, the records, a note. One way out, the
/// ✓ at the foot, or a pull down; either saves the note and settles the effort.
struct SummaryView: View {
    let summary: SessionSummary
    let giveEffort: (Int?) -> Void
    /// Saves and closes; false when the save failed and the summary stays.
    let close: (String) -> Bool
    @Environment(\.dynamicTypeSize) private var type
    @State private var note: String
    @State private var arrived = false
    /// Set once the summary was left, so a dismissal by the system does not leave it twice.
    @State private var left = false
    /// Counts the saves that failed, for a haptic: the summary stays, and the ✓ can try again.
    @State private var failures = 0

    init(summary: SessionSummary, giveEffort: @escaping (Int?) -> Void, close: @escaping (String) -> Bool) {
        self.summary = summary
        self.giveEffort = giveEffort
        self.close = close
        _note = State(initialValue: summary.note ?? "")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                titleCard
                effortCard
                LazyVGrid(
                    columns: Array(
                        repeating: GridItem(.flexible(), spacing: 10, alignment: .top),
                        count: type.isAccessibilitySize ? 1 : 2),
                    spacing: 10
                ) {
                    tile("Durée", Self.duration(summary.duration)).accessibilityIdentifier("summary-tile-duration")
                    tile("Séries", "\(summary.workSets)").accessibilityIdentifier("summary-sets")
                    tile("Volume", "\(Self.volume(summary.volumeKg))\u{202F}kg").accessibilityIdentifier("summary-volume")
                    tile("Records", "\(summary.records.count)")
                }
                ForEach(summary.records) { record in
                    Label {
                        Text("Record\u{202F}: \(record.name), \(SessionText.load(record.load))")
                    } icon: {
                        Image(systemName: "trophy").accessibilityHidden(true)
                    }
                    .font(.headline)
                    .foregroundStyle(.ink)
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.surface, in: .rect(cornerRadius: 22))
                }
                TextField(text: $note, axis: .vertical) { Text("Une note sur la séance") }
                    .lineLimit(3...6)
                    .foregroundStyle(.ink)
                    .frame(minHeight: 44, alignment: .topLeading)
                    .padding(16)
                    .background(Color.surface, in: .rect(cornerRadius: 22))
                    // The server takes up to this many UTF-16 units; past it the note would be refused.
                    .onChange(of: note) { _, text in
                        if text.utf16.count > Bounds.noteMax { note = fitNote(text) }
                    }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 24)
        }
        .scrollBounceBehavior(.basedOnSize)
        .scrollDismissesKeyboard(.interactively)
        // The app's large-title rule, with no title at all here: no bar and no band once scrolled.
        .scrollEdgeEffectHidden(true, for: .top)
        .toolbarVisibility(.hidden, for: .navigationBar)
        .background { Wall() }
        .safeAreaBar(edge: .bottom) {
            Button(action: leave) {
                Image(systemName: "checkmark")
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Color.onMark)
                    .frame(width: 84, height: 84)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(.mark).interactive(), in: .circle)
            .accessibilityLabel(Text("Enregistrer et fermer"))
            .accessibilityIdentifier("summary-close")
            .frame(maxWidth: .infinity)
            .padding(.bottom, 4)
        }
        // A pull down closes it as a sheet would, and saves as the ✓ does.
        .simultaneousGesture(
            DragGesture(minimumDistance: 30).onEnded { drag in
                if drag.translation.height > 140, abs(drag.translation.width) < 80 { leave() }
            })
        .interactiveDismissDisabled(false)
        .onAppear { arrived = true }
        // The system may close the cover itself (its zoom has a pull of its own): leave all the same.
        .onDisappear { leave() }
        .sensoryFeedback(.success, trigger: arrived)
        .sensoryFeedback(.error, trigger: failures)
    }

    private var titleCard: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(SessionText.title(summary.code, name: summary.name))
                    .font(.displayCard)
                    .foregroundStyle(.ink)
                    .accessibilityAddTraits(.isHeader)
                Text("Faite · \(Self.duration(summary.duration))")
                    .font(.headline)
                    .foregroundStyle(.muted)
            }
            Spacer(minLength: 8)
            // A finish mark, not a control: the ✓ at the foot is the one way out.
            Image(systemName: "flag.checkered")
                .font(.title.weight(.semibold))
                .foregroundStyle(.ink)
                .symbolEffect(.bounce, value: arrived)
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                .accessibilityHidden(true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface, in: .rect(cornerRadius: 22))
    }

    private var effortCard: some View {
        let effort = Binding<Int?>(get: { summary.effort }, set: giveEffort)
        return VStack(alignment: .leading, spacing: 10) {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline) { effortHead(effort.wrappedValue) }
                VStack(alignment: .leading, spacing: 4) { effortHead(effort.wrappedValue) }
            }
            EffortSteps(value: effort)
        }
        .padding(16)
        .background(Color.surface, in: .rect(cornerRadius: 22))
    }

    @ViewBuilder private func effortHead(_ effort: Int?) -> some View {
        Text("Intensité").font(.headline).foregroundStyle(.ink)
        Spacer(minLength: 8)
        Group {
            if let effort {
                Text(EffortText.word(effort)).font(.headline).foregroundStyle(.ink)
            } else {
                Text("facultatif").font(.subheadline).foregroundStyle(.muted)
            }
        }
        .contentTransition(.numericText())
    }

    private func tile(_ title: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(.muted)
            Text(value)
                .font(.displayStat)
                .monospacedDigit()
                .foregroundStyle(.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface, in: .rect(cornerRadius: 22))
        .accessibilityElement(children: .combine)
    }

    private func leave() {
        guard !left else { return }
        left = close(note)
        if !left { failures += 1 }
    }

    /// « 2 605 », whole kilograms.
    private static func volume(_ kg: Double) -> String {
        kg.formatted(.number.precision(.fractionLength(0)))
    }

    /// « 48 min », « 1 h 5 min ».
    private static func duration(_ seconds: TimeInterval) -> String {
        Duration.seconds(Int(seconds)).formatted(
            .units(allowed: [.hours, .minutes], width: .abbreviated, zeroValueUnits: .hide))
    }
}
