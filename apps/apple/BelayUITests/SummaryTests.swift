import XCTest

/// The summary of session A on the `finished` fixture: the first work set of the bench press at
/// 65 kg for 8, over a previous session A at 62,5 kg, so the summary names a record; every other
/// set is logged as prefilled, so the cover opens on the finish flag.
@MainActor
final class SummaryTests: XCTestCase {
    private func summary(extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", "finished"] + extra
        app.launchFixture()
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        app.finishSession()
        return app
    }

    private func any(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// What the store holds for the effort and the note of the session just left.
    private func probe(_ app: XCUIApplication) -> String {
        (any(app, "fixture-summary").value as? String) ?? ""
    }

    /// A bar of the summary's own: Accueil's stays in the tree behind the cover.
    private func titledBar(_ app: XCUIApplication) -> XCUIElement {
        app.navigationBars.matching(NSPredicate(format: "identifier CONTAINS %@", "Séance")).firstMatch
    }

    private func backHome(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["Bonjour Ada"].waitForExistence(timeout: 5), "back on Accueil")
        XCTAssertFalse(app.buttons["Enregistrer et fermer"].exists, "the summary is gone")
    }

    func testTitleCardHasFlagNotButton() {
        let app = summary()
        XCTAssertTrue(text(app, containing: "Séance A").exists, "the title card names the session")
        XCTAssertTrue(text(app, containing: "Faite · ").exists, "and says it is done")
        XCTAssertFalse(app.buttons["flag.checkered"].exists, "the flag is a mark, not a button")
        XCTAssertFalse(app.images["flag.checkered"].exists, "the flag is hidden from VoiceOver")
        XCTAssertFalse(app.buttons["Fermer"].exists, "no ✕")
        XCTAssertFalse(titledBar(app).exists, "no navigation title: \(app.navigationBars.debugDescription)")
    }

    func testEffortOptionalThenWord() {
        let app = summary()
        XCTAssertTrue(app.staticTexts["facultatif"].exists, "the effort is optional")
        let steps = any(app, "effort-steps")
        XCTAssertTrue(steps.exists)
        steps.coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)).tap()
        XCTAssertTrue(text(app, containing: "Difficile").waitForExistence(timeout: 2), "the fourth floor is Difficile")
        XCTAssertFalse(app.staticTexts["facultatif"].exists)
        XCTAssertEqual(steps.value as? String, "4 sur 5, Difficile")
    }

    func testEffortByDrag() {
        let app = summary()
        let steps = any(app, "effort-steps")
        steps.coordinate(withNormalizedOffset: CGVector(dx: 0.05, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: steps.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)))
        XCTAssertEqual(steps.value as? String, "5 sur 5, Maximal")
    }

    func testNoExerciseList() {
        let app = summary()
        XCTAssertFalse(app.staticTexts["Ce que tu as noté"].exists, "no list of exercises")
        XCTAssertFalse(text(app, containing: "meilleure").exists)
        XCTAssertTrue(text(app, containing: "Record").exists, "the record line stays")
    }

    func testNoteKept() {
        let app = summary()
        let note = app.textFields["Une note sur la séance"].firstMatch
        XCTAssertTrue(note.exists, "the note field shows")
        note.tap()
        note.typeText("Bonne forme")
        app.buttons["Enregistrer et fermer"].tap()
        backHome(app)
        XCTAssertTrue(probe(app).contains("note=Bonne forme"), probe(app))
    }

    func testLeaveByCheck() {
        let app = summary()
        any(app, "effort-steps").coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)).tap()
        app.buttons["Enregistrer et fermer"].tap()
        backHome(app)
        XCTAssertTrue(probe(app).hasPrefix("floor=4 settled=true"), probe(app))
    }

    func testLeaveByPull() {
        let app = summary()
        any(app, "effort-steps").coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)).tap()
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15))
        top.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.85)))
        backHome(app)
        XCTAssertTrue(probe(app).hasPrefix("floor=4 settled=true"), probe(app))
    }

    /// The app ends with the summary still up: the next launch settles the effort as it was given.
    func testEffortSettledWhenTheAppEndsOnTheSummary() {
        let app = summary()
        any(app, "effort-steps").coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)).tap()
        XCTAssertTrue(text(app, containing: "Difficile").waitForExistence(timeout: 2))
        app.terminate()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", "keep"]
        app.launchFixture()
        XCTAssertTrue(app.staticTexts["Bonjour Ada"].waitForExistence(timeout: 10), "on Accueil")
        XCTAssertTrue(probe(app).hasPrefix("floor=4 settled=true"), probe(app))
    }

    /// A drag down that scrolls back up the long AX layout only scrolls: the summary stays.
    func testScrollBackUpKeepsTheSummary() {
        let app = summary(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"])
        any(app, "effort-steps").coordinate(withNormalizedOffset: CGVector(dx: 0.7, dy: 0.5)).tap()
        app.swipeUp()
        app.swipeUp()
        let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        middle.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)))
        XCTAssertTrue(app.buttons["Enregistrer et fermer"].exists, "still on the summary")
        XCTAssertFalse(probe(app).contains("settled=true"), probe(app))
    }

    /// A scroll leaves no bar and no compact title at the top.
    func testNoBarOnScroll() {
        let app = summary(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"])
        app.swipeUp()
        XCTAssertFalse(titledBar(app).exists, "no bar once scrolled: \(app.navigationBars.debugDescription)")
        XCTAssertTrue(app.buttons["Enregistrer et fermer"].exists, "the ✓ stays at the foot")
    }

    /// At AX3 the four tiles stand in one column.
    func testAx3TilesOneColumn() {
        let app = summary(extra: ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"])
        let duration = any(app, "summary-tile-duration")
        let sets = any(app, "summary-sets")
        XCTAssertTrue(duration.exists && sets.exists)
        XCTAssertEqual(duration.frame.minX, sets.frame.minX, accuracy: 1, "one column")
        XCTAssertGreaterThan(sets.frame.minY, duration.frame.maxY - 1, "stacked")
    }
}
