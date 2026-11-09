import BelayCore
import SwiftUI

/// The bar while a session runs: lower on the left, the session's clock in the middle, pause on
/// the right. Stopping lives in the pause: ⏸ turns into a light red ■ that asks first.
struct SessionBar: ToolbarContent {
    let state: SessionState
    let lower: () -> Void
    let pause: () -> Void
    /// ■ while paused; it asks before the session ends.
    let onStop: () -> Void

    var body: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(action: lower) {
                Label { Text("Réduire la séance", tableName: "Session") } icon: { Image(systemName: "chevron.down") }
            }
        }
        ToolbarItem(placement: .principal) {
            SessionClock(state: state)
        }
        ToolbarItem(placement: .topBarTrailing) {
            if state.paused {
                Button(action: onStop) {
                    Label { Text("Arrêter la séance", tableName: "Session") } icon: {
                        Image(systemName: "stop.fill").foregroundStyle(StopInk.color)
                    }
                }
                .tint(StopInk.color)
            } else {
                Button(action: pause) {
                    Label { Text("Mettre la séance en pause", tableName: "Session") } icon: {
                        Image(systemName: "pause.fill")
                    }
                }
            }
        }
    }
}

/// The session's time: counted by the system while it runs, standing still while paused.
private struct SessionClock: View {
    let state: SessionState

    var body: some View {
        Group {
            if state.paused {
                Text(verbatim: clockText(ms: state.elapsedMs))
            } else {
                Text(timerInterval: state.startedAt ... .distantFuture, countsDown: false)
            }
        }
        .font(.headline)
        .monospacedDigit()
        .foregroundStyle(.ink)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityIdentifier("session-clock")
    }
}

/// A light red that keeps 4.5:1 on the bar's glass: deeper in light, lighter in dark.
enum StopInk {
    static let color = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 1.0, green: 0.62, blue: 0.55, alpha: 1)
            : UIColor(red: 0.62, green: 0.11, blue: 0.07, alpha: 1)
    })
}
