import BelayCore
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

/// Where a tab can push to; each native screen adds its case here, with the destination that
/// shows it.
enum Route: Hashable {
    /// Réglages, from Accueil's avatar: for now only the way to sign out.
    case settings
}

/// The tab in front and what each tab has pushed, kept across tab switches.
@MainActor @Observable
final class ShellModel {
    var tab: AppTab = .home
    var paths: [AppTab: [Route]] = [:]
    /// The session cover, and the element its zoom opens from.
    var coverOpen = false
    var coverSource: String?
}

struct RootView: View {
    @State private var model = ShellModel()
    @State private var training: TrainingModel
    @Namespace private var space
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private let account: AccountModel
    private let store: AccountStore

    /// The account's `didWrite` follows every write the session screens make, so the sync sends it
    /// once writes pause.
    init(store: AccountStore, account: AccountModel) {
        self.account = account
        self.store = store
        _training = State(
            initialValue: TrainingModel(
                store: store, didWrite: account.didWrite, now: Date.init, timeZone: .current))
    }

    var body: some View {
        TabView(selection: $model.tab) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Tab(value: tab) {
                    NavigationStack(path: path(of: tab)) {
                        Group {
                            if tab == .home {
                                AccueilView(
                                    training: training,
                                    notice: SyncNotice(
                                        status: account.syncStatus,
                                        reconnect: { Task { await account.reconnect() } },
                                        retry: account.refresh),
                                    openCover: openCover)
                            } else {
                                WebForNow(tab: tab)
                            }
                        }
                        .navigationDestination(for: Route.self) { route in
                            switch route {
                            case .settings: ReglagesView(account: account, store: store)
                            }
                        }
                    }
                } label: {
                    tabLabel(tab)
                }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .tabViewBottomAccessory(isEnabled: training.open != nil) {
            if let open = training.open {
                ResumeAccessory(session: open) { openCover(Morph.accessory) }
                    .matchedTransitionSource(id: Morph.accessory, in: space)
            }
        }
        .environment(\.zoomSpace, space)
        .tint(.ink)
        .fullScreenCover(isPresented: $model.coverOpen) {
            SessionCover(training: training) { model.coverOpen = false }
                .zoomed(from: model.coverSource, in: space, reduceMotion: reduceMotion)
                .environment(\.zoomSpace, space)
                .tint(.ink)
        }
        // A session closed elsewhere (another device, a forgotten one) takes its cover with it; one
        // finished here keeps it for its summary.
        .onChange(of: training.open == nil) { _, closed in
            if closed && training.summary == nil { model.coverOpen = false }
        }
    }

    private func openCover(_ source: String) {
        model.coverSource = source
        model.coverOpen = true
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
    static let card = "card"
}
