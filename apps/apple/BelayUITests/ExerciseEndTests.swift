import XCTest

/// The end of an exercise on the fixture's session A. `exerciseEnd` has the bench press's last
/// work set due, its RIR not asked yet, with a last time for the exercise after it, so that one
/// starts with a warm-up; `lastSet` has the session's last set due. The recap shows first, then the
/// next exercise is announced during the rest, and once everything is noted the cover offers 🏁.
@MainActor
final class ExerciseEndTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ fixture: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture] + extra
        app.launch()
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 20), "the session is open")
        resume.tap()
        XCTAssertTrue(element(app, "session-clock").waitForExistence(timeout: 5), "the cover shows")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// Logs the set due as prefilled; when the tap began, which is no later than the recap shows.
    private func logLast(_ app: XCUIApplication) -> Date {
        let began = Date.now
        element(app, "log-set").tap()
        XCTAssertTrue(element(app, "exercise-recap").waitForExistence(timeout: 3), "the recap shows")
        return began
    }

    /// From the bench press's last set to the next exercise announced, by a tap on the recap.
    private func announce(_ app: XCUIApplication) {
        _ = logLast(app)
        element(app, "exercise-recap").tap()
        XCTAssertTrue(element(app, "exercise-announce").waitForExistence(timeout: 2), "the next exercise is announced")
    }

    func testRecapThenAnnounce() {
        let app = launch("exerciseEnd")
        let began = logLast(app)
        let ask = element(app, "rir-2")
        XCTAssertTrue(ask.exists, "the foot asks the last set's RIR")
        ask.tap()
        let answered = Date.now.timeIntervalSince(began)
        // Watched closely: the moment the announcement shows is never before the recap's 2.6 s,
        // which began no earlier than the tap that logged the set.
        let announce = element(app, "exercise-announce")
        var seen: TimeInterval?
        while seen == nil, Date.now < began.addingTimeInterval(8) {
            if announce.exists { seen = Date.now.timeIntervalSince(began) }
        }
        let at = try? XCTUnwrap(seen, "then the next exercise is announced")
        XCTAssertGreaterThanOrEqual(at ?? 0, 2.6, "the recap stays 2.6 s at least (answered at \(answered) s)")
        XCTAssertLessThan(at ?? 99, max(2.6, answered + 0.9) + 1.5, "and turns soon after")
        XCTAssertFalse(element(app, "exercise-recap").exists, "in its place")
    }

    /// Unanswered, the recap never turns on its own: the tap is what turns it.
    func testTapSkipsRecap() {
        let app = launch("exerciseEnd")
        _ = logLast(app)
        let recap = element(app, "exercise-recap")
        XCTAssertTrue(recap.label.hasSuffix(" terminé, 62,5\u{202F}kg × 8, 8, 7, 6"), "what was done, plainly: \(recap.label)")
        recap.tap()
        XCTAssertTrue(element(app, "exercise-announce").waitForExistence(timeout: 2), "the tap turns it at once")
        XCTAssertEqual(element(app, "set-kind").label, "Montée", "the next exercise starts with its warm-up")
    }

    func testRecapWaitsForVoiceOver() {
        let app = launch("exerciseEnd", extra: ["-BelayVoiceOver", "YES"])
        _ = logLast(app)
        element(app, "rir-2").tap()
        Thread.sleep(forTimeInterval: 4.5)
        XCTAssertTrue(element(app, "exercise-recap").exists, "under VoiceOver the recap waits")
        XCTAssertEqual(element(app, "exercise-recap").label.isEmpty, false, "and reads as one element")
        element(app, "exercise-recap").tap()
        XCTAssertTrue(element(app, "exercise-announce").waitForExistence(timeout: 2), "until a tap")
    }

    func testAnnounceOnlySkip() {
        let app = launch("exerciseEnd")
        announce(app)
        XCTAssertTrue(app.buttons["foot-skip"].exists, "⏭ is the one action")
        XCTAssertEqual(app.buttons["foot-skip"].label, "Passer le repos")
        for id in ["log-set", "add-thirty", "skip-rest", "rir-2", "foot-finish"] {
            XCTAssertFalse(element(app, id).exists, "no \(id) while announced")
        }
        XCTAssertFalse(element(app, "announce-name").label.isEmpty, "the next exercise is named")
        XCTAssertTrue(element(app, "announce-load").label == "24\u{202F}kg × 5", element(app, "announce-load").label)
        XCTAssertTrue(element(app, "announce-clock").exists, "the rest's clock, small, at the top")
    }

    func testClockBringsThirty() {
        let app = launch("exerciseEnd")
        announce(app)
        element(app, "announce-clock").tap()
        XCTAssertTrue(element(app, "add-thirty").waitForExistence(timeout: 2), "the rest card with +30 s")
        XCTAssertTrue(element(app, "rest-clock").exists)
        XCTAssertFalse(element(app, "exercise-announce").exists)
    }

    func testNextExerciseStartsWithWarmup() {
        let app = launch("exerciseEnd")
        announce(app)
        // The foot's glass morphs into ⏭ on the session's spring; a tap mid-morph lands on the
        // shape that is leaving, so the test waits for the spring to settle.
        Thread.sleep(forTimeInterval: 1)
        app.buttons["foot-skip"].tap()
        let title = element(app, "set-title")
        XCTAssertTrue(title.waitForExistence(timeout: 3), "the next set is due")
        XCTAssertEqual(title.label, "Montée 1 sur 1", "its first warm-up")
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Exercice 2 sur ")).firstMatch.exists,
            "of the next exercise")
    }

    /// The bench press and the next exercise in one group: A1, then B1 at once, with no rest.
    func testGroupNoRestInsideRound() {
        let app = launch("group")
        for _ in 0..<2 { element(app, "log-set").tap() }
        let title = element(app, "set-title")
        XCTAssertTrue(
            title.waitFor(NSPredicate(format: "label == %@", "Série 1 sur 4")), "the bench press's first work set")
        element(app, "log-set").tap()
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Exercice 2 sur ")).firstMatch
                .waitForExistence(timeout: 3), "the next exercise of the round shows directly")
        XCTAssertFalse(element(app, "rest-clock").exists, "with no rest")
        XCTAssertFalse(element(app, "exercise-recap").exists, "and no recap: the bench press is not finished")
    }

    func testAllDoneFlagFinishes() {
        let app = launch("lastSet")
        _ = logLast(app)
        element(app, "exercise-recap").tap()
        XCTAssertTrue(app.staticTexts["Tout est noté"].waitForExistence(timeout: 2), "everything is noted")
        XCTAssertTrue(app.staticTexts["19 séries · Séance A"].exists, "the sets and the session")
        let finish = app.buttons["foot-finish"]
        XCTAssertTrue(finish.exists, "🏁 is the one action")
        XCTAssertFalse(element(app, "log-set").exists)
        finish.tap()
        XCTAssertFalse(app.alerts.firstMatch.waitForExistence(timeout: 1), "no question")
        XCTAssertTrue(app.buttons["Enregistrer et fermer"].waitForExistence(timeout: 5), "the summary shows")
    }
}

private extension XCUIElement {
    func waitFor(_ predicate: NSPredicate, timeout: TimeInterval = 3) -> Bool {
        XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout)
            == .completed
    }
}
