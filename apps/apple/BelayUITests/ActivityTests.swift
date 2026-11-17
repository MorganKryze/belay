import XCTest

/// Accueil's « Activité » row and its sheet, on the fixture's activity and steps modes; then the
/// steps import's switch in Réglages and the words Santé's refusals take, on the `fresh` store with
/// Santé off. Health's answer is the fixture's (`-BelayHealth`): the system's own sheet is proved
/// on the phone.
@MainActor
final class ActivityTests: XCTestCase {
    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// Accueil's row, reached.
    private func row(_ app: XCUIApplication) -> XCUIElement {
        let row = element(app, "today.activity")
        XCTAssertTrue(row.waitForExistence(timeout: 10), "Accueil shows « Activité »")
        XCTAssertTrue(app.swipeUpUntil(row))
        return row
    }

    /// The row's words with plain spaces, so a test reads « 1 h 30 » as it is written.
    private func words(_ element: XCUIElement) -> String {
        element.label.replacingOccurrences(of: "\u{202F}", with: " ").replacingOccurrences(of: "\u{00A0}", with: " ")
    }

    private func reads(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 5) -> Bool {
        let end = Date.now.addingTimeInterval(timeout)
        while Date.now < end {
            if words(element) == label { return true }
            RunLoop.current.run(until: Date.now.addingTimeInterval(0.25))
        }
        return words(element) == label
    }

    /// The sheet, opened from Accueil's row.
    private func sheet(_ app: XCUIApplication) {
        row(app).tap()
        XCTAssertTrue(element(app, "activity-kind").waitForExistence(timeout: 5), "the sheet opens on its kinds")
    }

    private func kind(_ app: XCUIApplication, _ name: String) {
        element(app, "activity-kind").buttons[name].tap()
    }

    /// A38: nothing yet, one activity, the steps alone, then several, the steps counting as one.
    func testRowStatesAndCounts() {
        for (mode, health, label) in [
            ("activityNone", nil, "Activité, pas encore saisie"),
            ("activityOne", nil, "Activité, Escalade · 1 h 30"),
            ("stepsNone", "allowed", "Activité, 8 437 pas"),
            ("activityMany", nil, "Activité, 2 activités"),
        ] {
            let app = XCUIApplication.fixture(mode, health: health)
            let row = row(app)
            XCTAssertTrue(reads(row, label, timeout: 10), "\(mode): \(words(row))")
            XCTAssertEqual(row.value as? String, mode == "activityNone" ? "" : "saisie", "\(mode): the ✓ is said")
        }
    }

    /// A39: ✓ writes one cardio, read back on Accueil and listed once under the day.
    func testCardioLogsOne() {
        let app = XCUIApplication.fixture("activityNone")
        sheet(app)
        kind(app, "Cardio")
        element(app, "cardio-bike").tap()
        element(app, "activity-duration-plus").tap()
        element(app, "activity-save").tap()
        XCTAssertTrue(reads(row(app), "Activité, Vélo · 50 min"), words(row(app)))

        sheet(app)
        XCTAssertTrue(element(app, "activity-day-0").waitForExistence(timeout: 3), "the day's cardio is listed")
        XCTAssertFalse(element(app, "activity-day-1").exists, "once")
    }

    /// A39: the hardest climb is a grade or a colour, never both; the one shown last is saved.
    func testClimbGradeOrColourNotBoth() {
        let app = XCUIApplication.fixture("activityNone")
        sheet(app)
        kind(app, "Escalade")
        let grade = element(app, "climb-grade")
        XCTAssertTrue(app.swipeUpUntil(grade))
        grade.tap()
        let sixA = app.buttons["6a"].firstMatch
        XCTAssertTrue(sixA.waitForExistence(timeout: 3), "the grades open as a menu")
        sixA.tap()
        element(app, "climb-by").buttons["Couleur"].tap()
        XCTAssertFalse(grade.exists, "the grade leaves once the colour is chosen")
        let blue = element(app, "colour-blue")
        XCTAssertTrue(app.swipeUpUntil(blue))
        blue.tap()
        element(app, "activity-save").tap()
        XCTAssertTrue(reads(row(app), "Activité, Escalade · 1 h 30 · bleu"), words(row(app)))
    }

