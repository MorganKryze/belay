import XCTest

/// The session cover in pounds, on the fixture account whose last session A logged the bench press
/// at 62,5 kg (138 lb) for 8, 8, 7 and 6. The unit is switched in Réglages, the cover lowered first
/// when a session is under way. Each set stays stored in kilos: a load shown in pounds and left as
/// shown keeps its exact kilos.
@MainActor
final class UnitsTests: XCTestCase {
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

    /// Accueil's Reprendre opens the cover, tapped again only while the cover has not come.
    private func openCover(_ app: XCUIApplication) {
        let resume = app.buttons["Reprendre"]
        let clock = element(app, "session-clock")
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        let deadline = Date.now.addingTimeInterval(10)
        while !clock.exists, Date.now < deadline {
            if resume.exists, resume.isHittable { resume.tap() }
            _ = clock.waitForExistence(timeout: 2)
        }
        XCTAssertTrue(clock.exists, "the cover shows")
    }

    /// Réglages from Accueil, the weight unit set to `word` (« kilos » or « livres »), back to
    /// Accueil. From the cover, the cover is lowered first and opened again after.
    private func switchUnit(_ app: XCUIApplication, to word: String) {
        let fromCover = element(app, "session-clock").exists
        if fromCover { app.buttons["Réduire la séance"].tap() }
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Accueil leads to Réglages")
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
        let row = element(app, "reglages-weight-unit")
        XCTAssertTrue(app.swipeUpUntil(row), "the unit row is reached")
        // Clear of the tab bar and of the open session's bar above it, where a tap would land on them.
        let bar = app.tabBars.firstMatch
        let accessory = element(app, "resume-accessory")
        func top() -> CGFloat { accessory.exists ? accessory.frame.minY : bar.frame.minY }
        for _ in 0..<3 where bar.exists && row.frame.maxY > top() - 8 {
            app.swipeUp(velocity: .slow)
        }
        // Right after launch the list can still move under the first tap: tapped again until chosen.
        let choice = row.segmentedControls.firstMatch.buttons[word]
        let chosen = NSPredicate(format: "isSelected == true")
        for _ in 0..<3 where !choice.isSelected {
            choice.tap()
            _ = choice.waitFor(chosen, timeout: 2)
        }
        XCTAssertTrue(choice.isSelected, "\(word) chosen")
        app.navigationBars.buttons.firstMatch.tap()
        if fromCover { openCover(app) }
    }

    /// The two warm-ups of the bench press, each with one ✓, until its first work set is up.
    private func passWarmups(_ app: XCUIApplication) {
        for _ in 0..<2 { element(app, "log-set").tap() }
        XCTAssertTrue(dueSet(app, "Série 1 sur 4"), "the first work set")
    }

    private func dueSet(_ app: XCUIApplication, _ title: String) -> Bool {
        element(app, "set-title").waitFor(NSPredicate(format: "label == %@", title), timeout: 10)
    }

    /// The set card's load comes to be spoken as `spoken`.
    private func loadReads(_ app: XCUIApplication, _ spoken: String) -> Bool {
        element(app, "load").waitFor(NSPredicate(format: "label == %@", spoken))
    }

    /// « Autre charge… », `value` typed on the keypad, then OK.
    private func typeLoad(_ app: XCUIApplication, _ value: String) {
        element(app, "load").tap()
        app.buttons["Autre charge…"].tap()
        let keypad = app.alerts.textFields.firstMatch
        XCTAssertTrue(keypad.waitForExistence(timeout: 3), "a keypad opens")
        keypad.typeText(value)
        app.alerts.buttons["OK"].tap()
    }

    /// ✓ on the set due, then the rest skipped until `next` is due.
    private func logAndSkip(_ app: XCUIApplication, until next: String) {
        element(app, "log-set").tap()
        let skip = element(app, "skip-rest")
        XCTAssertTrue(skip.waitForExistence(timeout: 3), "the rest starts")
        skip.tap()
        XCTAssertTrue(dueSet(app, next), "\(next) is due")
    }

    private func doneRow(_ app: XCUIApplication, _ position: Int, contains part: String) {
        let row = element(app, "done-0-\(position)")
        XCTAssertTrue(row.waitFor(NSPredicate(format: "label CONTAINS %@", part)), "« \(part) »: \(row.label)")
    }

