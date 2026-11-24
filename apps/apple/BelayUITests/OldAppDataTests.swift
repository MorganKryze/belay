import XCTest

/// The web view data the app before this one left on the phone: erased at the first launch after
/// the update, once, with the account's store, its session and the phone's preferences kept.
/// `oldWebData` plants a cookie, local storage and a database and holds the erase for its launch,
/// so the next launch, on `keep`, is the first after the update.
@MainActor
final class OldAppDataTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ fixture: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        app.launchFixture()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// The probe once it has an answer: « <records left>|<what the launch did> ».
    private func webData(_ app: XCUIApplication) -> (records: Int, outcome: String) {
        let probe = element(app, "debug-web-data")
        // A web view's first page on a fresh install can take a while: the wait leaves it room.
        XCTAssertTrue(
            probe.waitFor(NSPredicate(format: "value CONTAINS '|'"), timeout: 30),
            "the probe answers, at the step « \(probe.value ?? "none") »")
        let parts = ((probe.value as? String) ?? "").split(separator: "|", omittingEmptySubsequences: false)
        return (Int(parts.first ?? "") ?? -1, parts.count > 1 ? String(parts[1]) : "")
    }

    /// The old app's data planted, then the launch after it.
    private func plantedThenRelaunched() -> XCUIApplication {
        let planted = launch("oldWebData")
        let before = webData(planted)
        XCTAssertGreaterThan(before.records, 0, "the old app's web data is on the phone")
        XCTAssertEqual(before.outcome, "held")
        return launch("keep")
    }

    func testOldWebDataGoesAtTheNextLaunchStoreAndTokenStay() {
        let app = plantedThenRelaunched()
        let after = webData(app)
        XCTAssertEqual(after.records, 0, "no web data left")
        XCTAssertEqual(after.outcome, "erased")
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "Accueil, still signed in")
        XCTAssertEqual(chip.label, "Faite aujourd’hui", "the session kept today is still in the store")
    }

    func testASecondLaunchTouchesNothing() {
        _ = webData(plantedThenRelaunched())
        let again = launch("keep")
        XCTAssertEqual(webData(again).outcome, "skipped", "the erase ran once")
        XCTAssertTrue(element(again, "chip.session").waitForExistence(timeout: 10), "still signed in")
    }

    func testPreferencesStay() {
        let planted = launch("oldWebData")
        XCTAssertGreaterThan(webData(planted).records, 0)
        let settings = planted.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        let theme = element(planted, "reglages-theme")
        XCTAssertTrue(planted.swipeUpUntil(theme), "the theme row is reached")
        theme.tap()
        let dark = planted.buttons["Sombre"].firstMatch
        XCTAssertTrue(dark.waitForExistence(timeout: 3))
        dark.tap()
        XCTAssertTrue(element(planted, "reglages-theme").waitFor(NSPredicate(format: "label CONTAINS 'Sombre'"), timeout: 3))

        let app = launch("keep")
        XCTAssertEqual(webData(app).outcome, "erased")
        app.buttons["settings"].tap()
        let kept = element(app, "reglages-theme")
        XCTAssertTrue(app.swipeUpUntil(kept))
        XCTAssertTrue(kept.label.contains("Sombre"), "the theme chosen before the erase: \(kept.label)")
    }
}