    /// A39: a new entry has nothing to delete; the day's climb, picked, deletes after asking.
    func testPickedOpensWithDelete() {
        let app = XCUIApplication.fixture("activityOne")
        sheet(app)
        XCTAssertFalse(element(app, "activity-delete").exists, "a new entry deletes nothing")
        let picked = element(app, "activity-day-0")
        XCTAssertTrue(picked.waitForExistence(timeout: 3))
        XCTAssertTrue(words(picked).contains("Escalade · 1 h 30"), words(picked))
        picked.tap()
        let delete = element(app, "activity-delete")
        XCTAssertTrue(app.swipeUpUntil(delete), "« Supprimer l’activité » shows")
        XCTAssertEqual(delete.label, "Supprimer l’activité")
        delete.tap()
        let confirm = app.buttons["Supprimer"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 3), "it asks first")
        confirm.tap()
        XCTAssertTrue(reads(row(app), "Activité, pas encore saisie"), words(row(app)))
    }

    /// R2: the sheet opens on the kind last chosen on this phone.
    func testKindKeptOnThisPhone() {
        let app = XCUIApplication.fixture("activityNone")
        sheet(app)
        XCTAssertTrue(element(app, "activity-kind").buttons["Escalade"].isSelected, "climbing first, as the web")
        kind(app, "Pas")
        element(app, "activity-close").tap()
        sheet(app)
        XCTAssertTrue(element(app, "activity-kind").buttons["Pas"].isSelected, "Pas kept")
    }

    /// A40: the day's steps from Santé, read only, said as this phone's import.
    func testPasReadOnlyFromSante() {
        let app = XCUIApplication.fixture("stepsNone", health: "allowed")
        XCTAssertTrue(reads(row(app), "Activité, 8 437 pas", timeout: 10), words(row(app)))
        sheet(app)
        kind(app, "Pas")
        let steps = element(app, "steps-value")
        XCTAssertTrue(steps.waitForExistence(timeout: 3))
        XCTAssertEqual(words(steps), "8 437 pas, depuis Santé")
        XCTAssertEqual(app.textFields.count, 0, "nothing to type")
        XCTAssertFalse(element(app, "activity-save").isEnabled, "nothing to save")
    }

    /// A40, R5: with the import off, the segment says where steps come from and turns it on.
    func testPasOffersImportWhenOff() {
        let app = XCUIApplication.fixture("stepsOff", health: "allowed")
        sheet(app)
        kind(app, "Pas")
        let offer = element(app, "steps-import")
        XCTAssertTrue(offer.waitForExistence(timeout: 3), "the import is offered")
        XCTAssertTrue(app.staticTexts["Les pas viennent de Santé."].exists, "it says where steps come from")
        offer.tap()
        XCTAssertTrue(element(app, "steps-value").waitForExistence(timeout: 15), "the day's steps come in")
        XCTAssertFalse(offer.exists, "the offer leaves")
    }

    /// A40: the import on, a day Santé holds no steps for says so.
    func testPasSaysNoneWhenEmpty() {
        let app = XCUIApplication.fixture("stepsNone")
        sheet(app)
        kind(app, "Pas")
        XCTAssertTrue(app.staticTexts["Aucun pas dans Santé pour ce jour."].waitForExistence(timeout: 3))
        XCTAssertFalse(element(app, "steps-import").exists, "the import is on")
    }

    /// A52: past midnight, the row reads the new day.
    func testMidnightRollsActivity() {
        let app = XCUIApplication.fixture("activityOne", now: "2026-11-06T23:59:30")
        let row = row(app)
        XCTAssertTrue(reads(row, "Activité, Escalade · 1 h 30"), words(row))
        XCTAssertTrue(reads(row, "Activité, pas encore saisie", timeout: 60), "the new day: \(words(row))")
    }
    /// « Sur cet iPhone », reached from Accueil's avatar.
    private func santeSection(_ health: String) -> XCUIApplication {
        let app = XCUIApplication.fixture("fresh", health: health)
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
        XCTAssertTrue(app.swipeUpUntil(app.switches["health-steps-switch"]), "« Sur cet iPhone » is reached")
        return app
    }

    private func footer(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["health-footer"].firstMatch
    }

    /// A29, R5: with Santé off, the steps switch turns Santé on first, then itself.
    func testStepsSwitchTurnsSanteOnFirst() {
        let app = santeSection("allowed")
        let sante = app.switches["health-switch"]
        let steps = app.switches["health-steps-switch"]
        XCTAssertEqual(sante.value as? String, "0", "Santé starts off")
        steps.switches.firstMatch.tap()
        XCTAssertTrue(steps.waitFor(NSPredicate(format: "value == '1'"), timeout: 5), "the steps import is on")
        XCTAssertEqual(sante.value as? String, "1", "Santé went on with it")
        XCTAssertEqual(app.switches["health-import-switch"].value as? String, "0", "the weigh-ins stay as they were")
    }

    /// A29: the footer says what the steps switch does and where to allow a refused read.
    func testFooterNamesSteps() {
        let app = santeSection("allowed")
        XCTAssertTrue(app.swipeUpUntil(footer(app)))
        let words = footer(app).label
        XCTAssertTrue(words.contains("Importer les pas ajoute tes pas de Santé"), words)
        XCTAssertTrue(words.contains("lire le poids et les pas"), words)
    }

    /// R18: iOS refusing Santé, each switch says what was refused in its own words.
    func testRefusalWordsPerSwitch() {
        let cases = [
            ("health-switch", "Santé n’autorise pas Belay à y écrire tes séances."),
            ("health-import-switch", "Pour importer tes pesées, Belay a besoin de l’accès à Santé."),
            ("health-steps-switch", "Pour importer tes pas, Belay a besoin de l’accès à Santé."),
        ]
        for (id, words) in cases {
            let app = santeSection("refused")
            let toggle = app.switches[id]
            toggle.switches.firstMatch.tap()
            XCTAssertTrue(toggle.waitFor(NSPredicate(format: "value == '0'"), timeout: 5), "\(id) stays off")
            XCTAssertTrue(app.swipeUpUntil(footer(app)))
            XCTAssertTrue(
                footer(app).waitFor(NSPredicate(format: "label BEGINSWITH %@", words), timeout: 5),
                "\(id): \(footer(app).label)")
            XCTAssertEqual(app.switches["health-switch"].value as? String, "0", "Santé stays off")
        }
    }

    /// R18: Corps's card names the weigh-ins it imports, never the sessions Santé would hold.
    func testCorpsCardWordsSayWeighIns() {
        let app = XCUIApplication.fixture("healthCard", health: "refused")
        app.tab("Corps")
        let accept = app.buttons["Importer les pesées"]
        XCTAssertTrue(accept.waitForExistence(timeout: 10))
        accept.tap()
        let refusal = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Belay a besoin'")).firstMatch
        XCTAssertTrue(refusal.waitForExistence(timeout: 5), "the card says why")
        XCTAssertTrue(refusal.label.contains("tes pesées"), refusal.label)
        XCTAssertFalse(refusal.label.contains("séances"), refusal.label)
    }


    /// A39: Escalade as Proto: « Date de l’activité », then Type, Durée, Voies ou blocs; Pas says « Jour ».
    func testEscaladeOrderAndLabels() {
        let app = XCUIApplication.fixture("activityOne")
        sheet(app)
        kind(app, "Escalade")
        XCTAssertTrue(app.staticTexts["Date de l’activité"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Type"].exists, "the segment is named")
        XCTAssertLessThan(element(app, "activity-duration").frame.minY, element(app, "climb-runs").frame.minY)
        kind(app, "Pas")
        XCTAssertTrue(app.staticTexts["Jour"].waitForExistence(timeout: 3))
    }
}
