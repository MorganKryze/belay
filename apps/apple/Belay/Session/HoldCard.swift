import BelayCore
import SwiftUI

/// A timed set: its target before the hold, the ring while it runs, the seconds held after.
struct HoldCard: View {
    let phase: SessionPhase

    var body: some View {
        SessionCard { Color.clear.frame(height: 120) }
    }
}
