import BelayCore
import SwiftUI

/// A done set, to correct or remove.
struct CorrectSheet: View {
    let set: DoneSet
    let actions: CoverActions

    var body: some View {
        NavigationStack { Color.clear }
    }
}

extension View {
    /// A done row that a swipe removes, where the system offers it.
    func removableSet(_ set: DoneSet, actions: CoverActions) -> some View {
        self
    }
}
