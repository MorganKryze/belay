import XCTest

/// The summary of a session A finished after one set of the bench press at 62,5 kg for 8, on the
/// fixture whose previous session A logged the same load.
@MainActor
final class SummaryTests: XCTestCase {
    private func finishAfterOneSet() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", "history"]
        app.launch()
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        let tick = app.buttons["tick"]
        XCTAssertTrue(tick.waitForExistence(timeout: 5), "the cover shows the next set")
        tick.tap()
        // Some builds of the cover ask for the RIR before they record the set.
        let confirm = app.buttons["rir-confirm"]
        if confirm.waitForExistence(timeout: 2) { confirm.tap() }
        app.buttons["Terminer"].tap()
        let save = app.buttons["Terminer et enregistrer"]
        XCTAssertTrue(save.waitForExistence(timeout: 3), "Terminer asks first")
        save.tap()
        XCTAssertTrue(app.buttons["summary-close"].waitForExistence(timeout: 5), "the summary shows")
        return app
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// The session's letter as the large title, its end and day under it.
    func testTitledBySession() {
        let app = finishAfterOneSet()
        XCTAssertTrue(app.navigationBars["Séance A"].exists, "the summary is titled by the session")
        XCTAssertTrue(text(app, containing: "Séance terminée · ").exists, "and says it is done, with the day")
    }

    /// The volume leads, warm-ups left out: 62,5 kg × 8 is 500 kg; the same load as last time
    /// is no record.
    func testVolumeLeads() {
        let app = finishAfterOneSet()
        let volume = app.descendants(matching: .any)["summary-volume"].firstMatch
        XCTAssertTrue(volume.exists, "the volume shows")
        XCTAssertTrue(volume.label.contains("500"), "62,5 × 8: \(volume.label)")
        XCTAssertTrue(app.staticTexts["Montée exclue · 0 série"].exists, "warm-ups are left out")
        XCTAssertFalse(text(app, containing: "Record").exists, "the same load as last time is no record")
    }
}
