import BelayCore
import SwiftUI

/// The set due, one card: where it sits in the session (a tap opens the programme), the
/// exercise, one bar per work set, « Série k sur K » or « Montée », the load as the main figure
/// and one line comparing it with last time.
struct SetCard: View {
    let state: SessionState
    let due: DueSet
    let training: TrainingModel
    let actions: CoverActions
    let openProgramme: () -> Void
    @State private var choosing = false
    @State private var typing = false
    @State private var typed = ""
    @State private var detail = false
    @State private var note = false

    var body: some View {
        SessionCard {
            VStack(alignment: .leading, spacing: 6) {
                ProgrammeHeader(index: state.exerciseIndex, count: state.exerciseCount, open: openProgramme)
                HStack(alignment: .firstTextBaseline) {
                    Text(verbatim: training.exerciseName(due.exerciseId))
                        .font(.title2.weight(.bold))
                        .foregroundStyle(.ink)
                    Spacer(minLength: 4)
                    if state.note != nil {
                        Button { note = true } label: {
                            Image(systemName: "note.text").font(.title3).foregroundStyle(.ink)
                                .frame(width: 44, height: 44).contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Note", tableName: "Session"))
                    }
                }
                WorkBars(bars: state.bars)
            }
            Rectangle().fill(Color.line).frame(height: 0.5).padding(.vertical, 16)
            Text(SetText.title(due))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.muted)
                .accessibilityIdentifier("set-title")
            load
            progression
        }
        .sheet(isPresented: $note) { NoteSheet(slotIndex: due.place.slotIndex, actions: actions) }
        .alert(Text("Autre charge", tableName: "Session"), isPresented: $typing) {
            TextField(text: $typed) { Text("Charge en kg", tableName: "Session") }
                .keyboardType(.decimalPad)
            Button { take(typed) } label: { Text("OK", tableName: "Session") }
            Button(role: .cancel) {} label: { Text("Annuler", tableName: "Session") }
        }
    }

    private var load: some View {
        Button { choosing = true } label: {
            HStack(alignment: .lastTextBaseline, spacing: 8) {
                Text(verbatim: SetText.kg(due.weightKg))
                    .font(.custom(Font.archivoName, size: 72, relativeTo: .largeTitle))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                    .contentTransition(.numericText(value: due.weightKg))
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                Text(verbatim: "kg").font(.title2.weight(.semibold)).foregroundStyle(.muted)
                Image(systemName: "chevron.up.chevron.down").font(.headline).foregroundStyle(.muted)
                    .accessibilityHidden(true)
            }
            .dynamicTypeSize(...DynamicTypeSize.xxLarge)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Charge, \(SetText.kg(due.weightKg)) kilos", tableName: "Session"))
        .accessibilityIdentifier("load")
        .popover(isPresented: $choosing, arrowEdge: .top) {
            LoadChoices(
                weightKg: due.weightKg,
                incrementKg: TrainingModel.library.exercise(due.exerciseId)?.incrementKg ?? 2.5,
                choose: { kg in
                    choosing = false
                    actions.run { try $0.choose(weightKg: kg, count: nil) }
                },
                other: {
                    choosing = false
                    typed = ""
                    typing = true
                })
                .presentationCompactAdaptation(.popover)
        }
    }

    /// A load typed with a comma or a point, within the contract's bounds; anything else is let go.
    private func take(_ text: String) {
        guard let kg = SetText.parseKg(text), (Bounds.setKgMin...Bounds.setKgMax).contains(kg) else { return }
        actions.run { try $0.choose(weightKg: kg, count: nil) }
    }

    private var progression: some View {
        Button { detail = true } label: {
            HStack(spacing: 8) {
                Image(systemName: "arrow.up.right").font(.subheadline.weight(.bold)).accessibilityHidden(true)
                Text(SetText.progression(due.progression, timed: due.timed))
                    .font(.headline)
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "info.circle").font(.subheadline).foregroundStyle(.muted).accessibilityHidden(true)
            }
            .foregroundStyle(.ink)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("progression")
        .accessibilityHint(Text("Détail de la dernière fois", tableName: "Session"))
        .popover(isPresented: $detail, arrowEdge: .bottom) {
            VStack(alignment: .leading, spacing: 6) {
                let groups = training.lastTime(exerciseId: due.exerciseId, timed: due.timed)
                if groups.isEmpty {
                    Text("Pas encore de dernière fois pour cet exercice.", tableName: "Session")
                } else {
                    Text("La dernière fois\u{202F}: \(SetText.groups(groups, timed: due.timed))", tableName: "Session")
                        .font(.subheadline.weight(.semibold))
                }
            }
            .font(.subheadline)
            .foregroundStyle(.ink)
            .padding(16)
            .frame(maxWidth: 290, alignment: .leading)
            .fixedSize(horizontal: false, vertical: true)
            .presentationCompactAdaptation(.popover)
        }
    }
}

/// « Exercice n sur N ☰ »: one tap opens the whole session.
struct ProgrammeHeader: View {
    let index: Int
    let count: Int
    let open: () -> Void

