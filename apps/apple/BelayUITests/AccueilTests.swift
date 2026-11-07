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
        XCTAssertTrue(app.buttons["Voir la séance"].exists, "the card opens it")
    }

    /// The person's name as the title, their initial on the avatar.
    func testGreetsByName() {
        let app = launch("fresh")
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 10), "Accueil greets by name")
        XCTAssertTrue(app.buttons["settings"].exists, "the avatar opens Réglages")
    }

    /// Voir la séance shows the session before it starts: its title, size and exercises, and the
    /// start at its foot.
    func testPreviewShowsTheSession() {
        let fresh = launch("fresh")
        let open = fresh.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(fresh.navigationBars["Séance A"].waitForExistence(timeout: 5), "the preview is titled by the session")
        XCTAssertTrue(text(fresh, containing: "6 exercices · environ 55\u{202F}min").exists, "with its size")
        XCTAssertTrue(fresh.staticTexts["Barbell bench press"].exists, "and its exercises")
        XCTAssertTrue(text(fresh, containing: "4 × 6–8").exists, "each with its sets and reps")
        XCTAssertFalse(fresh.buttons["resume-accessory"].exists, "nothing has started yet")
        let start = fresh.buttons["Commencer la séance"]
        XCTAssertTrue(start.exists, "the start sits at the foot")
        start.tap()
        XCTAssertTrue(fresh.buttons["Réduire la séance"].waitForExistence(timeout: 5), "Commencer la séance opens it")
    }

    /// Each exercise of the preview says what was logged last time, as figures.
    func testPreviewSaysTheLastTime() {
        let app = launch("past")
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5))
        let last = text(app, containing: "la dernière fois")
        XCTAssertTrue(last.exists, "the bench press has a last time")
        XCTAssertTrue(
            last.label.hasSuffix("4 × 6–8 · la dernière fois 62,5\u{202F}kg × 8, 8, 7, 6"), "as figures: \(last.label)")
    }

    /// Under way, the card and the accessory say where the session stands: the load on the bar,
    /// the exercise, the set.
    func testRunningCardLeadsWithTheLoad() {
        let app = launch("history")
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10))
        XCTAssertTrue(text(app, containing: "62,5\u{202F}kg × 8").exists, "the card leads with the load on the bar")
        XCTAssertTrue(text(app, containing: "En cours · 0 série sur 19").exists, "and the sets done")
        XCTAssertTrue(app.staticTexts["Barbell bench press"].exists, "names the exercise under way")
        XCTAssertTrue(app.staticTexts["Série 1 sur 4 · Séance A"].exists, "and the set")
        let accessory = app.buttons["resume-accessory"]
        XCTAssertTrue(accessory.label.contains("Barbell bench press"), "the accessory names the exercise: \(accessory.label)")
        XCTAssertTrue(accessory.label.contains("Série 1 sur 4 · Séance A"), "and the set: \(accessory.label)")
    }

    /// The preview's start opens the session; lowered, it waits above the tab bar; a relaunch finds it open.
    func testStartThenResumeAfterRelaunch() {
        var app = launch("fresh")
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let start = app.buttons["Commencer la séance"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()

        let lower = app.buttons["Réduire la séance"]
        XCTAssertTrue(lower.waitForExistence(timeout: 5), "Commencer opens the session")
        XCTAssertTrue(app.navigationBars["Séance A"].exists, "the session shows its title")
        lower.tap()

        let accessory = app.buttons["resume-accessory"]
        XCTAssertTrue(accessory.waitForExistence(timeout: 5), "the open session waits above the tab bar")
        XCTAssertTrue(app.buttons["Reprendre la séance"].exists, "the preview's foot now resumes it")
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
        let start = app.buttons["Voir la séance"]
        XCTAssertTrue(start.waitForExistence(timeout: 10))
        if !start.isHittable { app.swipeUp() }
        XCTAssertTrue(start.isHittable, "Voir la séance can be tapped at AX3")
        XCTAssertGreaterThanOrEqual(start.frame.height, 44, "a 44 pt target")
    }
}
