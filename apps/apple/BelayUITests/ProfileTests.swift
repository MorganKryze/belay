import XCTest

/// Profil and Mes compléments, pushed from Réglages: the facts written and cleared, the loss range
/// on its − and + within its bounds, the supplements list renamed, trimmed and added to. `tools`
/// holds a full profile (Homme, 1990, 180 cm); `profileEmpty` none; `bodyUsual` five weeks losing
/// about 0,9 % a week and no profile; `supplements` creatine ticked the last 9 days and Vitamine D
/// never; `supplementsEmpty` no supplement at all.
@MainActor
final class ProfileTests: XCTestCase {
    override func setUp() {
        continueAfterFailure = false
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func reach(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        let row = element(app, id)
        XCTAssertTrue(app.swipeUpUntil(row), "the row \(id) is reached")
        return row
    }

    /// Réglages, from Accueil's avatar.
    private func reglages(_ app: XCUIApplication) {
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Accueil leads to Réglages")
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
    }

    /// Profil, from Réglages' profile cell.
    private func profile(_ fixture: String) -> XCUIApplication {
        let app = XCUIApplication.fixture(fixture)
        reglages(app)
        let cell = element(app, "reglages-profile")
        XCTAssertTrue(cell.waitForExistence(timeout: 5))
        XCTAssertTrue(cell.label.contains("Profil · taille, âge, fourchette de perte"), cell.label)
        cell.tap()
        XCTAssertTrue(app.navigationBars["Profil"].waitForExistence(timeout: 5), "Profil opens")
        return app
    }

    /// Mes compléments, from Réglages › Suivi.
    private func manage(_ fixture: String) -> XCUIApplication {
        let app = XCUIApplication.fixture(fixture)
        reglages(app)
        reach(app, "reglages-supplements").tap()
        XCTAssertTrue(app.navigationBars["Mes compléments"].waitForExistence(timeout: 5), "Mes compléments opens")
        return app
    }

    private func back(_ app: XCUIApplication) {
        app.navigationBars.buttons.firstMatch.tap()
    }

    // MARK: A33

    func testFactsWriteAndSay() {
        let app = profile("profileEmpty")
        XCTAssertTrue(app.staticTexts["Ton corps"].exists)
        XCTAssertTrue(
            app.staticTexts["Tout est facultatif. Chaque information ne sert qu’aux outils indiqués."].exists,
            "the footer")
        XCTAssertTrue(app.staticTexts["Sert à\u{202F}: Dépense énergétique, Masse grasse"].exists)
        XCTAssertTrue(app.staticTexts["Sert à\u{202F}: Dépense énergétique"].exists)
        XCTAssertTrue(app.staticTexts["Sert à\u{202F}: IMC, Masse grasse, Dépense énergétique"].exists)

        app.buttons["Renseigner formule"].tap()
        let formula = app.segmentedControls["profile-formula"]
        XCTAssertTrue(formula.waitForExistence(timeout: 3), "Femme | Homme in the row")
        formula.buttons["Femme"].tap()
        XCTAssertTrue(formula.buttons["Femme"].isSelected)

        app.buttons["Renseigner année de naissance"].tap()
        let year = element(app, "profile-birth-year")
        XCTAssertTrue(year.waitForExistence(timeout: 3))
        year.tap()
        XCTAssertTrue(app.buttons["2000"].firstMatch.waitForExistence(timeout: 3), "a menu of years")
        // The menu builds its rows as they scroll in, newest first: scroll down to 1990.
        let choice = app.buttons["1990"].firstMatch
        XCTAssertTrue(app.swipeUpUntil(choice), "1990 is in the menu")
        choice.tap()
        XCTAssertTrue(year.waitFor(NSPredicate(format: "label CONTAINS '1990'"), timeout: 3), year.label)

        app.buttons["Renseigner taille"].tap()
        let height = app.textFields["profile-height"]
        XCTAssertTrue(height.waitForExistence(timeout: 3))
        for key in ["1", "7", "2"] { app.keys[key].tap() }
        // The number pad has no return key: a drag down the list puts it away, and the height is
        // written as it leaves.
        app.putKeypadAway()
        XCTAssertFalse(app.keyboards.firstMatch.exists, "the keypad goes away")

        // Read again from the store a relaunch opens.
        let again = XCUIApplication.fixture("keep")
        reglages(again)
        element(again, "reglages-profile").tap()
        XCTAssertTrue(again.navigationBars["Profil"].waitForExistence(timeout: 5))
        XCTAssertTrue(again.segmentedControls["profile-formula"].buttons["Femme"].isSelected, "Femme kept")
        XCTAssertTrue(element(again, "profile-birth-year").label.contains("1990"), "1990 kept")
        XCTAssertEqual(again.textFields["profile-height"].value as? String, "172", "172 cm kept")
    }

    func testSwipeEffacerWritesNull() {
        let app = profile("tools")
        let row = element(app, "profile-fact-height")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertEqual(app.textFields["profile-height"].value as? String, "180")
        row.swipeLeft()
        let clear = app.buttons["Effacer"]
        XCTAssertTrue(clear.waitForExistence(timeout: 3), "a swipe offers « Effacer »")
        clear.tap()
        XCTAssertTrue(app.buttons["Renseigner taille"].waitForExistence(timeout: 3), "the fact is empty")

        let again = XCUIApplication.fixture("keep")
        reglages(again)
        element(again, "reglages-profile").tap()
        XCTAssertTrue(again.buttons["Renseigner taille"].waitForExistence(timeout: 5), "still empty after a relaunch")
        XCTAssertFalse(again.buttons["Renseigner formule"].exists, "the other facts stay")
    }

    // MARK: A34

    func testRangeStepsAndBounds() {
        let app = profile("bodyUsual")
        let low = element(app, "range-min")
        let high = element(app, "range-max")
        XCTAssertTrue(app.swipeUpUntil(high))
        XCTAssertEqual(low.label, "Au moins, 0,5\u{202F}%")
        XCTAssertEqual(high.label, "Au plus, 1\u{202F}%")
        let lowMinus = app.buttons["range-min-minus"], lowPlus = app.buttons["range-min-plus"]
        let highMinus = app.buttons["range-max-minus"], highPlus = app.buttons["range-max-plus"]
        XCTAssertFalse(highPlus.isEnabled, "1 % is the top")
        XCTAssertEqual(lowMinus.label, "Retirer 0,05\u{202F}%")
        for _ in 0..<5 { lowMinus.tap() }
        XCTAssertEqual(low.label, "Au moins, 0,25\u{202F}%", "by 0,05 % down to 0,25 %")
        XCTAssertFalse(lowMinus.isEnabled, "0,25 % is the bottom")
        // The lower stays 0,1 under the upper: 0,25 up to 0,7, the upper down to 0,8.
        for _ in 0..<4 { highMinus.tap() }
        XCTAssertEqual(high.label, "Au plus, 0,8\u{202F}%")
        for _ in 0..<9 { lowPlus.tap() }
        XCTAssertEqual(low.label, "Au moins, 0,7\u{202F}%")
        XCTAssertFalse(lowPlus.isEnabled, "the lower stops 0,1 under the upper")
        XCTAssertFalse(highMinus.isEnabled, "and the upper 0,1 above the lower")
        XCTAssertTrue(app.staticTexts["Comment c’est choisi"].exists)

        back(app)
        back(app)
        app.tab("Corps")
        let range = element(app, "trend-range")
        XCTAssertTrue(range.waitForExistence(timeout: 5))
        XCTAssertTrue(range.label.contains("hors de ta fourchette, 0,7 à 0,8"), "Corps reads the new range: \(range.label)")

        let again = XCUIApplication.fixture("keep")
        reglages(again)
        element(again, "reglages-profile").tap()
        XCTAssertTrue(again.swipeUpUntil(element(again, "range-max")))
        XCTAssertEqual(element(again, "range-min").label, "Au moins, 0,7\u{202F}%", "the last tap is the one written")
        XCTAssertEqual(element(again, "range-max").label, "Au plus, 0,8\u{202F}%")
    }

    /// What Profil writes and what waits to be sent: « target=0.3-0.6 height=168 queued=0 ».
    private func stored(_ app: XCUIApplication) -> String {
        element(app, "fixture-profile").value as? String ?? ""
    }

    /// A range another device wrote, landed while Profil is open, shows there, and leaving
    /// without a tap writes nothing over it.
    func testPulledRangeIsKept() {
        let app = XCUIApplication.fixture("bodyUsual", pull: "range")
        reglages(app)
        element(app, "reglages-profile").tap()
        let low = element(app, "range-min")
        XCTAssertTrue(app.swipeUpUntil(element(app, "range-max")))
        XCTAssertEqual(low.label, "Au moins, 0,5\u{202F}%")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(low.comesToRead("Au moins, 0,3\u{202F}%"), "the pulled range shows: \(low.label)")
        XCTAssertEqual(element(app, "range-max").label, "Au plus, 0,6\u{202F}%")
        back(app)
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            element(app, "fixture-profile").waitFor(NSPredicate(format: "value BEGINSWITH 'target=0.3-0.6 '"), timeout: 3))
        XCTAssertTrue(stored(app).hasSuffix("queued=0"), "leaving queues nothing: \(stored(app))")
    }

