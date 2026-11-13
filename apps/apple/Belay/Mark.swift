import SwiftUI

/// The mark as the first launch greets with it: the ring in ink, the mountain the one blue. It
/// stands until the brand work delivers the final mark; the words beside it carry the meaning.
struct WelcomeMark: View {
    let side: CGFloat

    var body: some View {
        ZStack {
            BelayMark(.ring).stroke(Color.ink, style: BelayMark.strokeStyle(side: side))
            BelayMark(.mountain).stroke(Color.mark, style: BelayMark.strokeStyle(side: side))
        }
        .frame(width: side, height: side)
        .accessibilityHidden(true)
    }
}
