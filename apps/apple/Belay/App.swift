import SwiftUI

@main
struct BelayApp: App {
    @State private var account = Self.launchAccount()

    init() {
        DisplayType.register()
        DisplayType.styleBars()
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
                        RootView(store: store).id(ObjectIdentifier(store))
                    } else {
                        StoreProblemView(account: account)
                    }
                } else {
                    SignInView(account: account)
                }
            }
            .task { await account.finishRestore() }
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
