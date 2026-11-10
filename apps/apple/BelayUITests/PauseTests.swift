import XCTest

/// The pause on the fixture's session A, 19 work sets planned: ⏸ stops everything and leaves ▶
/// alone in the foot; the bar's ■ asks in a system alert before the session ends.
@MainActor
final class PauseTests: XCTestCase {
    private static let ax3 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"]

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ fixture: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture] + extra
        app.launch()
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        XCTAssertTrue(element(app, "session-clock").waitForExistence(timeout: 5), "the cover shows")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func text(_ app: XCUIApplication, beginning part: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", part)).firstMatch
    }

    private func pause(_ app: XCUIApplication) {
        app.buttons["Mettre la séance en pause"].tap()
        XCTAssertTrue(app.staticTexts["En pause"].waitForExistence(timeout: 3), "the card says so")
    }

    /// ■, then the alert it opens.
    private func askStop(_ app: XCUIApplication) -> XCUIElement {
        pause(app)
        app.buttons["Arrêter la séance"].tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 3), "a system alert asks")
        return alert
    }

    private func stopSentence(_ fixture: String) -> String {
        let app = launch(fixture)
        let alert = askStop(app)
        let message = alert.staticTexts.allElementsBoundByIndex.map(\.label).filter { $0 != "Arrêter la séance\u{202F}?" }
        app.terminate()
        return message.joined(separator: " ")
    }

    func testPauseShowsOnlyResume() {
        let app = launch("lockLogged")
        XCTAssertTrue(element(app, "rest-clock").waitForExistence(timeout: 3), "a rest runs")
        pause(app)
        XCTAssertTrue(text(app, beginning: "Séance arrêtée à ").exists, "the session's time, standing")
        XCTAssertTrue(text(app, beginning: "Repos arrêté à ").exists, "the rest left, standing")
        let stood = text(app, beginning: "Séance arrêtée à ").label
        Thread.sleep(forTimeInterval: 1.5)
        XCTAssertEqual(text(app, beginning: "Séance arrêtée à ").label, stood, "it does not run")
        XCTAssertTrue(app.buttons["foot-play"].exists, "▶ in the foot")
        XCTAssertEqual(app.buttons["foot-play"].label, "Reprendre")
        for id in ["log-set", "add-thirty", "skip-rest", "rir-2", "foot-skip", "foot-finish", "rest-clock"] {
            XCTAssertFalse(element(app, id).exists, "nothing else: \(id)")
        }
        XCTAssertTrue(app.buttons["Arrêter la séance"].exists, "⏸ became ■")
        XCTAssertFalse(app.buttons["Mettre la séance en pause"].exists)
    }

    func testStopAsksSystemAlert() {
        let app = launch("lastSet")
        var alert = askStop(app)
        XCTAssertTrue(alert.staticTexts["Arrêter la séance\u{202F}?"].exists, "titled as a question")
        XCTAssertTrue(
            alert.staticTexts["18 séries notées sur 19. L’autre ne sera pas enregistrée\u{202F}; ton programme ne change pas."]
                .exists, "the web's sentence, one set left")
        XCTAssertTrue(alert.buttons["Arrêter"].exists)
        alert.buttons["Annuler"].tap()
        XCTAssertTrue(app.staticTexts["En pause"].waitForExistence(timeout: 2), "Annuler keeps the session paused")
        app.buttons["Arrêter la séance"].tap()
        alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        alert.buttons["Arrêter"].tap()
        XCTAssertTrue(app.buttons["Enregistrer et fermer"].waitForExistence(timeout: 5), "Arrêter shows the summary")
    }

    /// The sentence counts the work sets done and left, each in its plural, at 0, 1 and 2.
    func testStopSentenceCounts() {
        XCTAssertEqual(
            stopSentence("twoLeft"),
            "17 séries notées sur 19. Les 2 autres ne seront pas enregistrées\u{202F}; ton programme ne change pas.")
        XCTAssertEqual(
            stopSentence("workSet"),
            "0 série notée sur 19. Les 19 autres ne seront pas enregistrées\u{202F}; ton programme ne change pas.",
            "warm-ups only")
        XCTAssertEqual(
            stopSentence("lockLogged"),
            "1 série notée sur 19. Les 18 autres ne seront pas enregistrées\u{202F}; ton programme ne change pas.")
        XCTAssertEqual(stopSentence("finished"), "19 séries notées sur 19. Ton programme ne change pas.", "none left")
    }

    func testStopEmptyAsksToLeave() {
        let app = launch("running")
        var alert = askStop(app)
        XCTAssertTrue(alert.staticTexts["Rien n’est noté pour l’instant"].exists)
        XCTAssertTrue(
            alert.staticTexts["Si tu quittes, cette séance ne sera pas gardée. Tu pourras la commencer plus tard."].exists)
        alert.buttons["Continuer la séance"].tap()
        XCTAssertTrue(app.staticTexts["En pause"].waitForExistence(timeout: 2), "Continuer keeps the session")
        app.buttons["Arrêter la séance"].tap()
        alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 3))
        alert.buttons["Quitter sans enregistrer"].tap()
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 5), "back on Accueil")
        XCTAssertFalse(app.buttons["Reprendre"].exists, "the session is gone")
        XCTAssertFalse(app.buttons["Enregistrer et fermer"].exists, "with no summary")
    }

    func testResumeFlowsBack() {
        let app = launch("workSet")
        pause(app)
        app.buttons["foot-play"].tap()
        XCTAssertTrue(element(app, "log-set").waitForExistence(timeout: 3), "the ruler and ✓ are back")
        XCTAssertTrue(element(app, "rep-ruler").exists)
        XCTAssertFalse(app.staticTexts["En pause"].exists)
        XCTAssertFalse(app.buttons["foot-play"].exists)
        XCTAssertTrue(app.buttons["Mettre la séance en pause"].exists, "■ became ⏸ again")
    }

    func testAx3Pause() {
        func measure(_ extra: [String]) -> (play: CGFloat, title: CGRect, line: CGRect, width: CGFloat) {
            let app = launch("lockLogged", extra: extra)
            pause(app)
            let sizes = (
                app.buttons["foot-play"].frame.height, app.staticTexts["En pause"].frame,
                text(app, beginning: "Séance arrêtée à ").frame, app.windows.firstMatch.frame.width)
            app.terminate()
            return sizes
        }
        let base = measure([])
        let large = measure(Self.ax3)
        XCTAssertLessThanOrEqual(large.play, base.play * 1.35, "▶ is capped")
        XCTAssertGreaterThan(large.title.height, base.title.height, "the title follows the size")
        for frame in [large.title, large.line] {
            XCTAssertGreaterThanOrEqual(frame.minX, 0, "nothing runs off the left")
            XCTAssertLessThanOrEqual(frame.maxX, large.width, "nothing runs off the right")
        }
    }
}
