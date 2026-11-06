import SwiftUI

@main
struct BelayApp: App {
    init() {
        DisplayType.register()
        DisplayType.styleBars()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .onReceive(NotificationCenter.default.publisher(for: UIContentSizeCategory.didChangeNotification)) { _ in
                    DisplayType.styleBars()
                }
        }
    }
}
