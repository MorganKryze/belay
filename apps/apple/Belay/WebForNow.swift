import SwiftUI

/// The stand-in for a tab that is not built natively yet: it says so plainly and opens the
/// person's instance in Safari, at its home screen. It never shows sample numbers, weights are sensitive.
struct WebForNow: View {
    let tab: AppTab

    var body: some View {
        VStack(spacing: 20) {
            BelayMark()
                .stroke(Color.muted, style: BelayMark.strokeStyle(side: 72))
                .frame(width: 72, height: 72)
                .accessibilityHidden(true)
            Text("Cet écran est sur le web pour l’instant.")
                .font(.headline)
                .foregroundStyle(.ink)
                .multilineTextAlignment(.center)
            if let url = StoredInstance.url {
                Link(destination: url) {
                    Text("Ouvrir sur le web")
                        .font(.headline)
                        .foregroundStyle(.onMark)
                        .padding(.horizontal, 20)
                        .frame(minHeight: 48)
                        .background(Color.mark, in: .capsule)
                }
            }
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background { Wall() }
        .navigationTitle(tab.title)
    }
}

/// The address of the person's instance, as the web app keeps it: origin only, under one key.
enum StoredInstance {
    static let key = "belay.instance"

    static var url: URL? {
        guard let text = UserDefaults.standard.string(forKey: key),
              let url = URL(string: text),
              url.scheme == "https", url.host() != nil
        else { return nil }
        return url
    }
}
