import SwiftUI

/// The running session, closed: it sits above the tab bar, moves beside the minimised tab button,
/// and a tap opens the cover again.
struct ResumeAccessory: View {
    let session: OpenSession
    let action: () -> Void
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    @Environment(\.dynamicTypeSize) private var typeSize

    /// « Série 3 sur 4 · Séance A », or « En cours » once every planned set is done.
    private var line: String {
        session.current.map { SessionText.setLine($0, code: session.code) } ?? String(localized: "En cours")
    }

    private var spoken: String {
        let what = session.current.map { "\($0.exercise), \(line)" }
            ?? SessionText.title(session.code, name: session.name)
        return String(localized: "Reprendre la séance, \(what)")
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(session.current?.exercise ?? SessionText.title(session.code, name: session.name))
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.ink)
                        .lineLimit(1)
                    // The accessory keeps the bar's height: at the largest sizes one line fits whole.
                    if placement != .inline && !typeSize.isAccessibilitySize {
                        Text(line)
                            .font(.caption)
                            .foregroundStyle(.muted)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                Label {
                    // The system counts the seconds itself, so no timer runs in the app for it.
                    Text(timerInterval: session.startedAt ... .distantFuture, countsDown: false)
                        .monospacedDigit()
                } icon: {
                    Image(systemName: "stopwatch")
                        .foregroundStyle(.muted)
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.ink)
                .labelStyle(.titleAndIcon)
            }
            .padding(.horizontal, 16)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        // Capped as the tab bar's own labels are, so the title and the time are never cut; the
        // card above carries the session at full size.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityLabel(spoken)
        .accessibilityIdentifier("resume-accessory")
    }
}
