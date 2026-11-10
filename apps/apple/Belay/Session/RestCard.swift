import BelayCore
import SwiftUI

/// The set become the clock, in the same card: « Repos », the time left to the rest's absolute
/// end, a rope that empties, what comes next, then +30 s and skip.
struct RestCard: View {
    let rest: Rest
    /// When the rest began: the latest set's time, so the rope starts full.
    let from: Date
    let training: TrainingModel
    let actions: CoverActions
    let reduce: Bool
    @Environment(\.dynamicTypeSize) private var type

    var body: some View {
        SessionCard {
            Text("Repos", tableName: "Session").font(.footnote.weight(.semibold)).foregroundStyle(.muted)
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let left = max(0, Int(rest.endsAt.timeIntervalSince(context.date).rounded(.up)))
                VStack(alignment: .leading, spacing: 0) {
                    Text(verbatim: RestCard.clock(left))
                        .font(.custom(Font.archivoName, size: 88, relativeTo: .largeTitle))
                        .monospacedDigit()
                        .foregroundStyle(.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                        .contentTransition(reduce ? .opacity : .numericText(countsDown: true))
                        .dynamicTypeSize(...DynamicTypeSize.xxLarge)
                        .accessibilityLabel(Text(verbatim: RestCard.clock(left)))
                        .accessibilityIdentifier("rest-clock")
                    Rope(fraction: Double(left) / max(1, rest.endsAt.timeIntervalSince(from)), reduce: reduce)
                        .padding(.bottom, 14)
                }
            }
            let row = type.isAccessibilitySize
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
                : AnyLayout(HStackLayout(alignment: .center, spacing: 10))
            row {
                if let next = rest.next {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Ensuite", tableName: "Session").font(.footnote).foregroundStyle(.muted)
                        Text(verbatim: RestCard.nextLine(next))
                            .font(.headline)
                            .monospacedDigit()
                            .foregroundStyle(.ink)
                    }
                    .accessibilityElement(children: .combine)
                }
                if !type.isAccessibilitySize { Spacer(minLength: 8) }
                GlassEffectContainer(spacing: 10) {
                    HStack(spacing: 10) {
                        GlassCircle(symbol: "goforward.30", id: "add-thirty") {
                            actions.run { _ = try $0.addRest(seconds: 30) }
                        }
                        .accessibilityLabel(Text("Ajouter 30 secondes", tableName: "Session"))
                        GlassCircle(symbol: "forward.end.fill", id: "skip-rest") {
                            actions.run { try $0.skipRest() }
                        }
                        .accessibilityLabel(Text("Passer le repos", tableName: "Session"))
                    }
                }
                .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            }
        }
    }

    /// « 2:05 ».
    static func clock(_ seconds: Int) -> String {
        Duration.seconds(seconds).formatted(.time(pattern: .minuteSecond))
    }

    /// « Série 2 · 62,5 kg × 8 » or « Montée · 40 kg × 5 ».
    static func nextLine(_ next: DueSet) -> String {
        let load = SetText.load(next.weightKg, String(next.count), timed: next.timed)
        return next.warmup
            ? String(localized: "Montée · \(load)", table: "Session")
            : String(localized: "Série \(next.number) · \(load)", table: "Session")
    }
}

/// A round glass control of the card, 54 points.
struct GlassCircle: View {
    let symbol: String
    let id: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.ink)
                .frame(width: 54, height: 54)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .accessibilityIdentifier(id)
    }
}

/// The app's one taut rope: ink over a slack hair, emptying as the rest runs.
struct Rope: View {
    let fraction: Double
    let reduce: Bool

    var body: some View {
        GeometryReader { box in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.line).frame(height: 2)
                Capsule().fill(Color.ink).frame(width: box.size.width * max(0, min(1, fraction)), height: 4)
                    .animation(reduce ? nil : .linear(duration: 1), value: fraction)
            }
            .frame(maxHeight: .infinity)
        }
        .frame(height: 8)
        .accessibilityHidden(true)
    }
}
