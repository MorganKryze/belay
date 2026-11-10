import SwiftUI

/// A session sheet's title, at the top of its list: the sheets keep no title in their bar, so
/// nothing compact shows once they scroll and only the glass ✕ and ✓ stay over the content, as on
/// the cover and the summary.
struct SheetTitle: View {
    let title: Text
    var subtitle: Text?

    var body: some View {
        Section {
            VStack(spacing: 4) {
                title
                    .font(.custom(Font.archivoName, size: 34, relativeTo: .largeTitle))
                    .foregroundStyle(.ink)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("sheet-title")
                if let subtitle {
                    subtitle
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
        }
    }
}

extension View {
    /// No band under the bar once a sheet scrolls: the content runs under the glass buttons.
    func sheetWithoutBar() -> some View {
        scrollEdgeEffectHidden(true, for: .top)
    }
}
