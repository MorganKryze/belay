import XCTest

/// Corps's home and the weigh-in sheet on the fixture's body modes, whose days follow the fixture
/// clock: `bodyUsual` holds five weeks of weigh-ins losing 0,1 kg a day, today's at 79,9 kg, a
/// waist three days ago, today's intake and one supplement of two ticked; `bodyOutOfRange` gains
/// slowly; `bodyEarly` holds three weigh-ins, none today; `bodyFirst` none; `healthCard` is an
/// empty store whose import card was never answered; `weighedFromHealth` has today's weigh-in
/// filled by the Health import.
@MainActor
final class CorpsTests: XCTestCase {
    /// Launches on `fixture` and opens the Corps tab.
    private func corps(
        _ fixture: String, largestText: Bool = false, now: String? = nil, english: Bool = false,
        health: String? = nil
    ) -> XCUIApplication {
        let app = XCUIApplication.fixture(fixture, largestText: largestText, now: now, english: english, health: health)
        let name = english ? "Body" : "Corps"
        let tab = app.tabBars.firstMatch.buttons[name]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        XCTAssertTrue(app.navigationBars[name].waitForExistence(timeout: 5), "Corps is native")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// The largest amount by which red rises above green and blue inside `frame`, in 0-255 steps:
    /// grey words read about 0, the Danger red well above 60.
    private func redness(_ app: XCUIApplication, in frame: CGRect) -> Int {
        let shot = app.screenshot().image
        guard let image = shot.cgImage, let crop = image.cropping(to: frame.applying(.init(scaleX: shot.scale, y: shot.scale)).integral)
        else {
            XCTFail("the sample falls off the screen")
            return 0
        }
        let width = crop.width, height = crop.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        pixels.withUnsafeMutableBytes { bytes in
            let context = CGContext(
                data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(crop, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        var most = 0
        for pixel in stride(from: 0, to: pixels.count, by: 4) {
            let red = Int(pixels[pixel]), green = Int(pixels[pixel + 1]), blue = Int(pixels[pixel + 2])
            most = max(most, red - max(green, blue))
        }
        return most
    }

    /// CO8: the average, last week's loss and the range in words, the span over the curve, the
    /// weeks' row and « Aujourd'hui ».
    func testUsualAverageWeekAndRange() {
        let app = corps("bodyUsual")
        let chip = element(app, "chip.body")
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        XCTAssertEqual(chip.label, "Moyenne 7 jours")
        XCTAssertTrue(app.staticTexts["80,2"].exists, "the 7-day average, large")
        let change = element(app, "trend-change")
        XCTAssertTrue(change.exists)
        XCTAssertTrue(change.label.hasPrefix("perte "), "a loss reads « perte »: \(change.label)")
        XCTAssertTrue(change.label.hasSuffix("\u{202F}%/sem la semaine dernière"), "per week, last week: \(change.label)")
        XCTAssertEqual(element(app, "trend-range").label, "dans ta fourchette", "the range on a pill, in words")
        let span = app.segmentedControls["trend-span"]
        XCTAssertTrue(span.exists, "S, M, A over the curve")
        XCTAssertEqual(span.buttons.count, 3)
        XCTAssertTrue(span.buttons.element(boundBy: 1).isSelected, "Corps opens on M")
        XCTAssertTrue(element(app, "trend-chart").label.contains("Moyenne"), "the chart says its average")
        XCTAssertTrue(element(app, "corps-weeks").exists, "the row Tes semaines")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")), "« Aujourd'hui » follows")
        span.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(span.buttons.element(boundBy: 0).isSelected, "S chosen")
    }

    /// R9: out of range is said in grey words, never in red; a gain reads « prise ».
    func testOutOfRangeIsGreyWords() {
        let app = corps("bodyOutOfRange")
        let range = element(app, "trend-range")
        XCTAssertTrue(range.waitForExistence(timeout: 5))
        XCTAssertEqual(range.label, "hors de ta fourchette, 0,5 à 1\u{202F}%")
        XCTAssertTrue(element(app, "trend-change").label.hasPrefix("prise "), "a gain reads « prise »")
        let red = redness(app, in: range.frame)
        XCTAssertLessThan(red, 40, "the range's words are grey, never red: \(red)")
    }

    /// CO9: fewer than 4 weigh-ins in 7 days: how many more, and the points without a line.
    func testEarlyPointsNoLine() {
        let app = corps("bodyEarly")
        XCTAssertTrue(
            app.staticTexts["Encore 1 pesée cette semaine"].waitForExistence(timeout: 5), "one more weigh-in for the average")
        XCTAssertTrue(
            app.staticTexts["La moyenne apparaît dès 4 pesées sur 7 jours. Tes trois premières sont déjà là."].exists)
        let chart = element(app, "trend-chart")
        XCTAssertTrue(chart.exists, "the points show")
        XCTAssertFalse(chart.label.contains("Moyenne"), "no average line yet: \(chart.label)")
        XCTAssertFalse(app.staticTexts["80,2"].exists)
    }

    /// Ta tendance's daily weigh-ins in grey, the line alone in the body's colour.
    func testDailyWeighInsInGrey() {
        let app = corps("trend")
        let row = element(app, "corps-weeks")
        XCTAssertTrue(app.swipeUpUntil(row))
        row.tap()
        let legend = element(app, "legend-day")
        XCTAssertTrue(app.swipeUpUntil(legend))
        XCTAssertLessThan(redness(app, in: legend.frame), 15, "the day's dot is grey")
    }

    /// CO10: no weigh-in: the words, the empty grid's sentence, and the one blue button.
    func testFirstAddsWeighIn() {
        let app = corps("bodyFirst")
        XCTAssertTrue(app.staticTexts["Pas encore de pesée"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts[
                "La moyenne apparaît dès 4 pesées sur 7 jours, la perte par semaine après deux semaines complètes."
            ].exists)
        XCTAssertTrue(text(app, containing: "Ta courbe commence à ta première pesée.").exists, "the empty grid says so")
        let add = app.buttons["Ajouter une pesée"].firstMatch
        XCTAssertTrue(add.exists)
        add.tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5), "it opens the weigh-in sheet")
    }

    /// The day under the large title, as on Accueil.
    func testDateUnderTheTitle() {
        let app = corps("bodyUsual")
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.dateFormat = "EEEE d MMMM"
        let day = formatter.string(from: .now)
        XCTAssertTrue(app.staticTexts[day.prefix(1).uppercased() + day.dropFirst()].waitForExistence(timeout: 5))
    }

    /// CO11, CO12: each row in words, each opening its sheet or screen; « + » opens the sheet.
    func testTodayRowsOpenTheirScreens() {
        let app = corps("bodyUsual")
        let weighIn = element(app, "today.weighIn")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.supplements")))
        XCTAssertEqual(weighIn.label, "Pesée, 79,9 kilos")
        XCTAssertEqual(element(app, "today.measures").label, "Mensurations, taille 84,5\u{202F}cm · \(frenchWeekday(-3))")
        XCTAssertEqual(element(app, "today.intake").label, "Apports, 1\u{202F}850\u{202F}kcal · 128\u{202F}g de protéines")
        XCTAssertEqual(element(app, "today.supplements").label, "Compléments, 1 sur 2")
        // The day's weigh-in and intake done carry a ✓, said « saisie » and « saisis ».
        XCTAssertEqual(weighIn.value as? String, "saisie")
        XCTAssertEqual(element(app, "today.intake").value as? String, "saisis")
        XCTAssertEqual(element(app, "today.measures").value as? String ?? "", "")

        weighIn.tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5), "Pesée opens its sheet")
        element(app, "weighin-close").tap()
        for (id, title) in [("today.measures", "Mensurations"), ("today.intake", "Apports"), ("today.supplements", "Compléments")] {
            XCTAssertTrue(app.swipeUpUntil(element(app, id)))
            element(app, id).tap()
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5), "\(id) opens \(title)")
            app.navigationBars[title].buttons.firstMatch.tap()
            XCTAssertTrue(app.navigationBars["Corps"].waitForExistence(timeout: 5))
        }
        app.swipeDown()
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5), "« + » opens the sheet")
    }

    /// CO14: typed on the keypad, ✓ turns on within the bounds, and Corps reads it back.
    func testWeighInThroughKeypad() {
        let app = corps("bodyEarly")
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        let save = element(app, "weighin-save")
        XCTAssertFalse(save.isEnabled, "✓ is grey while empty")
        XCTAssertTrue(app.staticTexts["En gris, ta dernière pesée."].exists)
        let field = element(app, "weighin-kg")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keypad is open")
        field.typeText("19,9")
        XCTAssertFalse(save.isEnabled, "under 20 kg is refused")
        for _ in 0..<4 { field.typeText(XCUIKeyboardKey.delete.rawValue) }
        field.typeText("79,45")
        XCTAssertFalse(save.isEnabled, "off the 0,1 grid is refused")
        field.typeText(XCUIKeyboardKey.delete.rawValue)
        XCTAssertTrue(save.isEnabled, "79,4 turns ✓ on")
        save.tap()
        XCTAssertFalse(app.sheetTitle("Pesée").waitForExistence(timeout: 2) && app.sheetTitle("Pesée").isHittable)
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")))
        XCTAssertEqual(element(app, "today.weighIn").label, "Pesée, 79,4 kilos", "read back on Corps")
    }

    /// CO15: a day already weighed opens on its value, and its deletion asks first.
    func testSameDayOpensValueAndDeletes() {
        let app = corps("bodyUsual")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")))
        element(app, "today.weighIn").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "weighin-kg").value as? String, "79,9", "the day's value")
        let delete = element(app, "weighin-delete")
        XCTAssertTrue(app.swipeUpUntil(delete), "« Supprimer la pesée » shows")
        delete.tap()
        let confirm = app.buttons["Supprimer"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 3), "it asks first")
        confirm.tap()
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")))
        XCTAssertTrue(
            element(app, "today.weighIn").comesToRead("Pesée, pas encore saisie"),
            "the day's weigh-in is gone")
    }

    /// CO17: the import card shows once; « Pas maintenant » never shows it again.
    func testHealthCardOnceAndNotNow() {
        let app = corps("healthCard")
        XCTAssertTrue(app.staticTexts["Tes pesées de Santé"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts[
                "Celles d’une balance connectée ou saisies dans Santé arrivent ici. Une pesée déjà dans Belay n’est jamais remplacée."
            ].exists)
        XCTAssertTrue(app.buttons["Importer les pesées"].exists)
        app.buttons["Pas maintenant"].tap()
        XCTAssertFalse(app.staticTexts["Tes pesées de Santé"].waitForExistence(timeout: 2), "the card leaves")
        let again = corps("keep")
        XCTAssertTrue(again.staticTexts["Pas encore de pesée"].waitForExistence(timeout: 5))
        XCTAssertFalse(again.staticTexts["Tes pesées de Santé"].exists, "never again")
    }

    /// The Santé section of Réglages, reached from Accueil's avatar. « Sur cet iPhone » comes after
    /// the display rows (A26), so the list scrolls to it.
    private func reglages(_ app: XCUIApplication) -> (health: XCUIElement, imports: XCUIElement) {
        app.tab("Accueil")
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
        let health = app.switches["health-switch"]
        XCTAssertTrue(app.swipeUpUntil(health), "« Sur cet iPhone » is reached")
        return (health, app.switches["health-import-switch"])
    }

    /// CO17, CO18: with Santé off, « Importer les pesées » turns Santé and its import on once iOS
    /// lets Belay in, and the import brings Health's weigh-in of today. The card then leaves for
    /// good. Health's answer is the fixture's: the system's own sheet is proved on the phone.
    func testImportTurnsSanteAndItsImportOn() {
        let app = corps("healthCard", health: "allowed")
        let accept = app.buttons["Importer les pesées"]
        XCTAssertTrue(accept.waitForExistence(timeout: 5))
        accept.tap()
        XCTAssertTrue(
            app.staticTexts["Tes pesées de Santé"].waitFor(NSPredicate(format: "exists == false"), timeout: 5), "the card leaves")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")))
        XCTAssertTrue(
            element(app, "today.weighIn").comesToRead("Pesée, 79,9 kilos · depuis Santé"), "Health's weigh-in came in")
        let switches = reglages(app)
        XCTAssertEqual(switches.health.value as? String, "1", "Santé is on")
        XCTAssertEqual(switches.imports.value as? String, "1", "the import is on")
        let again = corps("keep")
        XCTAssertFalse(again.staticTexts["Tes pesées de Santé"].waitForExistence(timeout: 3), "never again")
    }

    /// CO17, R24: iOS refused, nothing is imported, so the card stays, says why and can be tapped again.
    func testRefusedImportKeepsTheCard() {
        let app = corps("healthCard", health: "refused")
        let accept = app.buttons["Importer les pesées"]
        XCTAssertTrue(accept.waitForExistence(timeout: 5))
        accept.tap()
        XCTAssertTrue(
            app.staticTexts[
                "Pour importer tes pesées, Belay a besoin de l’accès à Santé. Autorise-le dans l’app Santé, puis réessaie."
            ].waitForExistence(timeout: 5), "the card says why")
        XCTAssertTrue(app.staticTexts["Tes pesées de Santé"].exists, "the card stays")
        XCTAssertTrue(accept.isHittable, "to try again")
        XCTAssertTrue(app.staticTexts["Pas encore de pesée"].exists, "nothing imported")
        let switches = reglages(app)
        XCTAssertEqual(switches.health.value as? String, "0", "Santé stays off")
        XCTAssertEqual(switches.imports.value as? String, "0", "the import stays off")
    }

    /// In English the percent sign follows the figure with no space.
    func testEnglishPercentTakesNoSpace() {
        let app = corps("bodyOutOfRange", english: true)
        let range = element(app, "trend-range")
        XCTAssertTrue(range.waitForExistence(timeout: 5))
        XCTAssertEqual(range.label, "outside your range, 0.5 to 1%")
        let change = element(app, "trend-change").label
        XCTAssertTrue(change.range(of: #"^up \d\.\d%/wk last week$"#, options: .regularExpression) != nil, change)
    }

    /// A weigh-in the import filled says where it came from.
    func testImportedRowSaysFromHealth() {
        let app = corps("weighedFromHealth")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")))
        XCTAssertEqual(element(app, "today.weighIn").label, "Pesée, 79,9 kilos · depuis Santé")
        XCTAssertEqual(element(app, "today.weighIn").value as? String, "saisie", "with its ✓")
    }

    /// CO13: at AX3 the average holds one line, the span and the rows stay whole.
    func testAx3Corps() {
        let app = corps("bodyUsual", largestText: true)
        let window = app.windows.firstMatch.frame
        let average = app.staticTexts["80,2"]
        XCTAssertTrue(average.waitForExistence(timeout: 5))
        XCTAssertLessThan(average.frame.height, 140, "one line: \(average.frame)")
        XCTAssertLessThanOrEqual(average.frame.maxX, window.maxX)
        let span = app.segmentedControls["trend-span"]
        XCTAssertTrue(app.swipeUpUntil(span))
        XCTAssertLessThanOrEqual(span.frame.maxX, window.maxX, "the span is whole")
        XCTAssertLessThan(span.frame.height, 90, "the span's text is capped: \(span.frame)")
        for id in ["today.weighIn", "today.measures", "today.intake", "today.supplements"] {
            let row = element(app, id)
            XCTAssertTrue(app.swipeUpUntil(row), "\(id) can be reached")
            XCTAssertLessThanOrEqual(row.frame.maxX, window.maxX, "\(id) is whole")
        }
    }

    /// CO16: at AX3 the field stays above the keypad, and empty keeps ✓ grey.
    func testAx3Sheet() {
        let app = corps("bodyEarly", largestText: true)
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        let field = element(app, "weighin-kg")
        XCTAssertLessThanOrEqual(field.frame.maxY, keyboard.frame.minY, "the field stays above the keypad")
        XCTAssertFalse(element(app, "weighin-save").isEnabled, "empty keeps ✓ grey")
        XCTAssertEqual(field.placeholderValue, "79,8", "the last weigh-in in grey")
    }

    /// CO35: « Aujourd'hui » turns to the new day at midnight, with Corps on screen.
    func testMidnightRollsToday() {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let app = corps("bodyUsual", now: "\(formatter.string(from: .now))T23:59:20")
        let row = element(app, "today.weighIn")
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertEqual(row.label, "Pesée, 79,9 kilos", "weighed, before midnight")
        XCTAssertTrue(
            row.comesToRead("Pesée, pas encore saisie", timeout: 70),
            "past midnight, the new day is not weighed yet")
    }

    /// Réglages from Accueil, the weight unit set to `word` (« kilos » or « livres »), then back on
    /// Accueil.
    private func switchUnit(_ app: XCUIApplication, to word: String) {
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
        // Right after launch the list can still move under the first tap: tapped again until chosen.
        let choice = row.segmentedControls.firstMatch.buttons[word]
        let chosen = NSPredicate(format: "isSelected == true")
        for _ in 0..<3 where !choice.isSelected {
            choice.tap()
            _ = choice.waitFor(chosen, timeout: 2)
        }
        XCTAssertTrue(choice.isSelected, "\(word) chosen")
        app.navigationBars.buttons.firstMatch.tap()
    }

    /// No toast anywhere on screen: the change itself is the answer.
    private func assertNoToast(_ app: XCUIApplication, _ after: String) {
        let toast = app.descendants(matching: .any)
            .matching(NSPredicate(format: "identifier CONTAINS[c] 'toast' OR label IN %@", [
                "Pesée enregistrée", "Complément retiré", "Complément ajouté",
            ]))
        XCTAssertEqual(toast.count, 0, "no toast after \(after)")
    }

    /// A weigh-in typed in quarter pounds is stored on the tenth of a kilo: 177,25 lb is 80,4 kg,
    /// read back as typed in pounds and as 80,4 in kilos.
    func testWeighInInQuarterPoundsStoredInTenthKilos() {
        let app = corps("bodyEarly")
        switchUnit(app, to: "livres")
        app.tab("Corps")
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["lb"].exists, "the field's unit is the pound")
        let field = element(app, "weighin-kg")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "the keypad is open")
        field.typeText("177,25")
        let save = element(app, "weighin-save")
        XCTAssertTrue(save.isEnabled, "a quarter pound within the bounds turns ✓ on")
        save.tap()
        let row = element(app, "today.weighIn")
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertTrue(row.comesToRead("Pesée, 177,25 livres"), "read back in pounds: \(row.label)")
        switchUnit(app, to: "kilos")
        app.tab("Corps")
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertTrue(row.comesToRead("Pesée, 80,4 kilos"), "stored as 80,4 kg: \(row.label)")
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        XCTAssertTrue(
            element(app, "weighin-kg").waitFor(NSPredicate(format: "value == %@", "80,4")), "today's value in kilos")
    }

    /// Accueil's card, Corps's figure, the curve and the weeks' averages, all in pounds: the
    /// 7-day average of 80,2 kg reads 176,75 lb, today's 79,9 kg reads 176,25 lb.
    func testTrendAndCurveInPounds() {
        let app = corps("bodyUsual")
        switchUnit(app, to: "livres")
        let figure = app.staticTexts["176,75"]
        XCTAssertTrue(app.swipeUpUntil(figure), "Accueil's card in pounds")
        XCTAssertFalse(app.staticTexts["80,2"].exists, "no kilos left on Accueil's card")
        app.tab("Corps")
        XCTAssertTrue(app.staticTexts["176,75"].waitForExistence(timeout: 5), "Corps's figure in pounds")
        XCTAssertTrue(app.staticTexts["livres"].exists, "its unit said as a word")
        let chart = element(app, "trend-chart")
        XCTAssertTrue(chart.label.hasSuffix("176,75 livres"), "the curve's average in pounds: \(chart.label)")
        let row = element(app, "corps-weeks")
        XCTAssertTrue(app.swipeUpUntil(row))
        row.tap()
        XCTAssertTrue(app.navigationBars["Ta tendance"].waitForExistence(timeout: 5))
        app.segmentedControls["trend-span"].buttons["Semaine"].tap()
        let pattern = ".*Pesée [0-9]+,[0-9]+ livres · Moyenne 7 j [0-9]+,[0-9]+ livres"
        let point = element(app, "trend-chart")
        point.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        XCTAssertTrue(point.waitFor(NSPredicate(format: "value MATCHES %@", pattern)), "a point read in pounds: \(point.value ?? "")")
        let week = element(app, "week-1")
        XCTAssertTrue(app.swipeUpUntil(week))
        XCTAssertTrue(
            week.label.range(of: "7 pesées · [0-9]+,[0-9]+ livres", options: .regularExpression) != nil,
            "the week's average in pounds: \(week.label)")
    }

    /// Outside the weigh-in's bounds in pounds, ✓ stays grey and the bounds are said in pounds.
    func testWeighInOutsideBoundsInPoundsRefused() {
        let app = corps("bodyEarly")
        switchUnit(app, to: "livres")
        app.tab("Corps")
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        let field = element(app, "weighin-kg")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        field.typeText("40")
        XCTAssertFalse(element(app, "weighin-save").isEnabled, "40 lb is under 20 kg")
        let bounds = "Saisis un poids entre 44,25 et 881,75\u{202F}lb."
        XCTAssertTrue(app.staticTexts[bounds].waitForExistence(timeout: 3), "the bounds said in pounds")
        field.typeText("00")
        XCTAssertFalse(element(app, "weighin-save").isEnabled, "4 000 lb is over 400 kg")
        XCTAssertTrue(app.staticTexts[bounds].exists, "the bounds said again")
        for _ in 0..<4 { field.typeText(XCUIKeyboardKey.delete.rawValue) }
        field.typeText("400")
        XCTAssertTrue(element(app, "weighin-save").isEnabled, "400 lb turns ✓ on")
        XCTAssertFalse(app.staticTexts[bounds].exists, "and the bounds leave")
        for _ in 0..<3 { field.typeText(XCUIKeyboardKey.delete.rawValue) }
        field.typeText("44,1")
        XCTAssertFalse(element(app, "weighin-save").isEnabled, "44,1 lb is under the stated 44,25")
        XCTAssertTrue(app.staticTexts[bounds].waitForExistence(timeout: 3), "the stated bound refuses it")
    }

    /// « Retirer » on a supplement asks first, its name in the question; Annuler keeps it, and once
    /// retired its checked days still draw creatine's band on Ta tendance.
    func testRemoveAsksFirstThenKeepsCheckedDays() {
        let app = corps("trend")
        let today = element(app, "today.supplements")
        XCTAssertTrue(app.swipeUpUntil(today))
        today.tap()
        XCTAssertTrue(app.navigationBars["Compléments"].waitForExistence(timeout: 5))
        let manage = element(app, "supplements-manage")
        XCTAssertTrue(app.swipeUpUntil(manage))
        manage.tap()
        XCTAssertTrue(app.navigationBars["Mes compléments"].waitForExistence(timeout: 5))
        let creatine = element(app, "manage-0")
        XCTAssertTrue(creatine.waitForExistence(timeout: 5))
        XCTAssertTrue(creatine.label.hasPrefix("Créatine, "), creatine.label)

        func ask() -> XCUIElement {
            creatine.swipeLeft()
            let swiped = app.buttons["Retirer"]
            XCTAssertTrue(swiped.waitForExistence(timeout: 3), "the swipe offers Retirer")
            swiped.tap()
            XCTAssertTrue(text(app, containing: "Retirer Créatine\u{202F}?").waitForExistence(timeout: 3), "it asks first")
            XCTAssertTrue(app.staticTexts["Ses jours cochés restent."].exists, "what becomes of its days")
            let confirm = app.buttons.matching(NSPredicate(format: "label == %@", "Retirer")).allElementsBoundByIndex.last
            XCTAssertNotNil(confirm)
            return confirm!
        }

        let confirm = ask()
        XCTAssertGreaterThan(redness(app, in: confirm.frame), 60, "« Retirer » is red")
        let dismiss = app.otherElements["PopoverDismissRegion"]
        if app.buttons["Annuler"].exists { app.buttons["Annuler"].tap() } else { dismiss.tap() }
        XCTAssertTrue(
            text(app, containing: "Retirer Créatine\u{202F}?").waitFor(NSPredicate(format: "exists == false"), timeout: 3),
            "the question leaves")
        XCTAssertTrue(creatine.label.hasPrefix("Créatine, "), "Annuler keeps it: \(creatine.label)")

        ask().tap()
        XCTAssertTrue(creatine.comesToRead("Vitamine D, 0 jour marqué", timeout: 10), "Créatine leaves the list: \(creatine.label)")
        assertNoToast(app, "a removal")

        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Compléments"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Corps"].waitForExistence(timeout: 5))
        let weeks = element(app, "corps-weeks")
        XCTAssertTrue(app.swipeDownUntil(weeks) || app.swipeUpUntil(weeks))
        weeks.tap()
        XCTAssertTrue(app.navigationBars["Ta tendance"].waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "legend-creatine").waitForExistence(timeout: 5), "its checked days still draw the band")
    }

    /// A weigh-in saved raises no toast; the removal's own test checks the same after « Retirer ».
    func testNoToastAnywhere() {
        let app = corps("bodyEarly")
        element(app, "corps-add").tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        element(app, "weighin-kg").typeText("79,4")
        element(app, "weighin-save").tap()
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")))
        XCTAssertTrue(element(app, "today.weighIn").comesToRead("Pesée, 79,4 kilos"))
        assertNoToast(app, "a weigh-in")
    }

    /// CO36: once Corps scrolls, no compact title and no bar; « + » stays.
    func testNoCompactTitle() {
        let app = corps("bodyUsual", largestText: true)
        XCTAssertTrue(element(app, "chip.body").waitForExistence(timeout: 5))
        app.swipeUp()
        app.swipeUp()
        let compact = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == %@", "Corps"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(compact, "no compact title once scrolled")
        XCTAssertTrue(element(app, "corps-add").isHittable, "« + » stays")
    }
}
