import SwiftUI

/// The five domains a figure belongs to, each with a pale tint to sit on and a shade for the
/// words and the icon on it, the same values as the web's. They say where something belongs,
/// never that it can be tapped.
enum Domain: String {
    case session, body, activity, intake, rest

    var tint: Color {
        switch self {
        case .session: .sessionTint
        case .body: .bodyTint
        case .activity: .activityTint
        case .intake: .intakeTint
        case .rest: .restTint
        }
    }

    var shade: Color {
        switch self {
        case .session: .sessionShade
        case .body: .bodyShade
        case .activity: .activityShade
        case .intake: .intakeShade
        case .rest: .restShade
        }
    }
}

/// A domain named by its words and its symbol on the domain's tint. A label, not a control: the
/// words carry the meaning, so the colour is never the only sign and the symbol stays silent.
struct DomainChip: View {
    let domain: Domain
    let text: String
    let symbol: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .imageScale(.small)
                .accessibilityHidden(true)
            Text(text)
                .monospacedDigit()
                .contentTransition(reduceMotion ? .identity : .numericText())
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(domain.shade)
        .padding(.horizontal, 8)
        .padding(.vertical, 3)
        .background(domain.tint, in: .capsule)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("chip.\(domain.rawValue)")
    }
}
