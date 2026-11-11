import BelayCore
import SwiftUI

/// The reps on a ruler that reaches any count the contract takes, 0 to 100: it snaps on each
/// count with a tick of the hand, marks the plan's range in ink, and VoiceOver adjusts it by a
/// swipe. The count under the lens is what ✓ logs.
struct RepRuler: View {
    @Binding var value: Int
    let target: [Int]
    /// The set's place: the lens's figure flies into its done row.
    let flightId: String
    let space: Namespace.ID
    let reduce: Bool
    private static let step: CGFloat = 50
    /// Where the scale stands. The ruler's half-width sits inside the content, so count n stands
    /// under the lens at an offset of n steps whatever the ruler's width: the scale is placed once,
    /// when the ruler is made for its set, and a ruler that grows into its width keeps it in place.
    @State private var position: ScrollPosition
    /// Whether the person is moving the scale: only then does the scale set the count.
    @State private var sliding = false

    init(value: Binding<Int>, target: [Int], flightId: String, space: Namespace.ID, reduce: Bool) {
        _value = value
        self.target = target
        self.flightId = flightId
        self.space = space
        self.reduce = reduce
        _position = State(initialValue: ScrollPosition(x: CGFloat(value.wrappedValue) * Self.step))
    }

    private var range: ClosedRange<Int> {
        let low = target.first ?? 0
        return low...(target.last ?? low)
    }

    var body: some View {
        GeometryReader { box in
            ZStack {
                ScrollView(.horizontal) {
                    LazyHStack(spacing: 0) {
                        ForEach(0...Bounds.repsMax, id: \.self) { n in
                            mark(n)
                        }
                    }
                    .padding(.horizontal, max(0, (box.size.width - Self.step) / 2))
                }
                .scrollIndicators(.hidden)
                .scrollTargetBehavior(CountSnap(step: Self.step))
                .scrollPosition($position)
                .onScrollPhaseChange { _, phase in
                    sliding = phase == .tracking || phase == .interacting || phase == .decelerating
                }
                .onScrollGeometryChange(for: Int.self, of: { count(at: $0.contentOffset.x) }) { _, n in
                    if sliding, n != value { value = n }
                }
                // The lens: the count under it is the answer.
                Text(value, format: .number)
                    .font(.custom(Font.archivoName, size: 30, relativeTo: .title))
                    .monospacedDigit()
                    // Two digits stay whole in the lens at the largest text sizes.
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .foregroundStyle(Color.ink)
                    .contentTransition(reduce ? .opacity : .numericText(value: Double(value)))
                    .modifier(InFlight(id: flightId, space: space, reduce: reduce))
                    .frame(width: Self.step + 6, height: 62)
                    .background(Color.surface, in: .rect(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.ink, lineWidth: 2))
                    .allowsHitTesting(false)
            }
        }
        // A count set another way, by VoiceOver, moves the scale under it.
        .onChange(of: value) { _, n in
            if !sliding { position.scrollTo(x: CGFloat(n) * Self.step) }
        }
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement()
        .accessibilityLabel(Text("Répétitions faites", tableName: "Session"))
        .accessibilityValue(Text(value, format: .number))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: value = min(Bounds.repsMax, value + 1)
            case .decrement: value = max(0, value - 1)
            @unknown default: break
            }
        }
        .accessibilityIdentifier("rep-ruler")
    }

    /// The count under the lens at a scroll offset.
    private func count(at offset: CGFloat) -> Int {
        min(Bounds.repsMax, max(0, Int((offset / Self.step).rounded())))
    }

    private func mark(_ n: Int) -> some View {
        let inTarget = range.contains(n)
        return VStack(spacing: 6) {
            Text(n, format: .number)
                .font(.custom(Font.archivoName, size: 20, relativeTo: .title3))
                .monospacedDigit()
                .foregroundStyle(inTarget ? Color.ink : Color.muted)
            Capsule()
                .fill(inTarget ? Color.ink : Color.muted.opacity(0.6))
                .frame(width: inTarget ? 3 : 2, height: inTarget ? 14 : 8)
        }
        .frame(width: Self.step, height: 62)
        .visualEffect { content, proxy in
            let width = proxy.bounds(of: .scrollView)?.width ?? 300
            let distance = min(abs(proxy.frame(in: .scrollView).midX - width / 2) / (Self.step * 2.5), 1)
            return content.opacity(1 - 0.18 * distance).scaleEffect(1 - 0.2 * distance)
        }
    }
}

/// Stops the scale on a whole count, and a swipe goes at most a ruler's width from where it began,
/// as a view-aligned scroll does on a phone.
private struct CountSnap: ScrollTargetBehavior {
    let step: CGFloat

    func updateTarget(_ target: inout ScrollTarget, context: TargetContext) {
        let start = context.originalTarget.rect.minX
        let reach = context.containerSize.width
        let x = min(start + reach, max(start - reach, target.rect.minX))
        target.rect.origin.x = (x / step).rounded() * step
    }
}
