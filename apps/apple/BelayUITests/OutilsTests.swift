import XCTest

/// Outils and its Force tools on the fixture: `toolsEmpty` holds nothing the tools could open on,
/// `tools` a profile, a week of weigh-ins and a waist. The Force tools open empty on both; their
/// figures are the shared rules' on the inputs typed here.
@MainActor
final class OutilsTests: XCTestCase {
    /// Launches on `fixture`, with `arguments` added (a device preference), and opens Outils.
    private func outils(
        _ fixture: String = "tools", largestText: Bool = false, arguments: [String] = []
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture] + arguments
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launchFixture()
        let tab = app.tabBars.firstMatch.buttons["Outils"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        XCTAssertTrue(app.navigationBars["Outils"].waitForExistence(timeout: 5), "Outils is native")
        return app
    }

    /// Opens the tool `id`, and waits for its header.
    private func open(_ app: XCUIApplication, _ id: String) {
        let row = element(app, "tool-row-\(id)")
        XCTAssertTrue(app.swipeUpUntil(row), "the row \(id) is reached")
        row.tap()
        XCTAssertTrue(element(app, "tool-header").waitForExistence(timeout: 5), "the tool's page opens")
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// Types `digits` on the decimal keypad into the field `id`, one key at a time.
    private func type(_ app: XCUIApplication, _ digits: String, into id: String) {
        let field = element(app, id)
        XCTAssertTrue(app.swipeUpUntil(field), "\(id) is reached")
        field.tap()
        for key in digits { tapKey(app, String(key)) }
    }

    private func tapKey(_ app: XCUIApplication, _ key: String) {
        let button = app.keys[key]
        XCTAssertTrue(button.waitForExistence(timeout: 3), "the keypad shows « \(key) »")
        button.tap()
    }

    /// Accueil, Réglages, the weight unit set to `word` (« kilos » or « livres »), then Outils again
    /// on the page it was showing.
    private func switchUnit(_ app: XCUIApplication, to word: String) {
        app.putKeypadAway()
        app.tab("Accueil")
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Accueil leads to Réglages")
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
        let row = element(app, "reglages-weight-unit")
        XCTAssertTrue(app.swipeUpUntil(row), "the unit row is reached")
        let bar = app.tabBars.firstMatch
        for _ in 0..<3 where bar.exists && row.frame.maxY > bar.frame.minY - 8 {
            app.swipeUp(velocity: .slow)
        }
        // Right after a push the list can still move under the first tap: tapped again until chosen.
        let choice = row.segmentedControls.firstMatch.buttons[word]
        for _ in 0..<3 where !choice.isSelected {
            choice.tap()
            _ = choice.waitFor(NSPredicate(format: "isSelected == true"), timeout: 2)
        }
        XCTAssertTrue(choice.isSelected, "\(word) chosen")
        app.navigationBars.buttons.firstMatch.tap()
        app.tab("Outils")
        XCTAssertTrue(element(app, "tool-header").waitForExistence(timeout: 5), "the tool is still open")
    }

    /// A9: Force, Énergie and Corps, in this order, each tool a 56 pt row with its name and hint.
    func testThreeGroupsInOrder() {
        let app = outils()
        let headers = ["Force", "Énergie", "Corps"].map { app.staticTexts[$0].firstMatch }
        XCTAssertTrue(headers.allSatisfy(\.exists), "the three groups show")
        XCTAssertLessThan(headers[0].frame.minY, headers[1].frame.minY)
        XCTAssertLessThan(headers[1].frame.minY, headers[2].frame.minY)
        let order = ["one-rep-max", "plates", "warmup", "energy", "protein", "projection"]
        let rows = order.map { element(app, "tool-row-\($0)") }
        XCTAssertTrue(rows.allSatisfy(\.exists), "every tool of Force and Énergie has its row")
        for (above, below) in zip(rows, rows.dropFirst()) {
            XCTAssertLessThan(above.frame.minY, below.frame.minY, "\(above.label) comes before \(below.label)")
        }
        XCTAssertGreaterThanOrEqual(rows[0].frame.height, 56, "a tool row is 56 pt")
        XCTAssertTrue(rows[0].label.contains("Ton max à partir d’une série"), "the row reads its hint: \(rows[0].label)")
        XCTAssertLessThanOrEqual(headers[0].frame.maxY, rows[0].frame.minY, "Force heads its rows")
        XCTAssertLessThanOrEqual(rows[2].frame.maxY, headers[1].frame.minY, "Énergie follows Force's last row")
    }

    /// A9: the last footer says nothing leaves the phone.
    func testFooterSaysNothingSent() {
        let app = outils()
        let footer = app.staticTexts["Tout est calculé sur ton appareil. Rien n’est envoyé."]
        XCTAssertTrue(app.swipeUpUntil(footer), "the footer is reached")
        XCTAssertGreaterThanOrEqual(footer.frame.minY, element(app, "tool-row-body-fat").frame.maxY, "under the last row")
    }

    /// A10: a row pushes its tool, and the edge swipe brings Outils back.
    func testRowPushesToolAndEdgeSwipeReturns() {
        let app = outils()
        open(app, "one-rep-max")
        XCTAssertEqual(element(app, "tool-header").label, "1RM estimé")
        XCTAssertTrue(app.staticTexts["Ton max à partir d’une série menée près de l’échec."].exists, "the web's lead")
        let result = element(app, "tool-result")
        let load = element(app, "tool-field-load")
        XCTAssertLessThan(result.frame.minY, load.frame.minY, "the result comes before the fields")
        let start = app.coordinate(withNormalizedOffset: CGVector(dx: 0.01, dy: 0.5))
        start.press(forDuration: 0.05, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)))
        XCTAssertTrue(element(app, "tool-row-one-rep-max").waitFor(NSPredicate(format: "isHittable == true")), "Outils is back")
    }

    /// A11: with nothing typed, a dash where the figure goes and what is missing, in words.
    func testEmptySaysWhatIsMissing() {
        let app = outils("toolsEmpty")
        open(app, "one-rep-max")
        XCTAssertTrue(app.staticTexts["Il manque la charge."].exists)
        XCTAssertFalse(element(app, "tool-figure-epley").exists, "no figure, a dash in its place")
        app.navigationBars.buttons.firstMatch.tap()
        open(app, "plates")
        XCTAssertTrue(app.staticTexts["Il manque la charge visée."].exists)
        app.navigationBars.buttons.firstMatch.tap()
        open(app, "warmup")
        XCTAssertTrue(app.staticTexts["Il manque la charge de travail."].exists)
    }

    /// A11: the figure moves above the keypad at each key.
    func testFigureMovesWhileTyping() {
        let app = outils("toolsEmpty")
        open(app, "one-rep-max")
        type(app, "8", into: "tool-field-load")
        let epley = element(app, "tool-figure-epley")
        XCTAssertTrue(epley.waitFor(NSPredicate(format: "label CONTAINS '9,5'"), timeout: 6), "8 kg × 5: \(epley.label)")
        tapKey(app, "0")
        XCTAssertTrue(epley.waitFor(NSPredicate(format: "label CONTAINS '93,5'"), timeout: 6), "80 kg × 5: \(epley.label)")
        XCTAssertTrue(app.keys["0"].exists, "the keypad is still up")
        XCTAssertTrue(epley.isHittable, "the figure stays above the keypad")
    }

    /// A12, A13: 80 kg × 6 gives Epley 96 kg and Brzycki 93 kg, the reps on − and +.
    func testOneRepMaxDemo() {
        let app = outils()
        open(app, "one-rep-max")
        type(app, "80", into: "tool-field-load")
        let more = app.buttons["Ajouter une répétition"]
        XCTAssertTrue(more.exists, "+ says what it adds")
        XCTAssertGreaterThanOrEqual(more.frame.height, 44, "a 44 pt target at least")
        more.tap()
        XCTAssertTrue(element(app, "tool-reps").label.contains("6"), "6 reps: \(element(app, "tool-reps").label)")
        XCTAssertEqual(element(app, "tool-figure-epley").label, "Epley, 96 kilos")
        XCTAssertEqual(element(app, "tool-figure-brzycki").label, "Brzycki, 93 kilos")
    }

    /// A13: Réglages' « Epley seule » leaves Brzycki out.
    func testEpleyOnlyHidesBrzycki() {
        let app = outils(arguments: ["-belay.oneRepMaxBrzycki", "hidden"])
        open(app, "one-rep-max")
        type(app, "80", into: "tool-field-load")
        XCTAssertTrue(element(app, "tool-figure-epley").waitForExistence(timeout: 3))
        XCTAssertFalse(element(app, "tool-figure-brzycki").exists, "Brzycki is hidden")
    }

    /// A13: past ten reps the web's line says the estimate is less reliable; at one, the load is the max.
    func testPastReliableRepsReadsTheRule() {
        let app = outils()
        open(app, "one-rep-max")
        type(app, "80", into: "tool-field-load")
        let line = app.staticTexts["Au-delà de 10 répétitions, l’estimation est moins fiable."]
        let more = app.buttons["Ajouter une répétition"]
        for _ in 0..<5 { more.tap() }
        XCTAssertFalse(line.exists, "10 reps are still reliable")
        more.tap()
        XCTAssertTrue(line.waitForExistence(timeout: 3), "11 reps say so")
        let fewer = app.buttons["Retirer une répétition"]
        for _ in 0..<10 { fewer.tap() }
        XCTAssertTrue(app.staticTexts["Avec 1 répétition, ton 1RM est la charge soulevée."].exists)
        XCTAssertFalse(fewer.isEnabled, "no fewer than one rep")
    }

    /// A14: the plates per side heaviest first, the bar named; an unreachable load gives the
    /// nearest on either side.
    func testPlatesPerSideAndNearest() {
        let app = outils()
        open(app, "plates")
        type(app, "95", into: "tool-field-target")
        XCTAssertTrue(app.staticTexts["20 + 10 + 5 + 2,5\u{202F}kg par côté"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Barre de 20\u{202F}kg"].exists)
        element(app, "tool-field-target").typeText(XCUIKeyboardKey.delete.rawValue)
        tapKey(app, "6")
        XCTAssertTrue(app.staticTexts["96\u{202F}kg n’est pas faisable avec ton matériel."].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Juste en dessous · 95\u{202F}kg"].exists)
        XCTAssertTrue(app.staticTexts["Juste au-dessus · 100\u{202F}kg"].exists)
        XCTAssertTrue(element(app, "tool-equipment").label.contains("Salle"), "Mon matériel says Salle")
    }

    /// A15: Mon matériel's presets change what Disques loads, and « Modifier ce matériel » copies
    /// the preset into Sur mesure, whose plates a tap takes out.
    func testEquipmentPresetsAndEdit() {
        let app = outils()
        open(app, "plates")
        type(app, "96", into: "tool-field-target")
        XCTAssertTrue(text(app, containing: "n’est pas faisable").waitForExistence(timeout: 3), "Salle cannot load 96")
        let equipment = element(app, "tool-equipment")
        XCTAssertTrue(app.swipeUpUntil(equipment))
        equipment.tap()
        let presets = app.segmentedControls["equipment-preset"]
        XCTAssertTrue(presets.waitForExistence(timeout: 5), "Mon matériel opens")
        XCTAssertTrue(presets.buttons["Salle"].isSelected, "Salle is the default")
        presets.buttons["Compétition"].tap()
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(
            app.staticTexts["25 + 10 + 2,5 + 0,5\u{202F}kg par côté"].waitForExistence(timeout: 3), "Compétition loads 96")
        // The page puts the keypad away before it pushes Mon matériel, and nothing brings it back.
        XCTAssertFalse(app.keyboards.firstMatch.exists, "the keypad stays away on return")
        XCTAssertTrue(app.swipeUpUntil(equipment), "Mon matériel's row is reached again")
        XCTAssertTrue(equipment.label.contains("Compétition"))
        equipment.tap()
        let edit = app.buttons["Modifier ce matériel"]
        XCTAssertTrue(app.swipeUpUntil(edit))
        edit.tap()
        XCTAssertTrue(presets.buttons["Sur mesure"].isSelected, "the copy is Sur mesure")
        let half = element(app, "plate-0.5")
        XCTAssertTrue(app.swipeUpUntil(half))
        XCTAssertTrue(half.isSelected, "the copy holds Compétition's plates")
        XCTAssertGreaterThanOrEqual(half.frame.height, 44, "a plate is a 44 pt chip")
        half.tap()
        XCTAssertFalse(half.isSelected, "a tap takes the plate out")
        app.navigationBars.buttons.firstMatch.tap()
        // 38 kg a side without the 0,5: Sur mesure still has 2 and 1 kg, so 96 loads otherwise.
        let loaded = text(app, containing: "par côté")
        XCTAssertTrue(loaded.waitForExistence(timeout: 3), "Sur mesure loads 96")
        XCTAssertFalse(loaded.label.contains("0,5"), "no 0,5 kg plate now: \(loaded.label)")
        XCTAssertTrue(equipment.label.contains("Sur mesure"), equipment.label)
    }

    /// Mon matériel's kilo chips say the unit as a word; in pounds, the chips only show what
    /// Belay loads, so none is a button.
    func testEquipmentChipsSpeakTheUnitAndPoundChipsAreNotButtons() {
        let app = outils()
        open(app, "plates")
        let equipment = element(app, "tool-equipment")
        XCTAssertTrue(app.swipeUpUntil(equipment))
        equipment.tap()
        let bar = element(app, "bar-20.0")
        XCTAssertTrue(bar.waitForExistence(timeout: 5), "Mon matériel opens")
        XCTAssertEqual(bar.label, "20 kilos")
        let plate = element(app, "plate-2.5")
        XCTAssertTrue(app.swipeUpUntil(plate))
        XCTAssertEqual(plate.label, "2,5 kilos")
        app.terminate()

        let pounds = outils(arguments: ["-belay.weightUnit", "lb"])
        open(pounds, "plates")
        let poundEquipment = element(pounds, "tool-equipment")
        XCTAssertTrue(pounds.swipeUpUntil(poundEquipment))
        poundEquipment.tap()
        let poundBar = element(pounds, "bar-lb-45.0")
        XCTAssertTrue(poundBar.waitForExistence(timeout: 5), "Mon matériel opens in pounds")
        XCTAssertEqual(poundBar.label, "45 livres")
        XCTAssertFalse(pounds.buttons["bar-lb-45.0"].exists, "a pound chip is not a button")
    }

    /// A16: each warm-up set as « 50\u{202F}kg × 5 » with its plates per side, the count on − and +.
    func testWarmupSetsListed() {
        let app = outils()
        open(app, "warmup")
        type(app, "100", into: "tool-field-work")
        let first = element(app, "warmup-set-0")
        XCTAssertTrue(first.waitForExistence(timeout: 3))
        XCTAssertEqual(first.label, "50 kilos × 5, 10 + 5 par côté")
        XCTAssertEqual(element(app, "warmup-set-1").label, "75 kilos × 3, 20 + 5 + 2,5 par côté")
        XCTAssertFalse(element(app, "warmup-set-2").exists, "100 kg calls for two sets")
        XCTAssertTrue(element(app, "tool-count").label.contains("2 séries"), element(app, "tool-count").label)
        let more = app.buttons["Ajouter une série"]
        XCTAssertTrue(app.swipeUpUntil(more))
        more.tap()
        XCTAssertEqual(element(app, "warmup-set-0").label, "40 kilos × 5, 10 par côté")
        XCTAssertTrue(element(app, "warmup-set-2").exists, "three sets once asked")
    }

    /// A24: « Comment c’est calculé » opens the tool's catalogue entry, word for word, with its chip.
    func testMethodTextIsCatalogue() {
        let app = outils()
        open(app, "one-rep-max")
        let method = element(app, "tool-method")
        XCTAssertTrue(app.swipeUpUntil(method))
        method.tap()
        let brief = element(app, "science-brief")
        XCTAssertTrue(brief.waitForExistence(timeout: 5))
        XCTAssertEqual(
            brief.label,
            "Plus tu enchaînes de répétitions avec une charge, plus ton maximum est élevé. Deux formules connues, "
                + "Epley et Brzycki, traduisent ça en un chiffre. Belay affiche les deux côte à côte pour que tu voies l'écart.")
        XCTAssertEqual(element(app, "science-label").label, "Source scientifique")
        app.navigationBars.buttons.firstMatch.tap()
        // Typing, then the method: it still opens, and the keypad does not come back on return.
        type(app, "80", into: "tool-field-load")
        XCTAssertTrue(app.swipeUpUntil(method))
        method.tap()
        XCTAssertTrue(element(app, "science-brief").waitForExistence(timeout: 5), "the method opens while typing")
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(element(app, "tool-header").waitForExistence(timeout: 5))
        XCTAssertFalse(app.keyboards.firstMatch.waitForExistence(timeout: 1), "the keypad stays away on return")
        app.navigationBars.buttons.firstMatch.tap()
        open(app, "warmup")
        XCTAssertTrue(app.swipeUpUntil(method))
        method.tap()
        XCTAssertTrue(element(app, "science-label").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "science-label").label, "Heuristique Belay")
    }

    /// A48: the tool opens on its header in the page; once scrolled, no title stands in the bar and
    /// the back button stays.
    func testToolOpensOnHeaderNoCompactTitle() {
        let app = outils()
        open(app, "warmup")
        let header = element(app, "tool-header")
        XCTAssertTrue(header.isHittable, "the header shows in the page")
        XCTAssertGreaterThan(header.frame.minY, app.navigationBars.firstMatch.frame.minY, "under the bar's buttons")
        app.swipeUp()
        let inBar = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == 'Montée en charge'"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(inBar, "no compact title once scrolled")
        XCTAssertTrue(app.navigationBars.buttons.firstMatch.isHittable, "the back button stays")
    }

    /// A49: at AX3 the figure stays on one line.
    func testFigureOneLineAtAX3() {
        let app = outils(largestText: true)
        open(app, "one-rep-max")
        type(app, "80", into: "tool-field-load")
        let epley = element(app, "tool-figure-epley")
        XCTAssertTrue(epley.waitForExistence(timeout: 3))
        XCTAssertGreaterThan(epley.frame.width, epley.frame.height, "the name over one line of figure: \(epley.frame)")
        app.navigationBars.buttons.firstMatch.tap()
        open(app, "plates")
        type(app, "95", into: "tool-field-target")
        let plates = app.staticTexts["20 + 10 + 5 + 2,5\u{202F}kg par côté"]
        XCTAssertTrue(plates.waitForExistence(timeout: 3))
        XCTAssertGreaterThan(plates.frame.width, plates.frame.height, "the plates on one line: \(plates.frame)")
    }

    /// A50: each control says its action, and each row reads as one element.
    func testLabelsSayAction() {
        let app = outils()
        let row = element(app, "tool-row-plates")
        XCTAssertEqual(row.label, "Disques, Quoi charger sur la barre")
        open(app, "warmup")
        type(app, "100", into: "tool-field-work")
        XCTAssertTrue(app.buttons["Retirer une série"].exists)
        XCTAssertTrue(app.buttons["Ajouter une série"].exists)
        XCTAssertEqual(element(app, "tool-field-work").label, "Charge de travail, kilos")
        let method = element(app, "tool-method")
        XCTAssertTrue(app.swipeUpUntil(method))
        XCTAssertEqual(method.label, "Comment c’est calculé")
    }

    /// A15: « Autre » follows the standard bars; in Sur mesure it takes the bar's weight on − and +.
    func testEquipmentOtherBar() {
        let app = outils()
        open(app, "plates")
        let equipment = element(app, "tool-equipment")
        XCTAssertTrue(app.swipeUpUntil(equipment))
        equipment.tap()
        let other = element(app, "bar-other")
        XCTAssertTrue(other.waitForExistence(timeout: 5), "the bar offers « Autre »")
        XCTAssertEqual(other.label, "Autre")
        XCTAssertEqual(element(app, "plate-25.0").label, "25 kilos", "a bare 25 still says its unit as a word")
        let edit = app.buttons["Modifier ce matériel"]
        XCTAssertTrue(app.swipeUpUntil(edit))
        edit.tap()
        other.tap()
        let weight = element(app, "bar-weight")
        XCTAssertTrue(weight.waitForExistence(timeout: 3), "« Autre » asks the bar's weight")
        app.buttons["bar-weight-plus"].tap()
        XCTAssertTrue(weight.label.contains("20,5"), weight.label)
        XCTAssertTrue(other.isSelected, "« Autre » is the bar chosen")
    }

    /// A16: the count says it follows the load; the working sets read « à toi ».
    func testWarmupCountSaysItFollows() {
        let app = outils()
        open(app, "warmup")
        type(app, "100", into: "tool-field-work")
        let count = element(app, "tool-count")
        XCTAssertTrue(count.waitForExistence(timeout: 3))
        XCTAssertTrue(count.label.contains("suit la charge tant que tu n’y touches pas"), count.label)
        XCTAssertEqual(element(app, "warmup-work").label, "100 kilos, séries de travail, à toi")
    }

    /// In pounds, 176 lb × 6 gives the web's Epley 211 lb and Brzycki 204 lb, said in words.
    func testOneRepMaxInPoundsMatchesWeb() {
        let app = outils(arguments: ["-belay.weightUnit", "lb"])
        open(app, "one-rep-max")
        type(app, "176", into: "tool-field-load")
        app.buttons["Ajouter une répétition"].tap()
        let epley = element(app, "tool-figure-epley")
        XCTAssertTrue(epley.waitFor(NSPredicate(format: "label == 'Epley, 211 livres'"), timeout: 3), epley.label)
        XCTAssertEqual(element(app, "tool-figure-brzycki").label, "Brzycki, 204 livres")
    }

    /// A load shown in pounds and typed again as shown keeps its kilos: 80 kg reads 175 lb, and
    /// back in kilos it is 80 again, not the 79,38 that 175 lb converts to. 80 kg × 5 is Epley
    /// 93,5 kg, or 206 lb.
    func testLoadLeftAsShownKeepsItsKilos() {
        let app = outils()
        open(app, "one-rep-max")
        type(app, "80", into: "tool-field-load")
        let field = element(app, "tool-field-load")
        XCTAssertTrue(element(app, "tool-figure-epley").waitFor(NSPredicate(format: "label == 'Epley, 93,5 kilos'"), timeout: 3))
        switchUnit(app, to: "livres")
        XCTAssertEqual(field.value as? String, "175", "80 kg reads on the web's 5 lb step")
        XCTAssertEqual(element(app, "tool-figure-epley").label, "Epley, 206 livres")
        field.tapAtEnd()
        XCTAssertTrue(app.keys["5"].waitForExistence(timeout: 3), "the keypad is up")
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 3))
        for key in "175" { tapKey(app, String(key)) }
        switchUnit(app, to: "kilos")
        XCTAssertEqual(field.value as? String, "80", "the kilos typed first are kept")
        XCTAssertEqual(element(app, "tool-figure-epley").label, "Epley, 93,5 kilos")
    }

    /// Past the bounds once converted, the line gives them in pounds, as the field rounds them.
    func testLoadOutsideBoundsSaysPounds() {
        let app = outils("toolsEmpty", arguments: ["-belay.weightUnit", "lb"])
        open(app, "one-rep-max")
        type(app, "1103", into: "tool-field-load")
        let line = text(app, containing: "Une charge va de")
        XCTAssertTrue(line.waitForExistence(timeout: 3), "1 103 lb is past 500 kg")
        XCTAssertTrue(line.label.hasPrefix("Une charge va de 5 à 1"), line.label)
        XCTAssertTrue(line.label.hasSuffix("100\u{202F}lb."), line.label)
        XCTAssertFalse(element(app, "tool-figure-epley").exists, "no figure for it")
    }

    /// In pounds, 225 lb warms up on the 45 lb bar and the pound plates, two sets as 102 kg calls for.
    func testWarmupInPounds() {
        let app = outils(arguments: ["-belay.weightUnit", "lb"])
        open(app, "warmup")
        type(app, "225", into: "tool-field-work")
        let first = element(app, "warmup-set-0")
        XCTAssertTrue(first.waitForExistence(timeout: 3))
        XCTAssertEqual(first.label, "110 livres × 5, 25 + 5 + 2,5 par côté")
        XCTAssertEqual(element(app, "warmup-set-1").label, "170 livres × 3, 35 + 25 + 2,5 par côté")
        XCTAssertFalse(element(app, "warmup-set-2").exists, "two sets")
        XCTAssertEqual(element(app, "warmup-work").label, "225 livres, séries de travail, à toi")
        XCTAssertTrue(app.swipeUpUntil(text(app, containing: "«\u{202F}Standard (lb)\u{202F}»")), "the note names the pound set")
    }

    /// In pounds, Disques loads the 45 lb bar with pound plates, whatever Mon matériel holds, and says so.
    func testPlatesOnThePoundBar() {
        let app = outils(arguments: ["-belay.weightUnit", "lb"])
        open(app, "plates")
        type(app, "225", into: "tool-field-target")
        XCTAssertTrue(app.staticTexts["45 + 45\u{202F}lb par côté"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.staticTexts["Barre de 45\u{202F}lb"].exists)
        let equipment = element(app, "tool-equipment")
        XCTAssertTrue(app.swipeUpUntil(equipment))
        XCTAssertTrue(equipment.label.contains("Standard (lb)"), equipment.label)
        let note = app.staticTexts["En livres, Belay prend la barre de 45\u{202F}lb et les disques standard."]
        XCTAssertTrue(app.swipeUpUntil(note), "the web's note")
    }

    /// A custom set with every plate taken out says it has none, not the load bounds.
    func testCustomSetWithNoPlatesSaysSo() {
        let app = outils()
        open(app, "plates")
        type(app, "96", into: "tool-field-target")
        let equipment = element(app, "tool-equipment")
        XCTAssertTrue(app.swipeUpUntil(equipment))
        equipment.tap()
        let edit = app.buttons["Modifier ce matériel"]
        XCTAssertTrue(app.swipeUpUntil(edit))
        edit.tap()
        for plate in ["20.0", "10.0", "5.0", "2.5"] {
            let chip = element(app, "plate-\(plate)")
            XCTAssertTrue(app.swipeUpUntil(chip))
            if chip.isSelected { chip.tap() }
            XCTAssertFalse(chip.isSelected, "\(plate) taken out")
        }
        app.navigationBars.buttons.firstMatch.tap()
        let line = text(app, containing: "aucun disque")
        XCTAssertTrue(line.waitForExistence(timeout: 3), "the tool says there are no plates")
        XCTAssertFalse(text(app, containing: "Une charge va de").exists, "not the load bounds")
        XCTAssertFalse(text(app, containing: "n’est pas faisable").exists, "nor an unreachable load")
    }

    /// The load field says its unit as a word, so VoiceOver never reads a bare figure.
    func testLoadFieldSaysItsUnit() {
        let app = outils()
        open(app, "one-rep-max")
        let field = element(app, "tool-field-load")
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        XCTAssertTrue(field.label.contains("kilos"), field.label)
        switchUnit(app, to: "livres")
        XCTAssertTrue(field.label.contains("livres"), field.label)
    }

    /// On the 2,5 kg step the warm-up's load reads on the web's 5 lb step: 80 kg shows 175 lb, not 176.
    func testWarmupLoadStepsAsTheWebInPounds() {
        let app = outils()
        open(app, "warmup")
        type(app, "80", into: "tool-field-work")
        switchUnit(app, to: "livres")
        XCTAssertEqual(element(app, "tool-field-work").value as? String, "175")
    }

    /// 1 101 lb is under 500 kg but past the 1 100 lb the field rounds the bounds to: refused.
    func testLoadPastPoundBoundRefused() {
        let app = outils("toolsEmpty", arguments: ["-belay.weightUnit", "lb"])
        open(app, "one-rep-max")
        type(app, "1101", into: "tool-field-load")
        XCTAssertTrue(text(app, containing: "Une charge va de").waitForExistence(timeout: 3), "1 101 lb is refused")
        XCTAssertFalse(element(app, "tool-figure-epley").exists, "no figure for it")
    }

    /// In pounds, Mon matériel shows the pound gym, read only: the 45 lb bar and the standard pound
    /// plates, said in pounds, with the web's note.
    func testEquipmentInPoundsShowsPoundSet() {
        let app = outils(arguments: ["-belay.weightUnit", "lb"])
        open(app, "plates")
        let equipment = element(app, "tool-equipment")
        XCTAssertTrue(app.swipeUpUntil(equipment))
        equipment.tap()
        let bar = element(app, "bar-lb-45.0")
        XCTAssertTrue(bar.waitForExistence(timeout: 5), "Mon matériel opens on the pound bar")
        XCTAssertEqual(bar.label, "45 livres")
        XCTAssertFalse(element(app, "bar-20.0").exists, "no kilo bar")
        XCTAssertFalse(app.segmentedControls["equipment-preset"].exists, "no preset to pick in pounds")
        for (plate, spoken) in [("45.0", "45"), ("35.0", "35"), ("25.0", "25"), ("10.0", "10"), ("5.0", "5"), ("2.5", "2,5")] {
            let chip = element(app, "plate-lb-\(plate)")
            XCTAssertTrue(app.swipeUpUntil(chip), "the \(plate) lb plate")
            XCTAssertEqual(chip.label, "\(spoken) livres")
            XCTAssertGreaterThanOrEqual(chip.frame.height, 44, "a plate is a 44 pt chip")
        }
        XCTAssertFalse(element(app, "plate-20.0").exists, "no kilo plate")
        let note = app.staticTexts["En livres, Belay prend la barre de 45\u{202F}lb et les disques standard."]
        XCTAssertTrue(app.swipeUpUntil(note), "the web's note")
        XCTAssertFalse(app.buttons["Modifier ce matériel"].exists, "the pound set reads only")
    }
}
