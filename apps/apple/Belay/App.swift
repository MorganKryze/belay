import SwiftUI

@main
struct BelayApp: App {
    @State private var account = AccountModel()

    init() {
        DisplayType.register()
        DisplayType.styleBars()
    }

    var body: some Scene {
        WindowGroup {
            Group {
                if case .signedIn = account.state {
                    RootView()
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
