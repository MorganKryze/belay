import BelayCore
import SwiftUI

/// An exercise just finished (its recap, then the next one announced) and « Tout est noté ».
/// The card keeps its place in the cover; its content comes with the exercise's end.
struct ExerciseEndCard: View {
    let state: SessionState

    var body: some View {
        SessionCard { Color.clear.frame(height: 120) }
    }
}
