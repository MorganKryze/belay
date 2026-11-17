import XCTest

/// The shell: four tabs, Accueil, Séances, Corps and Outils, each native.
@MainActor
final class ShellTests: XCTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        // The fixture signs in a made-up account, so the shell shows without a real instance.
        app.launchArguments = [
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", "fresh",
        ]
        app.launchFixture()
        return app
    }

    func testFourNativeTabs() {
        let app = launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 5))

        bar.buttons["Accueil"].tap()
        XCTAssertTrue(app.staticTexts["La prochaine"].waitForExistence(timeout: 3), "Accueil is native")

        bar.buttons["Séances"].tap()
        XCTAssertTrue(app.navigationBars["Séances"].waitForExistence(timeout: 3), "Séances is native")

        bar.buttons["Corps"].tap()
        XCTAssertTrue(app.navigationBars["Corps"].waitForExistence(timeout: 3), "Corps is native")

        // A9: Outils lists its tools on the phone, no longer a page that leads to the web.
        bar.buttons["Outils"].tap()
        XCTAssertTrue(app.navigationBars["Outils"].waitForExistence(timeout: 3), "Outils is native")
        XCTAssertTrue(app.descendants(matching: .any)["tool-row-one-rep-max"].exists, "with its tools")
        XCTAssertFalse(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "sur le web pour l’instant")).firstMatch
                .exists, "and no web placeholder")
    }
}
