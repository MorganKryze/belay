import SwiftUI

/// The big figure of Accueil, Corps and the summary: the display face, tabular, its size relative to
/// Large Title. It turns over through the system's numeric transition, in place under Reduce Motion.
struct Figure: View {
    let text: String
    var value: Double = 0
    var unit: String? = nil
    var font: Font = .displayFigure
    var unitFont: Font = .title3.weight(.semibold)
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(text)
                .font(font)
                .monospacedDigit()
                .contentTransition(reduceMotion ? .identity : .numericText(value: value))
                .foregroundStyle(.ink)
            if let unit {
                Text(unit)
                    .font(unitFont)
                    .foregroundStyle(.muted)
            }
        }
        .animation(reduceMotion ? nil : .snappy, value: text)
        .lineLimit(1)
        .minimumScaleFactor(0.4)
        .thinsUnderBar()
    }
}

/// « dans ta fourchette »: the word and the check carry the meaning, no colour judges.
struct RangePill: View {
    var text: LocalizedStringKey = "dans ta fourchette"

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: "checkmark")
                .imageScale(.small)
                .fontWeight(.bold)
                .accessibilityHidden(true)
            Text(text)
        }
        .font(.footnote.weight(.semibold))
        .monospacedDigit()
        .foregroundStyle(.ink)
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(Color.track, in: .rect(cornerRadius: 14))
    }
}

/// The one blue thing of a screen. On a card it is a solid capsule; at the foot it floats above the
/// content, so it takes the system's prominent glass.
struct PrimaryButton: View {
    enum Place { case card, foot }
    let title: LocalizedStringKey
    var place = Place.card
    /// One blue per screen: under a sheet, the sheet's own button holds it.
    var yields = false
    /// The string table the title is read from, for a screen that keeps its own.
    var tableName: String? = nil
    let action: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Group {
            switch place {
            case .card:
                Button(action: action) { label }.buttonStyle(.borderedProminent)
            case .foot:
                Button(action: action) { label }.buttonStyle(.glassProminent)
            }
        }
        .buttonBorderShape(.capsule)
        .buttonSizing(.flexible)
        .controlSize(.extraLarge)
        .tint(yields ? Color.track : Color.mark)
        .animation(reduceMotion ? nil : .smooth, value: yields)
    }

    private var label: some View {
        Text(title, tableName: tableName)
            .font(.headline)
            .foregroundStyle(yields ? Color.ink : Color.onMark)
            .multilineTextAlignment(.center)
            .contentTransition(reduceMotion ? .identity : .numericText())
            .animation(reduceMotion ? nil : .snappy, value: title)
    }
}

/// Minus and plus as two system buttons. The system Stepper stays 32 pt tall at every control size,
/// short of the 44 the rule asks; these are 48 tall, and a held button keeps counting.
struct Nudge: View {
    @Binding var value: Double
    let range: ClosedRange<Double>
    let step: Double
    /// Spoken after the verb: « Retirer 0,1 kg ».
    let what: String
    @ScaledMetric(relativeTo: .title3) private var side: CGFloat = 36

    var body: some View {
        HStack(spacing: 8) {
            button("minus", "Retirer \(what)", -step, enabled: value > range.lowerBound)
            button("plus", "Ajouter \(what)", step, enabled: value < range.upperBound)
        }
        .fixedSize()
        .sensoryFeedback(trigger: value) { old, new in new > old ? .increase : .decrease }
    }

    private func button(_ symbol: String, _ label: LocalizedStringKey, _ delta: Double, enabled: Bool) -> some View {
        Button {
            // Rounded to the tenth, so that repeated steps never drift.
            let next = ((value + delta) * 10).rounded() / 10
            value = min(range.upperBound, max(range.lowerBound, next))
        } label: {
            Image(systemName: symbol)
                .font(.title3.weight(.semibold))
                .frame(width: side, height: max(34, side - 2))
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .buttonRepeatBehavior(.enabled)
        .tint(.muted)
        .foregroundStyle(.ink)
        .disabled(!enabled)
        .accessibilityLabel(label)
    }
}

/// The foot of a finished screen: the same place and size, no blue. Nothing is left to do.
struct QuietFootButton: View {
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title).font(.headline).foregroundStyle(.ink)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.capsule)
        .buttonSizing(.flexible)
        .controlSize(.extraLarge)
    }
}

/// The foot of a pushed screen or of the cover: the action sits in thumb reach, on the system's bar.
struct FootBar<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        content
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 8)
    }
}

/// One entry of Aujourd’hui and Saisir: a name, then its state on a second line.
struct EntryRow: View {
    let symbol: String
    let title: LocalizedStringKey
    var detail: String
    var logged = false
    var value: Double? = nil
    @ScaledMetric(relativeTo: .body) private var iconWidth: CGFloat = 28
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.title3)
                .foregroundStyle(.muted)
                .frame(width: iconWidth)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.body.weight(.medium)).foregroundStyle(.ink)
                HStack(spacing: 4) {
                    if logged {
                        Image(systemName: "checkmark")
                            .font(.caption.weight(.bold))
                            .foregroundStyle(.ink)
                            .transition(.symbolEffect(.drawOn))
                    }
                    Text(detail)
                        .font(.subheadline)
                        .foregroundStyle(logged ? .ink : .muted)
                        .monospacedDigit()
                        .contentTransition(reduceMotion ? .identity : .numericText(value: value ?? 0))
                }
                .animation(reduceMotion ? nil : .snappy, value: logged)
            }
            Spacer(minLength: 0)
        }
        .contentShape(.rect)
    }
}

/// Avatar: the way to Réglages. The phone keeps no name for the person yet, so it shows a figure
/// rather than an initial; the profile comes with Réglages in full.
struct Avatar: View {
    /// The person's initial; the person symbol before the instance has named them.
    var letter: String?
    var size: CGFloat = 36
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        Group {
            if let letter {
                Text(letter)
            } else {
                Image(systemName: "person.fill")
            }
        }
        .font(.headline)
        .foregroundStyle(.ink)
        .frame(width: size * scale, height: size * scale)
        .background(Color.track, in: .circle)
    }
}
