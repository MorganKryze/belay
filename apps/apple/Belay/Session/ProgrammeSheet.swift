import BelayCore
import SwiftUI

/// The whole session, opened from the card's header.
struct ProgrammeSheet: View {
    let state: SessionState
    let actions: CoverActions

    var body: some View {
        NavigationStack { Color.clear }
            .presentationDetents([.medium, .large])
            .accessibilityIdentifier("programme-sheet")
    }
}
