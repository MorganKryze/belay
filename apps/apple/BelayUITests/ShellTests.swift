import XCTest

/// The shell: four tabs, Accueil native, the others saying they live on the web for now.
@MainActor
final class ShellTests: XCTestCase {
    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        // The fixture signs in a made-up account, so the shell shows without a real instance; the
        // instance argument gives the web links their address.
        app.launchArguments = [
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", "fresh",
            "-belay.instance", "https://belay.example",
        ]
        app.launch()
        return app
    }

    func testFourTabsAndWebLink() {
        let app = launch()
        let bar = app.tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 5))

        bar.buttons["Accueil"].tap()
        XCTAssertTrue(app.staticTexts["La prochaine"].waitForExistence(timeout: 3), "Accueil is native")

        for name in ["Séances", "Corps", "Outils"] {
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
