import BelayCore
import SwiftUI

/// The session paused: its time and the rest left, standing still.
struct PausedCard: View {
    let paused: Paused
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
            if let left = paused.restLeftMs {
                Text("Repos arrêté à \(RestCard.clock(max(0, Int((Double(left) / 1000).rounded(.up)))))", tableName: "SessionEnd")
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}
