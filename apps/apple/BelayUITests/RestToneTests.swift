import XCTest

/// The rest's end tone as Réglages chooses it. A debug build's probe reads what was heard: its value
/// is the choice the last tone played under, the audio session it played in and the sound of the
/// rest notification last planned (« on|ambient|rest.wav », « none » where nothing was), its label
/// the number of tones played. Every fixture launch but `keep` starts from Discret; a launch
/// argument sets another choice for the session tests.
@MainActor
final class RestToneTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ fixture: String, sound: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
            + (sound.map { ["-belay.restSound", $0] } ?? [])
        app.launchFixture()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func probe(_ app: XCUIApplication) -> XCUIElement {
        element(app, "debug-rest-tone")
    }

    /// Réglages' rest sound menu, from Accueil's avatar, its row reached.
    private func soundMenu(_ app: XCUIApplication) {
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Accueil leads to Réglages")
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
        let row = soundMenuRow(app)
        XCTAssertTrue(app.swipeUpUntil(row), "the rest sound row is reached")
        // Clear of the floating tab bar, where a tap would switch tabs.
        let bar = app.tabBars.firstMatch
        for _ in 0..<3 where bar.exists && row.frame.maxY > bar.frame.minY - 8 {
            app.swipeUp(velocity: .slow)
        }
    }

    private func choose(_ app: XCUIApplication, _ choice: String) {
        soundMenuRow(app).tap()
        let option = app.buttons[choice].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 3), "the menu offers « \(choice) »")
        option.tap()
        XCTAssertTrue(
            soundMenuRow(app).waitFor(NSPredicate(format: "label CONTAINS %@", choice), timeout: 3), "« \(choice) » chosen")
    }

    private func soundMenuRow(_ app: XCUIApplication) -> XCUIElement {
        element(app, "reglages-rest-sound")
    }

    /// The open session's cover, from the resume button.
    private func cover(_ app: XCUIApplication) {
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        XCTAssertTrue(element(app, "session-clock").waitForExistence(timeout: 5), "the cover shows")
        XCTAssertTrue(element(app, "rest-clock").waitForExistence(timeout: 3), "a rest runs")
    }

    /// Waits for the rest to run out on the cover, then a moment for its end to ring.
    private func restEnds(_ app: XCUIApplication) {
        XCTAssertTrue(
            element(app, "rest-clock").waitFor(NSPredicate(format: "exists == false"), timeout: 30), "the rest runs out")
        Thread.sleep(forTimeInterval: 1.5)
    }

    func testChoosingDiscretOrToujoursPlaysOnce() {
        let app = launch("fresh")
        soundMenu(app)
        XCTAssertEqual(probe(app).label, "0", "nothing played on opening Réglages")
        choose(app, "Toujours")
        XCTAssertTrue(probe(app).waitFor(NSPredicate(format: "label == '1'"), timeout: 3), "Toujours plays once")
        XCTAssertEqual(probe(app).value as? String, "over|playback|none", "through silent mode")
        choose(app, "Discret")
        XCTAssertTrue(probe(app).waitFor(NSPredicate(format: "label == '2'"), timeout: 3), "Discret plays once more")
        XCTAssertEqual(probe(app).value as? String, "on|ambient|none", "with the music, under the ring switch")
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(probe(app).label, "2", "each choice plays once, never again")
    }

    func testChoosingCoupePlaysNothing() {
        let app = launch("fresh")
        soundMenu(app)
        choose(app, "Coupé")
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(probe(app).label, "0", "Coupé plays nothing")
        XCTAssertEqual(probe(app).value as? String, "none|none|none")
    }

    func testCoupeEndsRestWithoutTone() {
        let app = launch("restEnding", sound: "off")
        cover(app)
        restEnds(app)
        XCTAssertEqual(probe(app).label, "0", "no tone at the rest's end")
        XCTAssertEqual(probe(app).value as? String, "none|none|none")
    }

    func testDiscretEndsRestAmbient() {
        let app = launch("restEnding", sound: "on")
        cover(app)
        restEnds(app)
        XCTAssertEqual(probe(app).label, "1", "one tone at the rest's end")
        XCTAssertEqual(probe(app).value as? String, "on|ambient|rest.wav", "in the ambient session")
    }

    func testToujoursEndsRestOnPlayback() {
        let app = launch("restEnding", sound: "over")
        cover(app)
        restEnds(app)
        XCTAssertEqual(probe(app).label, "1", "one tone at the rest's end")
        XCTAssertEqual(probe(app).value as? String, "over|playback|rest.wav", "in the playback session")
    }

    func testNotificationSoundFollowsChoice() {
        for (sound, expected) in [("off", "none"), ("on", "rest.wav"), ("over", "rest.wav")] {
            let app = launch("restEnding", sound: sound)
            cover(app)
            XCTAssertTrue(
                probe(app).waitFor(NSPredicate(format: "value ENDSWITH %@", "|\(expected)"), timeout: 5),
                "the planned notification's sound for \(sound): \(probe(app).value ?? "")")
            app.terminate()
        }
    }

    func testCoupeChosenMidRestSilencesThePlannedNotification() {
        let app = launch("lockLogged")
        soundMenu(app)
        XCTAssertTrue(
            probe(app).waitFor(NSPredicate(format: "value ENDSWITH %@", "|rest.wav"), timeout: 5),
            "Discret plans the rest notification with the tone")
        choose(app, "Coupé")
        XCTAssertTrue(
            probe(app).waitFor(NSPredicate(format: "value ENDSWITH %@", "|none"), timeout: 3),
            "the rest notification is planned again without a sound: \(probe(app).value ?? "")")
    }
}
