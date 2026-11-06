import XCTest

/// Accueil's session card on a fixture account that stores no program: the starting program's
/// first session comes next, starts, and is still open after a relaunch.
@MainActor
final class AccueilTests: XCTestCase {
    /// `fresh` opens an empty store, `keep` the one the previous launch left.
    private func launch(_ fixture: String, largestText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launch()
        return app
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// Session A of the starting program: six exercises, about 55 minutes.
    func testNextSessionOfTheStartingProgram() {
        let app = launch("fresh")
        XCTAssertTrue(app.staticTexts["La prochaine"].waitForExistence(timeout: 10), "the card says what comes next")
        XCTAssertTrue(app.staticTexts["Séance A"].exists, "the starting program begins with session A")
        XCTAssertTrue(text(app, containing: "6 exercices").exists, "with its exercise count")
        XCTAssertTrue(text(app, containing: "environ 55\u{202F}min").exists, "and its estimated time")
        XCTAssertTrue(app.buttons["Commencer"].exists, "the card starts it")
    }

    /// Commencer opens the session; lowered, it waits above the tab bar; a relaunch finds it open.
    func testStartThenResumeAfterRelaunch() {
        var app = launch("fresh")
        let start = app.buttons["Commencer"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        start.tap()

        let lower = app.buttons["Réduire la séance"]
        XCTAssertTrue(lower.waitForExistence(timeout: 5), "Commencer opens the session")
        XCTAssertTrue(app.staticTexts["cover-title"].exists, "the session shows its title")
        lower.tap()

        let accessory = app.buttons["resume-accessory"]
        XCTAssertTrue(accessory.waitForExistence(timeout: 5), "the open session waits above the tab bar")
        XCTAssertTrue(app.buttons["Reprendre"].exists, "the card now resumes it")
        accessory.tap()
        XCTAssertTrue(lower.waitForExistence(timeout: 5), "the accessory opens the session again")

        app.terminate()
        app = launch("keep")
        XCTAssertTrue(app.buttons["Reprendre"].waitForExistence(timeout: 10), "a relaunch finds the session open")
        XCTAssertTrue(text(app, containing: "En cours").exists, "and says it is under way")
        XCTAssertTrue(app.buttons["resume-accessory"].exists, "with the accessory above the tab bar")
        app.buttons["Reprendre"].tap()
        XCTAssertTrue(app.buttons["Réduire la séance"].waitForExistence(timeout: 5), "Reprendre opens it")
    }

    /// At the largest text size the session path is held to, the card keeps its button in reach.
    func testCardAtLargestText() {
        let app = launch("fresh", largestText: true)
        let start = app.buttons["Commencer"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        if !start.isHittable { app.swipeUp() }
        XCTAssertTrue(start.isHittable, "Commencer can be tapped at AX3")
        XCTAssertGreaterThanOrEqual(start.frame.height, 44, "a 44 pt target")
    }
}