    private func type(_ value: String, into field: XCUIElement) {
        field.tap()
        if let current = field.value as? String, !current.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
        }
        field.typeText(value)
    }

    func testPrefilledLoadConfirmedInPoundsKeepsItsKilos() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        typeLoad(app, "60")
        XCTAssertTrue(loadReads(app, "Charge, 60 kilos"))
        logAndSkip(app, until: "Série 2 sur 4")

        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 132 livres"), "60 kg reads 132 lb: \(element(app, "load").label)")
        logAndSkip(app, until: "Série 3 sur 4")
        XCTAssertTrue(loadReads(app, "Charge, 132 livres"))
        typeLoad(app, "225")
        XCTAssertTrue(loadReads(app, "Charge, 225 livres"))
        element(app, "log-set").tap()
        XCTAssertTrue(element(app, "skip-rest").waitForExistence(timeout: 3), "the rest starts")

        switchUnit(app, to: "kilos")
        doneRow(app, 3, contains: "60\u{202F}kg × ")
        doneRow(app, 4, contains: "60\u{202F}kg × ")
        doneRow(app, 5, contains: "102\u{202F}kg × ")
    }

    /// 100 kg reads 220 lb, which converts to 99,75: the 220 offered is still the load itself.
    func testLoadChoicesStepByEquipmentInPounds() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        typeLoad(app, "100")
        XCTAssertTrue(loadReads(app, "Charge, 100 kilos"))

        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 220 livres"))
        element(app, "load").tap()
        // A barbell steps 5 lb in a pound gym: one step below the load, the load, one and two above.
        for lb in ["215", "220", "225", "230"] {
            XCTAssertTrue(app.buttons["\(lb)\u{202F}lb"].waitForExistence(timeout: 2), "\(lb) lb is offered")
        }
        XCTAssertTrue(app.buttons["220\u{202F}lb"].isSelected, "the load is the one marked")
        for lb in ["215", "225", "230"] {
            XCTAssertFalse(app.buttons["\(lb)\u{202F}lb"].isSelected, "\(lb) lb is not marked")
        }
        app.buttons["225\u{202F}lb"].tap()
        XCTAssertTrue(loadReads(app, "Charge, 225 livres"))
    }

    /// 100 kg reads 220 lb in the sheet; changing the reps alone leaves 100 kg, not 99,75.
    func testCorrectionInPoundsKeepsUnchangedKilos() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        typeLoad(app, "100")
        XCTAssertTrue(loadReads(app, "Charge, 100 kilos"))
        logAndSkip(app, until: "Série 2 sur 4")

        switchUnit(app, to: "livres")
        doneRow(app, 3, contains: "220\u{202F}lb × ")
        element(app, "done-0-3").tap()
        let load = element(app, "correct-kg").textFields.firstMatch
        let count = element(app, "correct-count").textFields.firstMatch
        XCTAssertTrue(load.waitFor(NSPredicate(format: "value == %@", "220")), "the load in pounds: \(String(describing: load.value))")
        XCTAssertTrue(count.waitFor(NSPredicate(format: "value != ''")), "the count is prefilled")
        type("5", into: count)
        app.buttons["correct-save"].tap()
        doneRow(app, 3, contains: "220\u{202F}lb × 5")

        switchUnit(app, to: "kilos")
        doneRow(app, 3, contains: "100\u{202F}kg × 5")
    }

    func testExerciseEndAndDoneListInPounds() {
        let app = launch("exerciseEnd")
        switchUnit(app, to: "livres")
        openCover(app)
        doneRow(app, 3, contains: "138\u{202F}lb × 8")
        element(app, "log-set").tap()
        let recap = element(app, "exercise-recap")
        XCTAssertTrue(recap.waitForExistence(timeout: 3), "the recap shows")
        XCTAssertTrue(recap.label.hasSuffix(" terminé, 138\u{202F}lb × 8, 8, 7, 6"), recap.label)
        recap.tap()
        let next = element(app, "announce-load")
        XCTAssertTrue(next.waitForExistence(timeout: 2), "the next exercise is announced")
        XCTAssertEqual(next.label, "53\u{202F}lb × 5", "24 kg in pounds")
    }

    /// 1 103 lb is past 500 kg once converted: the load stays; 1 102 lb is taken.
    func testLoadOutsideBoundsInPoundsRefused() {
        let app = launch("history")
        switchUnit(app, to: "livres")
        openCover(app)
        passWarmups(app)
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"))
        element(app, "load").tap()
        app.buttons["Autre charge…"].tap()
        let keypad = app.alerts.textFields.firstMatch
        XCTAssertTrue(keypad.waitForExistence(timeout: 3), "a keypad opens")
        XCTAssertEqual(keypad.placeholderValue, "Charge en lb")
        keypad.typeText("1103")
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForNonExistence(timeout: 3))
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"), "1 103 lb is let go: \(element(app, "load").label)")
        typeLoad(app, "1102")
        XCTAssertTrue(loadReads(app, "Charge, 1102 livres"), element(app, "load").label)
    }

    func testLoadSpokenWithItsUnit() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        XCTAssertTrue(loadReads(app, "Charge, 62,5 kilos"))
        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"), element(app, "load").label)
    }
}
