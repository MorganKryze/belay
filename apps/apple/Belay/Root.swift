import SwiftUI

enum AppTab: String, Hashable, CaseIterable {
    case home, seances, corps, outils

    var title: LocalizedStringKey {
        switch self {
        case .home: "Accueil"
        case .seances: "Séances"
        case .corps: "Corps"
        case .outils: "Outils"
        }
    }

    var symbol: String {
        switch self {
        case .home: "house"
        case .seances: "dumbbell"
        case .corps: "scalemass"
        case .outils: "wrench.and.screwdriver"
        }
    }
}

/// Where a tab can push to. No screen is native yet, so nothing can be pushed; each native screen
/// adds its case here, with the destination that shows it.
enum Route: Hashable {}

/// The tab in front and what each tab has pushed, kept across tab switches.
@MainActor @Observable
final class ShellModel {
    var tab: AppTab = .home
    var paths: [AppTab: [Route]] = [:]
}

struct RootView: View {
    @State private var model = ShellModel()
    @Namespace private var space

    var body: some View {
        TabView(selection: $model.tab) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Tab(value: tab) {
                    NavigationStack(path: path(of: tab)) {
                        WebForNow(tab: tab)
                    }
                } label: {
                    tabLabel(tab)
                }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory(isEnabled: false) {
            ResumeAccessory()
                .matchedTransitionSource(id: Morph.accessory, in: space)
        }
        .environment(\.zoomSpace, space)
        .tint(.ink)
    }

    private func path(of tab: AppTab) -> Binding<[Route]> {
        Binding(
            get: { model.paths[tab] ?? [] },
            set: { model.paths[tab] = $0 }
        )
    }

    /// The tab bar stays in ink, so colour cannot say which tab is active: the filled symbol does,
    /// outlines on the others.
    private func tabLabel(_ tab: AppTab) -> some View {
        Label(tab.title, systemImage: model.tab == tab ? "\(tab.symbol).fill" : tab.symbol)
            .environment(\.symbolVariants, .none)
    }
}

/// Names of the elements a zoom starts from and lands on.
enum Morph {
    static let accessory = "accessory"
}
