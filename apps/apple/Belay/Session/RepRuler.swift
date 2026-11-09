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
    private let step: CGFloat = 50

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
                            mark(n).id(n)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollIndicators(.hidden)
                .scrollTargetBehavior(.viewAligned)
                .scrollPosition(id: Binding(get: { value }, set: { if let n = $0 { value = n } }), anchor: .center)
                .contentMargins(.horizontal, max(0, (box.size.width - step) / 2), for: .scrollContent)
                // The lens: the count under it is the answer.
                Text(value, format: .number)
                    .font(.custom(Font.archivoName, size: 30, relativeTo: .title))
                    .monospacedDigit()
                    .foregroundStyle(Color.ink)
                    .contentTransition(reduce ? .opacity : .numericText(value: Double(value)))
                    .modifier(InFlight(id: flightId, space: space, reduce: reduce))
                    .frame(width: step + 6, height: 62)
                    .background(Color.surface, in: .rect(cornerRadius: 18))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.ink, lineWidth: 2))
                    .allowsHitTesting(false)
            }
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
        .frame(width: step, height: 62)
        .visualEffect { content, proxy in
            let width = proxy.bounds(of: .scrollView)?.width ?? 300
            let distance = min(abs(proxy.frame(in: .scrollView).midX - width / 2) / (step * 2.5), 1)
            return content.opacity(1 - 0.18 * distance).scaleEffect(1 - 0.2 * distance)
        }
    }
}
