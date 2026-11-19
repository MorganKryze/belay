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

    /// `inPounds` launches with the unit already set to the pound, for a screen reached only once.
    private func launch(_ fixture: String, inPounds: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
            + (inPounds ? ["-belay.weightUnit", "lb"] : [])
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

    private func queuedSets(_ app: XCUIApplication) -> String? {
        element(app, "fixture-queue").value as? String
    }

    /// The session's « not saved » alert is up; it is closed.
    private func dismissRefusal(_ app: XCUIApplication) {
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 3), "the refusal is said")
        XCTAssertTrue(alert.staticTexts["Ce n’est pas noté. Réessaie."].exists, alert.label)
        alert.buttons.firstMatch.tap()
        XCTAssertTrue(alert.waitForNonExistence(timeout: 3))
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

    /// 62,3 kg is off the 0,25 kg grid and 625 kg past the bounds: ✓ stays grey and the line under
    /// the field says what a load can be.
    func testCorrectionOffTheGridSaysWhy() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        logAndSkip(app, until: "Série 2 sur 4")
        element(app, "done-0-3").tap()
        let load = element(app, "correct-kg").textFields.firstMatch
        XCTAssertTrue(load.waitFor(NSPredicate(format: "value != ''")), "the load is prefilled")
        let line = app.staticTexts["Une charge va de 0 à 500\u{202F}kg, par pas de 0,25\u{202F}kg."]
        XCTAssertFalse(line.exists, "a valid load says nothing")
        for value in ["62,3", "625"] {
            type(value, into: load)
            XCTAssertTrue(line.waitForExistence(timeout: 3), "\(value) is said refused")
            XCTAssertFalse(app.buttons["correct-save"].isEnabled, "\(value) cannot be saved")
        }
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

    /// 62,5 kg and 62,75 kg both read 138 lb: in pounds the recap shows them as one load.
    func testRecapGroupsLoadsThatReadAlikeInPounds() {
        let app = launch("exerciseEnd")
        openCover(app)
        typeLoad(app, "62,75")
        XCTAssertTrue(loadReads(app, "Charge, 62,75 kilos"), element(app, "load").label)
        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"), element(app, "load").label)
        element(app, "log-set").tap()
        let recap = element(app, "exercise-recap")
        XCTAssertTrue(recap.waitForExistence(timeout: 3), "the recap shows")
        XCTAssertTrue(recap.label.hasSuffix(" terminé, 138\u{202F}lb × 8, 8, 7, 6"), recap.label)
    }

    /// Equal counts at 62,5 and 62,75 kg read alike in pounds: the recap says « 4 × 8 à 138 lb ».
    func testRecapCountsEqualSetsThatReadAlikeInPounds() {
        let app = launch("exerciseEnd")
        openCover(app)
        doneRow(app, 5, contains: "× 7")
        XCTAssertTrue(app.swipeUpUntil(element(app, "done-0-5")), "the third set is reached")
        element(app, "done-0-5").tap()
        let count = element(app, "correct-count").textFields.firstMatch
        XCTAssertTrue(count.waitFor(NSPredicate(format: "value != ''"), timeout: 5), "the correction opens")
        // A double tap selects the single figure, which the typed one replaces.
        count.doubleTap()
        count.typeText("8")
        XCTAssertTrue(count.waitFor(NSPredicate(format: "value == '8'")), "the count reads 8: \(String(describing: count.value))")
        app.buttons["correct-save"].tap()
        doneRow(app, 5, contains: "62,5\u{202F}kg × 8")
        typeLoad(app, "62,75")
        XCTAssertTrue(loadReads(app, "Charge, 62,75 kilos"), element(app, "load").label)
        let ruler = element(app, "rep-ruler")
        XCTAssertTrue(ruler.waitFor(NSPredicate(format: "value == '6'")), "the last set opens on 6")
        let start = ruler.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: -120, dy: 0)), withVelocity: .slow, thenHoldForDuration: 0.5)
        XCTAssertTrue(ruler.waitFor(NSPredicate(format: "value == '8'")), "the last set on 8: \(String(describing: ruler.value))")
        switchUnit(app, to: "livres")
        element(app, "log-set").tap()
        let recap = element(app, "exercise-recap")
        XCTAssertTrue(recap.waitForExistence(timeout: 3), "the recap shows")
        XCTAssertTrue(recap.label.hasSuffix(" terminé, 4 × 8 à 138\u{202F}lb"), recap.label)
    }

    /// 62,5 kg to 62,75 kg both read 138 lb: the line says the load is the same, never « +0 lb ».
    func testRiseHiddenByRoundingReadsAsTheSameLoadInPounds() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        typeLoad(app, "62,75")
        XCTAssertTrue(loadReads(app, "Charge, 62,75 kilos"), element(app, "load").label)
        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"), element(app, "load").label)
        let line = element(app, "progression")
        XCTAssertTrue(line.waitFor(NSPredicate(format: "label BEGINSWITH %@", "Même charge")), line.label)
    }

    /// 1 103 lb is past 500 kg once converted: the refusal is said, nothing is queued and the
    /// load stays; 1 102 lb is taken.
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
        let queued = queuedSets(app)
        dismissRefusal(app)
        XCTAssertEqual(queuedSets(app), queued, "nothing more is queued")
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"), "the load stays: \(element(app, "load").label)")
        typeLoad(app, "1102")
        XCTAssertTrue(loadReads(app, "Charge, 1102 livres"), element(app, "load").label)
    }

    /// 625 kg is past the bounds: the card takes it as typed and ✓ refuses it aloud, queuing nothing.
    func testLoadOutsideBoundsInKilosRefusedAtTheTick() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        let queued = queuedSets(app)
        typeLoad(app, "625")
        element(app, "log-set").tap()
        dismissRefusal(app)
        XCTAssertEqual(queuedSets(app), queued, "nothing more is queued")
    }

    /// A text that is not a plain number, « 1e2 », « -0 » or « 62,,5 », is refused aloud and
    /// changes nothing.
    func testUnreadableLoadRefused() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        let queued = queuedSets(app)
        for text in ["1e2", "-0", "62,,5"] {
            typeLoad(app, text)
            dismissRefusal(app)
            XCTAssertTrue(loadReads(app, "Charge, 62,5 kilos"), "\(text) leaves the load: \(element(app, "load").label)")
        }
        XCTAssertEqual(queuedSets(app), queued, "nothing more is queued")
    }

    /// 132 lb typed over a 60 kg load is the load as shown: it is logged at 60 kg, not 59,75.
    func testLoadTypedAsShownInPoundsKeepsItsKilos() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        typeLoad(app, "60")
        XCTAssertTrue(loadReads(app, "Charge, 60 kilos"))
        logAndSkip(app, until: "Série 2 sur 4")
        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 132 livres"))
        typeLoad(app, "132")
        element(app, "log-set").tap()
        XCTAssertTrue(element(app, "skip-rest").waitForExistence(timeout: 3), "the rest starts")
        switchUnit(app, to: "kilos")
        doneRow(app, 4, contains: "60\u{202F}kg × ")
    }

    /// 62,5 kg to 65 kg reads 138 lb to 143 lb: the line says the 5 lb between the two loads shown,
    /// not the 2,5 kg converted on its own (6 lb).
    func testProgressionInPoundsIsTheGapBetweenTheLoadsShown() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        typeLoad(app, "65")
        XCTAssertTrue(loadReads(app, "Charge, 65 kilos"))

        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 143 livres"), element(app, "load").label)
        let line = element(app, "progression")
        XCTAssertTrue(
            line.waitFor(NSPredicate(format: "label == %@", "+5\u{202F}lb depuis la dernière fois")), line.label)
    }

    func testLoadSpokenWithItsUnit() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        XCTAssertTrue(loadReads(app, "Charge, 62,5 kilos"))
        switchUnit(app, to: "livres")
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"), element(app, "load").label)
    }

    /// Any element whose label holds `part`.
    private func labelled(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// One switch in Réglages reaches Accueil's card, the set card and Corps's weigh-in together,
    /// none left in kilos, and a relaunch keeps the pound.
    func testUnitReachesEveryScreenAtOnceAndAfterRelaunch() {
        let app = launch("history")
        app.tab("Corps")
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keypad is open")
        element(app, "weighin-kg").typeText("80,4")
        element(app, "weighin-save").tap()
        let weighIn = element(app, "today.weighIn")
        XCTAssertTrue(app.swipeUpUntil(weighIn))
        XCTAssertTrue(weighIn.comesToRead("Pesée, 80,4 kilos"), weighIn.label)
        app.tab("Accueil")
        openCover(app)
        passWarmups(app)
        XCTAssertTrue(loadReads(app, "Charge, 62,5 kilos"))
        app.buttons["Réduire la séance"].tap()
        XCTAssertTrue(labelled(app, containing: "62,5\u{202F}kg × 8").waitForExistence(timeout: 5), "Accueil's card in kilos")

        switchUnit(app, to: "livres")
        let card = labelled(app, containing: "138\u{202F}lb × 8")
        XCTAssertTrue(card.waitForExistence(timeout: 5), "Accueil's card in pounds")
        XCTAssertFalse(labelled(app, containing: "\u{202F}kg × ").exists, "no load left in kilos on Accueil")
        openCover(app)
        XCTAssertTrue(loadReads(app, "Charge, 138 livres"), element(app, "load").label)
        app.buttons["Réduire la séance"].tap()
        app.tab("Corps")
        XCTAssertTrue(app.swipeUpUntil(weighIn))
        XCTAssertTrue(weighIn.comesToRead("Pesée, 177,25 livres"), "the weigh-in in pounds: \(weighIn.label)")

        let again = launch("keep")
        XCTAssertTrue(labelled(again, containing: "138\u{202F}lb × 8").waitForExistence(timeout: 10), "still pounds on Accueil")
        again.tab("Corps")
        let kept = element(again, "today.weighIn")
        XCTAssertTrue(again.swipeUpUntil(kept))
        XCTAssertTrue(kept.comesToRead("Pesée, 177,25 livres"), "still pounds on Corps: \(kept.label)")
    }

    /// The summary of a set at 65 kg for 8: its record reads 143 lb, its volume in whole pounds.
    func testSummaryVolumeAndRecordInPounds() {
        let app = launch("finished", inPounds: true)
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        app.finishSession()
        let volume = element(app, "summary-volume")
        XCTAssertTrue(volume.waitForExistence(timeout: 5), "the summary shows its volume")
        XCTAssertEqual(volume.label, "Volume, 4\u{202F}156\u{202F}lb", "1 885 kg, converted whole")
        XCTAssertTrue(labelled(app, containing: ", 143\u{202F}lb × 8").exists, "the record in pounds")
        XCTAssertFalse(labelled(app, containing: "\u{202F}kg").exists, "nothing left in kilos")
    }

    /// The preview's last time, then a past session's tiles and sets, in pounds: 62,5 kg reads
    /// 138 lb, the 40 kg warm-up 88 lb, and the 2 512,5 kg of volume 5 539 lb.
    func testPreviewAndPastSessionInPounds() {
        let app = launch("past", inPounds: true)
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let bench = element(app, "plan.ds:0025")
        XCTAssertTrue(bench.waitForExistence(timeout: 5))
        XCTAssertTrue(bench.label.hasSuffix("4 × 6–8 · la dernière fois 138\u{202F}lb × 8, 8, 7, 6"), bench.label)

        let past = launch("pastSession", inPounds: true)
        past.tab("Séances")
        past.segmentedControls.firstMatch.buttons["Historique"].tap()
        let row = past.descendants(matching: .any).matching(identifier: "history.row").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        XCTAssertTrue(past.navigationBars["Séance A"].waitForExistence(timeout: 5))
        XCTAssertEqual(element(past, "past.volume").label, "Volume, 5\u{202F}539\u{202F}lb")
        let sets = past.descendants(matching: .any).matching(identifier: "past.set").allElementsBoundByIndex.map(\.label)
        XCTAssertEqual(
            Array(sets.prefix(4)),
            ["Montée, 88\u{202F}lb × 8", "Série 1, 138\u{202F}lb × 8", "Série 2, 138\u{202F}lb × 7", "Série 3, 138\u{202F}lb × 6"])
    }

    /// The history's row says the session's volume in pounds.
    func testHistoryVolumeInPounds() {
        let app = launch("pastSession", inPounds: true)
        app.tab("Séances")
        app.segmentedControls.firstMatch.buttons["Historique"].tap()
        let row = app.descendants(matching: .any).matching(identifier: "history.row").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(row.label.contains("1\u{202F}h\u{202F}4\u{202F}min · 5\u{202F}539\u{202F}lb"), row.label)
    }

    /// The bench press's page: a barbell steps 5 lb, and last time's 62,5 kg reads 138 lb.
    func testExercisePageIncrementAndLastTimeInPounds() {
        let app = launch("past", inPounds: true)
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let bench = element(app, "plan.ds:0025")
        XCTAssertTrue(bench.waitForExistence(timeout: 5))
        bench.tap()
        XCTAssertTrue(element(app, "exercise-name").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Barre · incrément 5\u{202F}lb"].exists, "the barbell's step in pounds")
        XCTAssertTrue(labelled(app, containing: "138\u{202F}lb × 8, 8, 7, 6").exists, "last time in pounds")
    }
}
