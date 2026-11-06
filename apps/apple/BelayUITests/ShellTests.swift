import XCTest

/// The shell before any screen is native: four tabs, each saying it lives on the web for now.
@MainActor
final class ShellTests: XCTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        // An argument beats the stored value, so the test never depends on a signed-in instance.
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-belay.instance", "https://belay.example"]
        app.launch()
        return app
    }

    func testFourTabsAndWebLink() {
        let app = launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 5))

        for name in ["Accueil", "Séances", "Corps", "Outils"] {
            let tab = bar.buttons[name]
            XCTAssertTrue(tab.exists, "the \(name) tab is in the bar")
            tab.tap()
            let sentence = app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "sur le web pour l’instant")).firstMatch
            XCTAssertTrue(sentence.waitForExistence(timeout: 3), "\(name) says it is on the web for now")
            let link = app.links["Ouvrir sur le web"].firstMatch
            XCTAssertTrue(link.exists || app.buttons["Ouvrir sur le web"].exists, "\(name) offers the link")
        }
    }
}
