import XCTest

/// The watch app's first screen, before it knows anything of the iPhone's session.
@MainActor
final class WatchShellTests: XCTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR"]
        if app.state != .notRunning { app.terminate() }
        app.launch()
        return app
    }

    func testTheWatchAppOpensOnItsFirstScreen() {
        let app = launch()
        XCTAssertTrue(app.staticTexts["Ouvre Belay sur ton iPhone"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Ta montre se connecte avec la session de ton iPhone."].exists)
        XCTAssertFalse(app.descendants(matching: .any)["belay-mark"].exists, "the mark stays out of VoiceOver")
    }
}
