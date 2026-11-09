import BelayCore
import SwiftUI

/// The session paused: its time and the rest left, standing still.
struct PausedCard: View {
    let paused: Paused

    var body: some View {
        SessionCard { Color.clear.frame(height: 120) }
    }
}
