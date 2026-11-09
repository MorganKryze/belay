import SwiftUI

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
/// like a slider: a tap or a drag anywhere across it picks the floor under the finger, with a
/// tick of the hand at each new floor. VoiceOver reads it as one adjustable value.
struct EffortSteps: View {
    @Binding var value: Int?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { box in
            HStack(alignment: .bottom, spacing: 4) {
                ForEach(1...5, id: \.self) { floor in
                    step(floor)
                }
            }
            .contentShape(.rect)
            .gesture(
                DragGesture(minimumDistance: 0).onChanged { drag in
                    let floor = max(1, min(5, Int(drag.location.x / max(1, box.size.width) * 5) + 1))
                    guard floor != value else { return }
                    withAnimation(reduceMotion ? nil : .snappy) { value = floor }
                })
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

    private func step(_ floor: Int) -> some View {
        let on = floor <= (value ?? 0)
        let chosen = floor == value
        return VStack(spacing: 6) {
            Spacer(minLength: 0)
            UnevenRoundedRectangle(topLeadingRadius: 8, topTrailingRadius: 8)
                .fill(on ? Color.ink : Color.muted.opacity(0.72))
                .frame(height: 16 + CGFloat(floor) * 14)
                .scaleEffect(y: chosen && !reduceMotion ? 1.05 : 1, anchor: .bottom)
            Text(EffortText.word(floor))
                .font(.caption.weight(chosen ? .bold : .medium))
                .foregroundStyle(chosen ? Color.ink : Color.muted)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .dynamicTypeSize(...DynamicTypeSize.xxLarge)
        }
        .frame(maxWidth: .infinity)
    }
}
