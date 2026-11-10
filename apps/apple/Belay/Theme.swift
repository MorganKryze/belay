import SwiftUI
import UIKit
import CoreText

/// The bundled face is registered at launch and handed to the system bar, so the large title stays
/// the real one: it collapses, it crossfades, and the compact title stays on the system font.
enum DisplayType {
    static func register() {
        guard let url = Bundle.main.url(forResource: "ArchivoExpanded-ExtraBold", withExtension: "ttf") else { return }
        CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }

    static func styleBars() {
        guard let base = UIFont(name: Font.archivoName, size: 29) else { return }
        UINavigationBar.appearance().largeTitleTextAttributes = [
            .font: UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: base),
            .foregroundColor: UIColor(named: "Ink") ?? .label,
        ]
        // Segmented controls keep their system look and follow the text size, up to what fits.
        let rest = UIFont.preferredFont(forTextStyle: .footnote, compatibleWith: UITraitCollection(preferredContentSizeCategory: .large))
        let scaled = UIFontMetrics(forTextStyle: .footnote).scaledFont(for: rest, maximumPointSize: 20)
        UISegmentedControl.appearance().setTitleTextAttributes([.font: scaled], for: .normal)
    }
}

/// The app's background: chalk dust on a stone wall. Grouped lists and sheets stay solid, so body
/// text never sits on it. Reduced transparency and increased contrast turn it off.
struct Wall: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.contrastIncreased) private var contrastIncreased

    var body: some View {
        Group {
            if reduceTransparency || contrast == .increased || contrastIncreased {
                Color.paper
            } else {
                Image("Wall").resizable(resizingMode: .tile)
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

extension View {
    /// Native inset grouped list on the wall, with the system's scroll edge under the bars.
    func belayList(edge: ScrollEdgeEffectStyle = .soft) -> some View {
        listStyle(.insetGrouped)
            // A list that fits holds still. Its bounce read as a scroll: the tab bar shrank on the
            // pull and grew back on the spring, again at every touch, on a screen with nothing more
            // to show.
            .scrollBounceBehavior(.basedOnSize)
            .scrollContentBackground(.hidden)
            .background { Wall() }
            .listRowSeparatorTint(.line)
            .listSectionSpacing(.compact)
            .scrollEdgeEffectStyle(edge, for: .top)
    }

    /// A large title that scrolls away with the content, as a page's heading does: once it has
    /// gone, the bar keeps its buttons and shows no compact title, which would stand at the top
    /// like a web page's sticky header. The empty view takes the compact title's place; the large
    /// title, the back button's label and VoiceOver still read the navigation title. No edge
    /// effect either: the content runs to the top under the glass buttons, with no band over it.
    func largeTitleOnly() -> some View {
        toolbar {
            ToolbarItem(placement: .principal) {
                Color.clear.frame(width: 1, height: 1).accessibilityHidden(true)
            }
        }
        .scrollEdgeEffectHidden(true, for: .top)
    }

    /// The subtitle under a large title, in the toolbar's own slot: `navigationSubtitle` paints lighter
    /// than 4.5:1 on the wall.
    func belaySubtitle(_ text: String) -> some View {
        toolbar {
            ToolbarItem(placement: .largeSubtitle) {
                Text(text)
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 6)
            }
        }
    }

    /// Two lines under a large title: the session's name, then its size. A title in the wide face
    /// holds « Séance C » at any text size, where « Séance C · Fessiers + tirage léger » truncates.
    func belaySubtitle(name: String, _ text: String) -> some View {
        toolbar {
            ToolbarItem(placement: .largeSubtitle) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(name).font(.title3.weight(.semibold)).foregroundStyle(.ink)
                    Text(text).font(.subheadline).foregroundStyle(.muted).monospacedDigit()
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 6)
            }
        }
    }

    /// The system's zoom, or the plain transition under Reduce Motion.
    @ViewBuilder func zoomed(from id: String?, in space: Namespace.ID?, reduceMotion: Bool) -> some View {
        if let id, let space, !reduceMotion {
            navigationTransition(.zoom(sourceID: id, in: space))
        } else {
            self
        }
    }

    /// A big figure thins out as the scroll takes it under the bar: at this size the edge effect has
    /// no way to blur it, and it would stand as a smudge behind the bar's buttons.
    func thinsUnderBar() -> some View {
        visualEffect { content, proxy in
            content.opacity(max(0, min(1, (proxy.frame(in: .global).minY - 80) / 46)))
        }
    }

    /// The element a zoom starts from and lands on.
    @ViewBuilder func zoomSource(_ id: String, in space: Namespace.ID?, radius: CGFloat = 26) -> some View {
        if let space {
            matchedTransitionSource(id: id, in: space) { $0.background(Color.surface).clipShape(.rect(cornerRadius: radius)) }
        } else {
            self
        }
    }
}

extension EnvironmentValues {
    /// The namespace every zoom shares, from the tab root to the cover and the sheets.
    @Entry var zoomSpace: Namespace.ID?
    /// Increased contrast as the UI tests' fixture asks for it, the system setting being out of a
    /// test's reach. Read alongside `colorSchemeContrast`.
    @Entry var contrastIncreased = false
}