    var body: some View {
        Button(action: open) {
            HStack(spacing: 6) {
                Text("Exercice \(index + 1) sur \(count)", tableName: "Session").font(.footnote.weight(.semibold))
                Image(systemName: "list.bullet").font(.footnote.weight(.semibold)).accessibilityHidden(true)
                Spacer(minLength: 0)
            }
            .foregroundStyle(.muted)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Exercice \(index + 1) sur \(count), voir le programme", tableName: "Session"))
        .padding(.vertical, -10)
    }
}

/// One bar per work set of the exercise: done, current, to come. The title above says it in words.
struct WorkBars: View {
    let bars: [BarState]

    var body: some View {
        HStack(spacing: 4) {
            ForEach(bars.indices, id: \.self) { i in
                Capsule()
                    .fill(color(bars[i]))
                    .frame(height: 4)
            }
        }
        .padding(.top, 4)
        .accessibilityHidden(true)
    }

    private func color(_ bar: BarState) -> Color {
        switch bar {
        case .done: .ink
        case .current: .muted
        case .toCome: .line
        }
    }
}

/// A card on the wall: text never sits on the cracks.
struct SessionCard<Content: View>: View {
    var padding: CGFloat = 20
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.surface, in: .rect(cornerRadius: 26))
    }
}

/// How a set reads on the cover, on screen and to VoiceOver.
enum SetText {
    /// « 62,5 », in the person's language.
    static func kg(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }

    /// A load typed with a comma or a point.
    static func parseKg(_ text: String) -> Double? {
        Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
    }

    /// « 60 kg × 8 », or « 30 s » for a hold with no added load.
    static func load(_ weightKg: Double, _ counts: some StringProtocol, timed: Bool) -> String {
        if timed && weightKg == 0 { return "\(counts)\u{202F}s" }
        return "\(kg(weightKg))\u{202F}kg × \(counts)\(timed ? "\u{202F}s" : "")"
    }

    /// « 62,5 kg × 8, 8, 7, 6 », the groups of equal loads one after the other.
    static func groups(_ groups: [LoadGroup], timed: Bool) -> String {
        groups.map { load($0.weightKg, $0.counts.map(String.init).joined(separator: ", "), timed: timed) }
            .joined(separator: " · ")
    }

    /// « Série 2 sur 4 », « Montée 1 sur 2 », or « Série 5 » for a set past the plan.
    static func title(_ due: DueSet) -> String {
        if due.warmup { return String(localized: "Montée \(due.number) sur \(due.of)", table: "Session") }
        if due.added { return String(localized: "Série \(due.number)", table: "Session") }
        return String(localized: "Série \(due.number) sur \(due.of)", table: "Session")
    }

    /// The line under the load, in one plain sentence; it never suggests a load to come.
    static func progression(_ line: Progression, timed: Bool) -> String {
        switch line {
        case .warmup:
            String(localized: "Montée légère, sans forcer", table: "Session")
        case .sameLoad(let top):
            String(localized: "Même charge, vise \(top) reps", table: "Session")
        case .heavier(let byKg):
            String(localized: "+\(kg(byKg))\u{202F}kg depuis la dernière fois", table: "Session")
        case .firstTime(let low, let high) where timed:
            String(localized: "Cible\u{202F}: \(low) à \(high)\u{202F}s", table: "Session")
        case .firstTime(let low, let high):
            String(localized: "Cible\u{202F}: \(low) à \(high) reps", table: "Session")
        case .holdLonger(let bySeconds, let last):
            String(localized: "+\(bySeconds)\u{202F}s sur la dernière fois (\(last)\u{202F}s)", table: "Session")
        case .holdSame(let last):
            String(localized: "Comme la dernière fois\u{202F}: \(last)\u{202F}s", table: "Session")
        }
    }
}
