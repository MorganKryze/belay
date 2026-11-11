import BelayActivity
import BelayCore
import SwiftUI
import os

@main
struct BelayApp: App {
    @State private var account: AccountModel
    /// Lives as long as the app: a lock-screen tap may launch it in the background, with no scene.
    @State private var activity: LiveActivityController
    @Environment(\.scenePhase) private var scenePhase

    init() {
        DisplayType.register()
        DisplayType.styleBars()
        let account = Self.launchAccount()
        _account = State(initialValue: account)
        // Set before any intent runs: iOS runs the lock screen's buttons in this process.
        LockScreen.install(StoreLockScreen(account: account))
        _activity = State(initialValue: LiveActivityController(account: account))
    }

    /// The person's account; in a debug build, the UI tests' fixture when the launch asks for it.
    private static func launchAccount() -> AccountModel {
        #if DEBUG
            if let fixture = Fixture.account() { return fixture }
        #endif
        return AccountModel()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if case .signedIn = account.state {
                    if let store = account.store {
                        // Another account's store is another shell: nothing of the last one stays.
                        RootView(store: store, account: account).id(ObjectIdentifier(store))
                    } else {
                        StoreProblemView(account: account)
                    }
                } else {
                    SignInView(account: account)
                }
            }
            #if DEBUG
                .overlay(alignment: .topLeading) {
                    if Fixture.isOn, let store = account.store {
                        Fixture.QueueProbe(store: store)
                        Fixture.SummaryProbe(store: store)
                    }
                }
                .environment(\.contrastIncreased, Fixture.contrastIncreased)
            #endif
            .task { await account.finishSignIn() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { account.refresh() }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIContentSizeCategory.didChangeNotification)) { _ in
                DisplayType.styleBars()
            }
        }
    }
}

/// Signed in, but the account's records did not open on this phone: one sentence and a retry.
private struct StoreProblemView: View {
    let account: AccountModel

    var body: some View {
        // On a solid row: body text never sits on the wall.
        List {
            Text("Tes séances ne s’ouvrent pas sur ce téléphone. Réessaie.", tableName: "Account")
                .foregroundStyle(.ink)
                .listRowBackground(Color.surface)
        }
        .belayList()
        .safeAreaBar(edge: .bottom) {
            FootBar {
                PrimaryButton(title: "Réessayer", place: .foot, tableName: "Account", action: account.openStore)
                    .accessibilityIdentifier("store-retry")
            }
        }
    }
}

/// The lock screen's buttons, on the signed-in account's own store: the one the screens use, so
/// a tap and the screen never write through two connections. No account open, nothing written.
private nonisolated struct StoreLockScreen: LockScreenHandler {
    let account: AccountModel

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "lock-screen")

    func logShown(workoutId: String, place: SetPlace) async -> Bool {
        await run { try LockScreenActions.logShown(place, workoutId: workoutId, using: $0) }
    }

    func addThirty(workoutId: String) async -> Bool {
        await run { try LockScreenActions.addThirty(workoutId: workoutId, using: $0) }
    }

    @MainActor private func run(_ write: (SessionActions) throws -> Bool) -> Bool {
        guard let store = account.store else { return false }
        let actions = SessionActions(
            store: store, library: BundledLibrary.library, now: { Date() }, newId: { UUIDv7.make(at: $0) })
        do {
            let wrote = try write(actions)
            if wrote { account.didWrite() }
            return wrote
        } catch {
            Self.log.error("lock-screen write failed: \(AccountStore.logLabel(error), privacy: .public)")
            return false
        }
    }
}