    /// A height another device wrote shows in the untouched field; a focus without typing writes
    /// nothing, and a height typed then left with the keypad up is written.
    func testPulledHeightAndTypedHeight() {
        let app = XCUIApplication.fixture("tools", pull: "height")
        reglages(app)
        element(app, "reglages-profile").tap()
        let height = app.textFields["profile-height"]
        XCTAssertTrue(height.waitForExistence(timeout: 5))
        XCTAssertEqual(height.value as? String, "180")
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(height.waitFor(NSPredicate(format: "value == '168'"), timeout: 5), "the pulled height shows")
        height.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        app.putKeypadAway()
        back(app)
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5))
        XCTAssertEqual(stored(app), "target=none height=168 queued=0", "an untouched field writes nothing")

        element(app, "reglages-profile").tap()
        XCTAssertTrue(height.waitForExistence(timeout: 5))
        height.tapAtEnd()
        height.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
        for key in ["1", "7", "5"] { app.keys[key].tap() }
        XCTAssertTrue(app.keyboards.firstMatch.exists, "the keypad is still up")
        back(app)
        XCTAssertTrue(
            element(app, "fixture-profile").waitFor(NSPredicate(format: "value == 'target=none height=175 queued=1'"), timeout: 3),
            "the typed height is written as the page closes: \(stored(app))")
    }

    // MARK: A35

    func testManageRenameRemoveKeepsDays() {
        let app = manage("supplements")
        let creatine = element(app, "manage-0")
        XCTAssertTrue(creatine.waitForExistence(timeout: 5))
        XCTAssertEqual(creatine.label, "Créatine, 9 jours marqués")
        XCTAssertEqual(element(app, "manage-1").label, "Vitamine D, 0 jour marqué")

        creatine.tap()
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 3), "a tap renames in an alert")
        let field = alert.textFields.firstMatch
        field.tap()
        field.typeText(" mono")
        alert.buttons["Enregistrer"].tap()
        XCTAssertTrue(creatine.comesToRead("Créatine mono, 9 jours marqués"), "renamed, its days kept: \(creatine.label)")

        let vitamin = element(app, "manage-1")
        vitamin.swipeLeft()
        XCTAssertTrue(app.buttons["Renommer"].waitForExistence(timeout: 3), "a swipe offers Renommer")
        app.buttons["Retirer"].tap()
        XCTAssertFalse(element(app, "manage-1").waitForExistence(timeout: 2), "Vitamine D leaves the list")
        back(app)
        XCTAssertTrue(reach(app, "reglages-supplements").label.contains("1 dans ta liste"))

        // From Corps › Compléments: « Gérer ma liste » leads to the same page.
        back(app)
        app.tab("Corps")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.supplements")))
        element(app, "today.supplements").tap()
        XCTAssertTrue(app.navigationBars["Compléments"].waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "supplement-0").label, "Créatine mono, pris · depuis 9 jours", "its days still count")
        reach(app, "supplements-manage").tap()
        XCTAssertTrue(app.navigationBars["Mes compléments"].waitForExistence(timeout: 5), "Corps leads to the list")
    }

    // MARK: A36

    func testAddSheetRefusesDuplicate() {
        let app = manage("supplements")
        app.buttons["manage-add"].tap()
        XCTAssertTrue(app.sheetTitle("Complément").waitForExistence(timeout: 5), "the add sheet opens")
        let save = app.buttons["supplement-save"]
        XCTAssertFalse(save.isEnabled, "✓ waits for a name")
        let field = app.textFields["supplement-name"]
        field.tap()
        field.typeText("vitamine d")
        XCTAssertTrue(app.staticTexts["Ce complément est déjà dans ta liste."].waitForExistence(timeout: 3))
        XCTAssertFalse(save.isEnabled, "a name on the list, case and accents aside, is refused")
        field.typeText("3")
        XCTAssertTrue(save.waitFor(NSPredicate(format: "enabled == true"), timeout: 3), "a new name can be saved")
        save.tap()
        XCTAssertTrue(element(app, "manage-2").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "manage-2").label, "vitamine d3, 0 jour marqué")
    }

    func testSuggestionLeavesOnceAdded() {
        let app = manage("supplements")
        app.buttons["manage-add"].tap()
        XCTAssertTrue(app.sheetTitle("Complément").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["suggestion-creatine"].exists, "Créatine is on the list already")
        XCTAssertFalse(app.buttons["suggestion-vitaminD"].exists, "Vitamine D too")
        let magnesium = app.buttons["suggestion-magnesium"]
        XCTAssertTrue(magnesium.exists)
        magnesium.tap()
        XCTAssertEqual(app.textFields["supplement-name"].value as? String, "Magnésium", "the chip fills the name")
        app.buttons["supplement-save"].tap()
        XCTAssertTrue(element(app, "manage-2").waitForExistence(timeout: 5))
        app.buttons["manage-add"].tap()
        XCTAssertTrue(app.sheetTitle("Complément").waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["suggestion-magnesium"].exists, "Magnésium has left the suggestions")
        XCTAssertTrue(app.buttons["suggestion-zinc"].exists)
    }

    // MARK: A37

    func testEmptyListOffersAdd() {
        let app = manage("supplementsEmpty")
        XCTAssertTrue(app.staticTexts["Aucun complément dans ta liste pour l’instant."].waitForExistence(timeout: 5))
        let add = app.buttons["manage-add-first"]
        XCTAssertTrue(add.exists)
        XCTAssertEqual(add.label, "Ajouter un complément")
        add.tap()
        XCTAssertTrue(app.sheetTitle("Complément").waitForExistence(timeout: 5), "it opens the add sheet")

        // Corps › Compléments' empty state leads here.
        let corps = XCUIApplication.fixture("supplementsEmpty")
        corps.tab("Corps")
        XCTAssertTrue(corps.swipeUpUntil(element(corps, "today.supplements")))
        element(corps, "today.supplements").tap()
        XCTAssertTrue(corps.navigationBars["Compléments"].waitForExistence(timeout: 5))
        XCTAssertFalse(corps.staticTexts["Ta liste se règle sur le web pour l’instant."].exists, "no word of the web")
        element(corps, "supplements-manage").tap()
        XCTAssertTrue(corps.navigationBars["Mes compléments"].waitForExistence(timeout: 5))
    }

    // MARK: A48

    func testNoCompactTitle() {
        for (fixture, title, open) in [
            ("tools", "Profil", "reglages-profile"), ("supplements", "Mes compléments", "reglages-supplements"),
        ] {
            let app = XCUIApplication.fixture(fixture)
            reglages(app)
            reach(app, open).tap()
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5))
            XCTAssertGreaterThan(app.largeTitleHeight(title), 30, "\(title) opens on a large title")
            app.swipeUp()
            let inBar = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == %@", title))
                .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 && $0.frame.height < 30 }
            XCTAssertFalse(inBar, "\(title): no compact title once scrolled")
        }
    }
}
