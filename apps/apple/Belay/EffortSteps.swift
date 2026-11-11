import SwiftUI
import UIKit

/// How hard a session felt, in five floors. Apple's effort has four words; « Soutenu » fills the
/// middle floor.
enum EffortText {
    static func word(_ floor: Int) -> String {
        switch floor {
        case ...1: String(localized: "Facile")
        case 2: String(localized: "Modéré")
        case 3: String(localized: "Soutenu")
        case 4: String(localized: "Difficile")
        default: String(localized: "Maximal")
        }
    }
}

/// The effort as five steps rising like a staircase, filled up to the chosen one. One control,
/// like a slider: a tap or a drag across it picks the floor under the finger, with a
/// tick of the hand at each new floor. VoiceOver reads it as one adjustable value.
struct EffortSteps: View {
    @Binding var value: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { box in
            VStack(spacing: 6) {
                HStack(alignment: .bottom, spacing: 4) {
                    ForEach(1...5, id: \.self) { floor in
                        step(floor)
                    }
                }
                .frame(maxHeight: .infinity, alignment: .bottom)
                // The five words at one size, the largest at which every one fits its column.
                ViewThatFits(in: .horizontal) {
                    words(upTo: .xxLarge)
                    words(upTo: .xLarge)
                    words(upTo: .large)
                    words(upTo: .medium)
                    words(upTo: .small)
                }
            }
            .contentShape(.rect)
            .onTapGesture { location in pick(location.x, width: box.size.width) }
            // Only a drag across picks: one that starts upward or downward is the page's scroll.
            .gesture(AcrossPan { x in pick(x, width: box.size.width) })
        }
        .frame(height: 112)
        .sensoryFeedback(.selection, trigger: value)
        .accessibilityElement()
        .accessibilityLabel(Text("Intensité de la séance"))
        .accessibilityValue(value.map { String(localized: "\($0) sur 5, \(EffortText.word($0))") } ?? String(localized: "non donnée"))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: value = min(5, (value ?? 0) + 1)
            case .decrement: value = max(1, (value ?? 2) - 1)
            @unknown default: break
            }
        }
        .accessibilityIdentifier("effort-steps")
    }

    private func pick(_ x: CGFloat, width: CGFloat) {
        let floor = max(1, min(5, Int(x / max(1, width) * 5) + 1))
        guard floor != value else { return }
        withAnimation(Motion.change(reduce: Motion.reduced(reduceMotion))) { value = floor }
    }

    private func step(_ floor: Int) -> some View {
        UnevenRoundedRectangle(topLeadingRadius: 8, topTrailingRadius: 8)
            .fill(floor <= (value ?? 0) ? Color.ink : Color.muted.opacity(0.72))
            .frame(height: 16 + CGFloat(floor) * 14)
            .scaleEffect(y: floor == value && !reduceMotion ? 1.05 : 1, anchor: .bottom)
            .frame(maxWidth: .infinity)
    }

    /// The words under the steps, each column as wide as the widest word, so the row fits only
    /// when every word fits whole.
    private func words(upTo size: DynamicTypeSize) -> some View {
        HStack(spacing: 4) {
            ForEach(1...5, id: \.self) { floor in
                let chosen = floor == value
                ZStack {
                    ForEach(1...5, id: \.self) { Text(EffortText.word($0)).font(.caption.weight(.bold)).hidden() }
                    Text(EffortText.word(floor))
                        .font(.caption.weight(chosen ? .bold : .medium))
                        .foregroundStyle(chosen ? Color.ink : Color.muted)
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            }
        }
        .dynamicTypeSize(...size)
    }
}

/// A pan that begins only when it moves across: one that moves up or down fails at once and
/// leaves the touch to the scroll it sits in. A SwiftUI drag in a scroll view holds the touch
/// whatever its direction.
private struct AcrossPan: UIGestureRecognizerRepresentable {
    /// The finger's x in the steps, as it moves.
    let moved: (CGFloat) -> Void

    func makeCoordinator(converter: CoordinateSpaceConverter) -> Coordinator { Coordinator() }

    func makeUIGestureRecognizer(context: Context) -> UIPanGestureRecognizer {
        let pan = UIPanGestureRecognizer()
        pan.delegate = context.coordinator
        return pan
    }

    func handleUIGestureRecognizerAction(_ pan: UIPanGestureRecognizer, context: Context) {
        guard pan.state == .began || pan.state == .changed else { return }
        moved(context.converter.localLocation.x)
    }

    final class Coordinator: NSObject, UIGestureRecognizerDelegate {
        func gestureRecognizerShouldBegin(_ recognizer: UIGestureRecognizer) -> Bool {
            guard let pan = recognizer as? UIPanGestureRecognizer else { return true }
            let velocity = pan.velocity(in: pan.view)
            return abs(velocity.x) > abs(velocity.y)
        }
    }
}
