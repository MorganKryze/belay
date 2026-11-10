import BelayCore
import SwiftUI

/// The bar while a session runs: lower on the left, the session's clock in the middle, pause on
/// the right. Stopping lives in the pause: ⏸ turns into a light red ■ that asks first.
struct SessionBar: ToolbarContent {
    let state: SessionState
    let lower: () -> Void
    let pause: () -> Void
    /// What ■ asks, and what its answers do.
    let stop: StopAsk

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
                StopButton(ask: stop)
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

/// What ■ needs to ask: the work sets noted against the plan, whether any set at all is stored,
/// and the two ways out.
struct StopAsk {
    let done: Int
    let planned: Int
    /// A warm-up counts: a session that holds one is ended, not dropped.
    let holdsSets: Bool
    let stop: () -> Void
    /// Drops the session; false when a set was stored in the meantime and it was kept.
    let leave: () -> Bool
}

/// ■ and the system alert it opens: with sets noted, the web's sentence and « Arrêter », which
/// ends the session onto its summary; with none, the web's « Quitter sans enregistrer ».
private struct StopButton: View {
    let ask: StopAsk
    @State private var asking = false

    var body: some View {
        Button { asking = true } label: {
            Label { Text("Arrêter la séance", tableName: "Session") } icon: {
                Image(systemName: "stop.fill").foregroundStyle(StopInk.color)
            }
        }
        .tint(StopInk.color)
        .alert(title, isPresented: $asking) {
            if ask.holdsSets {
                Button(role: .destructive, action: ask.stop) { Text("Arrêter", tableName: "SessionEnd") }
                Button(role: .cancel) {} label: { Text("Annuler", tableName: "SessionEnd") }
            } else {
                Button(role: .destructive, action: leave) { Text("Quitter sans enregistrer", tableName: "SessionEnd") }
                Button(role: .cancel) {} label: { Text("Continuer la séance", tableName: "SessionEnd") }
            }
        } message: {
            if ask.holdsSets {
                Text(verbatim: StopSentence.text(done: ask.done, planned: ask.planned))
            } else {
                Text("Si tu quittes, cette séance ne sera pas gardée. Tu pourras la commencer plus tard.", tableName: "SessionEnd")
            }
        }
    }

    private var title: Text {
        ask.holdsSets
            ? Text("Arrêter la séance\u{202F}?", tableName: "SessionEnd")
            : Text("Rien n’est noté pour l’instant", tableName: "SessionEnd")
    }

    /// A set stored since the alert opened keeps the session: the alert asks again, now as the
    /// one that ends it.
    private func leave() {
        guard !ask.leave() else { return }
        Task {
            try? await Task.sleep(for: .milliseconds(400))
            asking = true
        }
    }
}

/// The web's sentence: the work sets noted out of the plan's, then those left that will not be
/// saved, and that the program does not change.
enum StopSentence {
    static func text(done: Int, planned: Int) -> String {
        let left = max(0, planned - done)
        let noted = String(localized: "\(done) séries notées sur \(done + left).", table: "SessionEnd")
        let rest =
            left > 0
            ? String(localized: "Les \(left) autres ne seront pas enregistrées\u{202F}; ton programme ne change pas.", table: "SessionEnd")
            : String(localized: "Ton programme ne change pas.", table: "SessionEnd")
        return "\(noted) \(rest)"
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
