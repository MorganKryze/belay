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
    /// A session of the active program before it starts, from Accueil or Séances.
    case preview(sessionId: String)
    /// A session kept, from Séances' Historique.
    case past(workoutId: String)
}

/// The tab in front and what each tab has pushed, kept across tab switches.
@MainActor @Observable
final class ShellModel {
    var tab: AppTab = .home
    var paths: [AppTab: [Route]] = [:]
    /// Séances' segment, kept while the app runs.
    var segment = SeancesView.Segment.programme
    /// The session cover, and the element its zoom opens from.
    var coverOpen = false
    var coverSource: String?
}

struct RootView: View {
    @State private var model = ShellModel()
    @State private var box = TrainingBox()
    @Namespace private var space
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    private let account: AccountModel
    private let store: AccountStore

    /// The account's `didWrite` follows every write the session screens make, so the sync sends it
    /// once writes pause.
    init(store: AccountStore, account: AccountModel) {
        self.account = account
        self.store = store
    }

    private var training: TrainingModel {
        box.model {
            TrainingModel(
                store: store, didWrite: account.didWrite, health: account.runHealth, now: Self.clock,
                timeZone: .current)
        }
    }

    /// The phone's clock; in a debug build, the UI tests' when the launch sets one.
    private static var clock: @Sendable () -> Date {
        #if DEBUG
            if let clock = Fixture.clock { return clock }
        #endif
        return Date.init
    }

    var body: some View {
        // One stack per tab, each written out: a stack built in a loop over the tabs lost the
        // large title on the screens Séances pushed.
        TabView(selection: $model.tab) {
            Tab(value: AppTab.home) {
                stack(.home) {
                    AccueilView(
                        training: training,
                        notice: SyncNotice(
                            status: account.syncStatus,
                            reconnect: { Task { await account.reconnect() } },
                            retry: account.refresh),
                        displayName: account.displayName,
                        openPreview: { openPreview($0, in: .home) },
                        openCover: openCover)
                }
            } label: {
                tabLabel(.home)
            }
            Tab(value: AppTab.seances) {
                stack(.seances) {
                    SeancesView(
                        training: training, segment: $model.segment,
                        openPreview: { openPreview($0, in: .seances) })
                }
            } label: {
                tabLabel(.seances)
            }
            Tab(value: AppTab.corps) {
                stack(.corps) { WebForNow(tab: .corps) }
            } label: {
                tabLabel(.corps)
            }
            Tab(value: AppTab.outils) {
                stack(.outils) { WebForNow(tab: .outils) }
            } label: {
                tabLabel(.outils)
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
        // finished here keeps it for its summary. Either way its preview is done with: the cover
        // closes onto the first screen of the tab it was started from.
        // Back in front, the day may have turned while the app was away.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { training.refresh() }
        }
        .onChange(of: training.open == nil) { _, closed in
            guard closed else { return }
            for tab in AppTab.allCases {
                model.paths[tab]?.removeAll { if case .preview = $0 { true } else { false } }
            }
            if training.summary == nil { model.coverOpen = false }
        }
    }

    /// A tab's stack: its first screen, and every route it can push.
    private func stack(_ tab: AppTab, @ViewBuilder root: () -> some View) -> some View {
        NavigationStack(path: path(of: tab)) {
            root().navigationDestination(for: Route.self) { route in
                switch route {
                case .settings: ReglagesView(account: account, store: store)
                case .preview(let sessionId):
                    SessionPreview(training: training, sessionId: sessionId, openCover: openCover)
                case .past(let workoutId):
                    PastSessionView(
                        training: training,
                        model: PastSessionModel(
                            workoutId: workoutId, store: store, didWrite: account.didWrite,
                            health: account.runHealth, now: Self.clock))
                }
            }
        }
    }

    private func openPreview(_ sessionId: String, in tab: AppTab) {
        model.paths[tab, default: []].append(.preview(sessionId: sessionId))
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
    static let start = "start"
}

/// The shell's session model, built once, the first time the shell's body asks for it. Built in
/// the shell's `init`, a new one would be made at each pass of the parent's body, and its first
/// read of the store would make that body depend on it: each new model's first value would call
/// for another model, and the app would never rest.
@MainActor
private final class TrainingBox {
    private var built: TrainingModel?

    func model(_ make: () -> TrainingModel) -> TrainingModel {
        if let built { return built }
        let made = make()
        built = made
        return made
    }
}
