import SwiftUI

@main
struct BelayApp: App {
    @State private var account = AccountModel()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        DisplayType.register()
        DisplayType.styleBars()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if case .signedIn = account.state {
                    if account.store == nil {
                        StoreProblemView(account: account)
                    } else {
                        RootView()
                            .safeAreaInset(edge: .top, spacing: 0) {
                                SyncNotice(status: account.syncStatus) {
                                    Task { await account.reconnect() }
                                }
                            }
                    }
                } else {
                    SignInView(account: account)
                }
            }
            .task { await account.finishRestore() }
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
