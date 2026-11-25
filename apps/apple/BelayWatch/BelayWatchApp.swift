import SwiftUI

@main
struct BelayWatchApp: App {
    var body: some Scene {
        WindowGroup {
            FirstScreen()
        }
    }
}

/// What the watch shows before it holds the iPhone's session: the mark and where to go next.
struct FirstScreen: View {
    private let markSide: CGFloat = 44

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ZStack {
                    BelayMark(.ring).stroke(.primary, style: BelayMark.strokeStyle(side: markSide))
                    BelayMark(.mountain).stroke(.blue, style: BelayMark.strokeStyle(side: markSide))
                }
                .frame(width: markSide, height: markSide)
                .accessibilityIdentifier("belay-mark")
                .accessibilityHidden(true)

                Text("Ouvre Belay sur ton iPhone", tableName: "Watch")
                    .font(.headline)
                Text("Ta montre se connecte avec la session de ton iPhone.", tableName: "Watch")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
        }
        .background(.black)
    }
}
