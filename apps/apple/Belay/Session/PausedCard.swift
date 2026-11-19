import BelayCore
import SwiftUI

/// The session paused: its time standing still, and the rest left, standing still too unless this
/// phone lets the rest run through a pause.
struct PausedCard: View {
    let paused: Paused
    /// Where the rest runs to while paused; nil when the pause stops it.
    let restRunsTo: Date?
    let reduce: Bool

    var body: some View {
        SessionCard {
            Image(systemName: "pause.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.ink)
                .symbolEffect(.pulse, isActive: !reduce)
                .accessibilityHidden(true)
            Text("En pause", tableName: "SessionEnd")
                .font(.custom(Font.archivoName, size: 44, relativeTo: .largeTitle))
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 10)
                .accessibilityAddTraits(.isHeader)
            Text("Séance arrêtée à \(clockText(ms: paused.elapsedMs))", tableName: "SessionEnd")
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            if paused.restLeftMs != nil, let end = restRunsTo {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    let left = max(0, Int(end.timeIntervalSince(context.date).rounded(.up)))
                    Text("Le repos continue\u{202F}: \(RestCard.clock(left))", tableName: "Reglages")
                        .font(.subheadline)
                        .monospacedDigit()
                        .foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("paused-rest")
                }
            } else if let left = paused.restLeftMs {
                Text("Repos arrêté à \(RestCard.clock(max(0, Int((Double(left) / 1000).rounded(.up)))))", tableName: "SessionEnd")
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
