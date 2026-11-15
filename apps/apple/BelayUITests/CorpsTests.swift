import XCTest

/// Corps's home and the weigh-in sheet on the fixture's body modes, whose days follow the fixture
/// clock: `bodyUsual` holds five weeks of weigh-ins losing 0,1 kg a day, today's at 79,9 kg, a
/// waist three days ago, today's intake and one supplement of two ticked; `bodyOutOfRange` gains
/// slowly; `bodyEarly` holds three weigh-ins, none today; `bodyFirst` none; `healthCard` is an
/// empty store whose import card was never answered; `weighedFromHealth` has today's weigh-in
/// filled by the Health import.
@MainActor
final class CorpsTests: XCTestCase {
    private func launch(_ fixture: String, largestText: Bool = false, now: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if let now { app.launchArguments += ["-BelayNow", now] }
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launchFixture()
        return app
    }

    /// Launches on `fixture` and opens the Corps tab.
    private func corps(_ fixture: String, largestText: Bool = false, now: String? = nil) -> XCUIApplication {
        let app = launch(fixture, largestText: largestText, now: now)
        let tab = app.tabBars.firstMatch.buttons["Corps"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        XCTAssertTrue(app.navigationBars["Corps"].waitForExistence(timeout: 5), "Corps is native")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// Whether `element` comes to read `label` within `timeout` seconds.
    private func labels(_ element: XCUIElement, _ label: String, timeout: TimeInterval = 3) -> Bool {
        let expectation = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label == %@", label), object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
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
        XCTAssertTrue(app.staticTexts["La moyenne apparaît dès 4 pesées sur 7 jours."].exists)
        let chart = element(app, "trend-chart")
        XCTAssertTrue(chart.exists, "the points show")
        XCTAssertFalse(chart.label.contains("Moyenne"), "no average line yet: \(chart.label)")
        XCTAssertFalse(app.staticTexts["80,2"].exists)
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

    /// CO11, CO12: each row in words, each opening its sheet or screen; « + » opens the sheet.
    func testTodayRowsOpenTheirScreens() {
        let app = corps("bodyUsual")
        let weighIn = element(app, "today.weighIn")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.supplements")))
        XCTAssertEqual(weighIn.label, "Pesée, 79,9\u{202F}kg")
        XCTAssertEqual(element(app, "today.measures").label, "Mensurations, taille 84,5\u{202F}cm · \(frenchWeekday(-3))")
        XCTAssertEqual(element(app, "today.intake").label, "Apports, 1\u{202F}850\u{202F}kcal · 128\u{202F}g de protéines")
        XCTAssertEqual(element(app, "today.supplements").label, "Compléments, 1 sur 2")

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
        XCTAssertEqual(element(app, "today.weighIn").label, "Pesée, 79,4\u{202F}kg", "read back on Corps")
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
            labels(element(app, "today.weighIn"), "Pesée, pas encore saisie"),
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

    /// A weigh-in the import filled says where it came from.
    func testImportedRowSaysFromHealth() {
        let app = corps("weighedFromHealth")
        XCTAssertTrue(app.swipeUpUntil(element(app, "today.weighIn")))
        XCTAssertEqual(element(app, "today.weighIn").label, "Pesée, 79,9\u{202F}kg · depuis Santé")
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
        XCTAssertEqual(row.label, "Pesée, 79,9\u{202F}kg", "weighed, before midnight")
        XCTAssertTrue(
            labels(row, "Pesée, pas encore saisie", timeout: 70),
            "past midnight, the new day is not weighed yet")
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
