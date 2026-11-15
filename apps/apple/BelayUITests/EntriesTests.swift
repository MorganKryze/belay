import XCTest

/// Mensurations, Apports and Compléments, and their sheets, on the fixture's body modes:
/// `measures` holds five waists a week apart from 86,1 cm down to 84,5 cm three days ago, the
/// oldest with a neck and hips; `intake` holds today's 1 850 kcal and 128 g with a full profile;
/// `supplements` has creatine ticked every day of the last 9 and Vitamine D not yet; `bodyUsual`
/// has today's intake and no profile; `bodyEarly` has no supplement.
@MainActor
final class EntriesTests: XCTestCase {
    /// Launches on `fixture`, opens `tab` and taps its « Aujourd'hui » row `row`, then waits for
    /// the screen `title`.
    private func open(
        _ title: String, row: String, fixture: String, tab: String = "Corps", largestText: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication.fixture(fixture, largestText: largestText)
        let button = app.tabBars.firstMatch.buttons[tab]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
        XCTAssertTrue(app.swipeUpUntil(element(app, row), swipes: 10), "\(row) can be reached")
        // At the largest sizes the row may sit under the tab bar, which takes the tap: once more,
        // a swipe higher.
        let bar = app.tabBars.firstMatch.frame
        if element(app, row).frame.maxY > bar.minY { app.swipeUp(velocity: .slow) }
        element(app, row).tap()
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5), "\(row) opens \(title)")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// A day as the history writes it, « Lundi 5 octobre », `offset` days from today.
    private func longDay(_ offset: Int) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.dateFormat = "EEEE d MMMM"
        let text = formatter.string(from: Calendar.current.date(byAdding: .day, value: offset, to: .now) ?? .now)
        return text.prefix(1).uppercased() + text.dropFirst()
    }

    /// CO26: the last waist large, its change since the first in words, the curve, the history
    /// newest first with each day's fields, and the footer.
    func testMeasuresWaistChangeAndHistory() {
        let app = open("Mensurations", row: "today.measures", fixture: "measures")
        XCTAssertEqual(element(app, "chip.body").label, "Tour de taille")
        XCTAssertTrue(app.staticTexts["84,5"].exists, "the last waist, large")
        XCTAssertEqual(
            element(app, "measures-change").label, "1,6\u{202F}cm de moins depuis le \(frenchDayMonth(-31))")
        XCTAssertTrue(element(app, "measures-curve").exists, "the waist's curve")
        XCTAssertEqual(element(app, "measure-0").label, "\(longDay(-3)), taille 84,5\u{202F}cm")
        let oldest = element(app, "measure-4")
        XCTAssertTrue(app.swipeUpUntil(oldest))
        XCTAssertEqual(
            oldest.label, "\(longDay(-31)), taille 86,1\u{202F}cm · cou 38,0\u{202F}cm · hanches 98,0\u{202F}cm")
        XCTAssertTrue(app.staticTexts["Cou et hanches servent à l’outil Masse grasse."].exists)
    }

    /// CO27: typed through the keypad, the optional fields left empty; ✓ only within the bounds,
    /// and the measure reads back on top of the history.
    func testMeasuresSheetThroughKeypad() {
        let app = open("Mensurations", row: "today.measures", fixture: "measures")
        element(app, "measures-add").tap()
        XCTAssertTrue(app.sheetTitle("Mensurations").waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts["Taille au nombril pour la formule homme, au plus fin pour la formule femme."].exists)
        XCTAssertTrue(element(app, "measures-neck").exists && element(app, "measures-hip").exists)
        let save = element(app, "measures-save")
        XCTAssertFalse(save.isEnabled, "✓ is grey while empty")
        let waist = element(app, "measures-waist")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keypad is open")
        waist.typeText("39,9")
        XCTAssertFalse(save.isEnabled, "under the bound is refused")
        for _ in 0..<4 { waist.typeText(XCUIKeyboardKey.delete.rawValue) }
        waist.typeText("84,1")
        XCTAssertTrue(save.isEnabled, "84,1 turns ✓ on")
        save.tap()
        XCTAssertTrue(element(app, "measure-0").comesToRead("Aujourd’hui, taille 84,1\u{202F}cm"), "read back")
        XCTAssertTrue(app.staticTexts["84,1"].exists, "the last waist is today's")
    }

    /// CO28, D1 option A: two meters against the tools' figures, the calories named as the day's
    /// expenditure, the protein's range on a pill, then the days before and the footer.
    func testIntakeMetersAndWords() {
        let app = open("Apports", row: "today.intake", fixture: "intake")
        XCTAssertEqual(element(app, "chip.intake").label, "Aujourd’hui")
        let kcal = element(app, "intake-kcal")
        XCTAssertTrue(kcal.label.hasPrefix("Calories, 1\u{202F}850, sur "), kcal.label)
        XCTAssertTrue(kcal.label.contains("ta dépense du jour d’après l’outil Dépense énergétique"), kcal.label)
        XCTAssertFalse(kcal.label.contains("cible"), "no target is suggested")
        let protein = element(app, "intake-protein")
        XCTAssertTrue(protein.label.hasPrefix("Protéines, 128, sur "), protein.label)
        XCTAssertTrue(protein.label.contains("ta fourchette de "), protein.label)
        XCTAssertTrue(protein.label.contains("fourchette de l’outil Protéines"), protein.label)
        XCTAssertTrue(app.swipeUpUntil(app.staticTexts["Un total par jour, pas aliment par aliment."]))
    }

    /// CO29: without the profile's formula, birth year or height, no calorie figure, and the line
    /// says the profile is needed.
    func testIntakeWithoutProfileSaysSo() {
        let app = open("Apports", row: "today.intake", fixture: "bodyUsual")
        let kcal = element(app, "intake-kcal")
        XCTAssertTrue(kcal.waitForExistence(timeout: 5))
        XCTAssertEqual(
            kcal.label,
            "Calories, 1\u{202F}850, Ce repère demande ton profil\u{202F}: formule, année de naissance et taille, à remplir sur le web pour l’instant.",
            "no figure to compare to, and the profile is named")
    }

    /// CO30: the sheet opens on the day's total, and ✓ writes both values as the day's total.
    func testIntakeSheetDayTotal() {
        let app = open("Apports", row: "today.intake", fixture: "intake")
        element(app, "intake-add").tap()
        XCTAssertTrue(app.sheetTitle("Apports").waitForExistence(timeout: 5))
        let kcal = element(app, "intake-kcal-field")
        let protein = element(app, "intake-protein-field")
        XCTAssertEqual(kcal.value as? String, "1850", "the day's calories")
        XCTAssertEqual(protein.value as? String, "128", "the day's protein")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keypad is open")
        // At the end of the right-aligned text, so the deletes take the whole value.
        kcal.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        for _ in 0..<4 { kcal.typeText(XCUIKeyboardKey.delete.rawValue) }
        kcal.typeText("2000")
        protein.coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
        for _ in 0..<3 { protein.typeText(XCUIKeyboardKey.delete.rawValue) }
        protein.typeText("140")
        element(app, "intake-save").tap()
        XCTAssertTrue(app.navigationBars["Apports"].waitForExistence(timeout: 5))
        let meter = element(app, "intake-kcal")
        let wait = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "label BEGINSWITH %@", "Calories, 2\u{202F}000, sur "), object: meter)
        XCTAssertEqual(XCTWaiter().wait(for: [wait], timeout: 3), .completed, meter.label)
        XCTAssertTrue(element(app, "intake-protein").label.hasPrefix("Protéines, 140, sur "))
        app.navigationBars["Apports"].buttons.firstMatch.tap()
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.intake")))
        XCTAssertEqual(
            element(app, "today.intake").label, "Apports, 2\u{202F}000\u{202F}kcal · 140\u{202F}g de protéines",
            "one day, one total")
    }

    /// CO31: a tap ticks today's box and writes the log; a second unticks it; Corps reads it back.
    func testSupplementTickWritesLog() {
        let app = open("Compléments", row: "today.supplements", fixture: "supplements")
        let creatine = element(app, "supplement-0")
        XCTAssertEqual(creatine.label, "Créatine, pris · depuis 9 jours")
        let vitamin = element(app, "supplement-1")
        XCTAssertEqual(vitamin.label, "Vitamine D, pas encore pris")
        XCTAssertTrue(app.staticTexts["Belay note ce que tu prends, sans conseil de dose."].exists)
        vitamin.tap()
        XCTAssertTrue(vitamin.comesToRead("Vitamine D, pris"), "ticked")
        XCTAssertTrue(vitamin.isSelected)
        app.navigationBars["Compléments"].buttons.firstMatch.tap()
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.supplements")))
        XCTAssertEqual(element(app, "today.supplements").label, "Compléments, 2 sur 2", "the log is written")
        element(app, "today.supplements").tap()
        XCTAssertTrue(app.navigationBars["Compléments"].waitForExistence(timeout: 5))
        element(app, "supplement-1").tap()
        XCTAssertTrue(element(app, "supplement-1").comesToRead("Vitamine D, pas encore pris"), "unticked")
        app.navigationBars["Compléments"].buttons.firstMatch.tap()
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.supplements")))
        XCTAssertEqual(element(app, "today.supplements").label, "Compléments, 1 sur 2", "written not taken")
    }

    /// R4: an empty list says it is set on the web for now.
    func testEmptySupplementsSaysWeb() {
        let app = open("Compléments", row: "today.supplements", fixture: "bodyEarly")
        XCTAssertTrue(app.staticTexts["Pas encore de complément"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Ta liste se règle sur le web pour l’instant."].exists)
    }

    /// CO11, CO33: Corps's rows and Accueil's open the native screens.
    func testRowsFromCorpsAndAccueil() {
        for tab in ["Corps", "Accueil"] {
            let app = open("Mensurations", row: "today.measures", fixture: "measures", tab: tab)
            XCTAssertTrue(element(app, "measures-change").waitForExistence(timeout: 5), "\(tab): Mensurations is native")
            app.navigationBars["Mensurations"].buttons.firstMatch.tap()
            XCTAssertTrue(app.swipeUpUntil(element(app, "today.intake")))
            element(app, "today.intake").tap()
            XCTAssertTrue(element(app, "intake-kcal").waitForExistence(timeout: 5), "\(tab): Apports is native")
            app.navigationBars["Apports"].buttons.firstMatch.tap()
            XCTAssertTrue(app.swipeUpUntil(element(app, "today.supplements")))
            element(app, "today.supplements").tap()
            XCTAssertTrue(element(app, "supplement-0").waitForExistence(timeout: 5), "\(tab): Compléments is native")
        }
    }

    /// CO38 at AX3: every figure, row and box of the three screens can be reached, whole, and
    /// the sheets keep their field above the keypad.
    func testAx3Entries() {
        let screens: [(title: String, row: String, ids: [String], add: String?, field: String?)] = [
            ("Mensurations", "today.measures", ["measures-change", "measure-0", "measure-4"], "measures-add", "measures-waist"),
            ("Apports", "today.intake", ["intake-kcal", "intake-protein"], "intake-add", "intake-kcal-field"),
            ("Compléments", "today.supplements", ["supplement-0", "supplement-1"], nil, nil),
        ]
        for screen in screens {
            let fixture = screen.title == "Compléments" ? "supplements" : screen.title == "Apports" ? "intake" : "measures"
            let app = open(screen.title, row: screen.row, fixture: fixture, largestText: true)
            let window = app.windows.firstMatch.frame
            for id in screen.ids {
                let item = element(app, id)
                XCTAssertTrue(app.swipeUpUntil(item, swipes: 14), "\(id) can be reached")
                XCTAssertLessThanOrEqual(item.frame.maxX, window.maxX + 1, "\(id) is whole")
                XCTAssertGreaterThanOrEqual(item.frame.height, 44, "\(id) is a full target")
            }
            if let add = screen.add, let field = screen.field {
                element(app, add).tap()
                let keyboard = app.keyboards.firstMatch
                XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
                XCTAssertLessThanOrEqual(
                    element(app, field).frame.maxY, keyboard.frame.minY, "\(field) stays above the keypad")
            }
        }
    }

    /// CO36: each screen opens on its large title and shows no compact title once scrolled.
    func testNoCompactTitle() {
        for (title, row, fixture) in [
            ("Mensurations", "today.measures", "measures"), ("Apports", "today.intake", "intake"),
            ("Compléments", "today.supplements", "supplements"),
        ] {
            let app = open(title, row: row, fixture: fixture, largestText: true)
            let large = app.largeTitleHeight(title)
            XCTAssertGreaterThan(large, 30, "\(title) opens large")
            app.swipeUp()
            app.swipeUp()
            // A short list does not scroll and keeps its large title; a compact one would be smaller.
            let compact = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == %@", title))
                .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 && $0.frame.height < large - 5 }
            XCTAssertFalse(compact, "\(title): no compact title once scrolled")
        }
    }
}
