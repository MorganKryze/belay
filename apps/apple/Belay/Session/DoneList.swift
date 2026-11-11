import BelayCore
import SwiftUI

/// « Faites »: the exercise's done sets, warm-ups first. The count just logged flies here from the
/// ruler; a tap on a row opens its correction. At the largest sizes a row goes on two lines.
struct DoneList: View {
    let sets: [DoneSet]
    /// The set whose reserve the foot asks: its RIR shows once answered.
    let asking: DoneSet?
    let actions: CoverActions
    let space: Namespace.ID
    let reduce: Bool
    @Environment(\.dynamicTypeSize) private var type
    @State private var correcting: DoneSet?

    var body: some View {
        SessionCard(padding: 16) {
            Text("Faites", tableName: "Session")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.muted)
                .padding(.bottom, 4)
            ForEach(Array(sets.enumerated()), id: \.element.id) { i, set in
                if i > 0 { Rectangle().fill(Color.line).frame(height: 0.5) }
                row(set)
            }
        }
        .sheet(item: $correcting) { set in CorrectSheet(set: set, actions: actions) }
    }

    private func row(_ set: DoneSet) -> some View {
        let layout = type.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 12))
        let number = sets.filter { $0.warmup == set.warmup && $0.place.position <= set.place.position }.count
        let title = set.warmup
            ? String(localized: "Montée \(number)", table: "Session")
            : String(localized: "Série \(number)", table: "Session")
        let shownRIR = set.rir.flatMap { !set.warmup && set.id != asking?.id ? $0 : nil }
        let rir = shownRIR.map { String(localized: "RIR \($0 == Bounds.rirMax ? "\($0)+" : String($0))", table: "Session") }
        let spoken = [title, SetText.load(set.weightKg, String(set.count), timed: set.timed), rir]
        return Button { correcting = set } label: {
            layout {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.circle.fill").font(.title3).foregroundStyle(.ink)
                        .accessibilityHidden(true)
                    Text(verbatim: title)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.ink)
                }
                if !type.isAccessibilitySize { Spacer(minLength: 8) }
                HStack(spacing: 4) {
                    if !(set.timed && set.weightKg == 0) {
                        Text("\(SetText.kg(set.weightKg))\u{202F}kg ×", tableName: "Session")
                            .font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
                    }
                    Text(verbatim: set.timed ? "\(set.count)\u{202F}s" : String(set.count))
                        .font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
                        .modifier(InFlight(id: Self.flightId(set.place), space: space, reduce: reduce))
                    if let rir {
                        Text(verbatim: rir)
                            .font(.subheadline).monospacedDigit().foregroundStyle(.muted)
                            .padding(.leading, 6)
                            .transition(.opacity)
                    }
                }
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: spoken.compactMap { $0 }.joined(separator: ", ")))
        .accessibilityAddTraits(.isButton)
        .accessibilityHint(Text("Corriger ou supprimer", tableName: "Session"))
        .accessibilityIdentifier("done-\(set.place.slotIndex)-\(set.place.position)")
        .removableSet(set, actions: actions)
    }

    /// The id the ruler's figure and the row's count share while the count flies.
    static func flightId(_ place: SetPlace) -> String { "count-\(place.slotIndex)-\(place.position)" }
}
