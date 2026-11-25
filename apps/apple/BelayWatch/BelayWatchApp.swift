import BelayCore
import SwiftUI

@main
struct BelayWatchApp: App {
    @State private var account: WristAccount
    /// Held for the app's life: the system's session keeps its delegate weakly.
    private let link: PhoneLink?
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        if let fixture = WatchFixture.account() {
            _account = State(initialValue: fixture)
            link = nil
            return
        }
        #endif
        let link = PhoneLink()
        let account = WristAccount(secrets: KeychainStore(), defaults: .standard, http: URLSessionClient(), phone: link)
        link.account = account
        self.link = link
        _account = State(initialValue: account)
    }

    var body: some Scene {
        WindowGroup {
            ShellView(account: account)
        }
        .onChange(of: scenePhase) { before, now in
            // A return from the background; the launch's own start is the screen's.
            guard before == .background, now == .active else { return }
            Task { await account.start() }
        }
    }
}
