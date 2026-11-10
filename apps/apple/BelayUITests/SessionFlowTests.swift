import XCTest

/// The session cover on a fixture account whose last session A logged the bench press at 62,5 kg
/// for 8, 8, 7 and 6, with a new session A open: two warm-ups come first, then the work sets. One
/// set at a time: the ruler and ✓, then the rest that asks the reserve.
@MainActor
final class SessionFlowTests: XCTestCase {
    private static let ax3 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"]

    /// `history` opens the store described above, `keep` the one the previous launch left.
    private func launch(_ fixture: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture] + extra
        app.launchFixture()
        return app
    }

    /// Accueil's Reprendre opens the cover.
    private func openCover(_ app: XCUIApplication) {
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        XCTAssertTrue(element(app, "session-clock").waitForExistence(timeout: 5), "the cover shows")
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func button(_ app: XCUIApplication, beginning part: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", part)).firstMatch
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// How many set changes of the open session the queue holds, as the fixture reports it.
    private func queuedSets(_ app: XCUIApplication) -> String? {
        element(app, "fixture-queue").value as? String
    }

    private func setTitle(_ app: XCUIApplication) -> String {
        element(app, "set-title").label
    }

    /// The two warm-ups of the bench press, each with one ✓, until its first work set is up.
    private func passWarmups(_ app: XCUIApplication) {
        for _ in 0..<2 {
            XCTAssertTrue(setTitle(app).hasPrefix("Montée"), "a warm-up is due: \(setTitle(app))")
            element(app, "log-set").tap()
        }
        let title = element(app, "set-title")
        XCTAssertTrue(
            title.waitFor(NSPredicate(format: "label == %@", "Série 1 sur 4")), "the first work set: \(title.label)")
    }

    /// Logs the first work set and waits for its rest.
    private func logFirstWorkSet(_ app: XCUIApplication) {
        passWarmups(app)
        element(app, "log-set").tap()
        XCTAssertTrue(element(app, "rest-clock").waitForExistence(timeout: 3), "the rest starts")
    }

    /// Drags the ruler by `steps` counts, slowly enough that it snaps where the finger stops; a
    /// count is 50 points wide, and the drag goes a little further for the slop a touch takes.
    private func slide(_ ruler: XCUIElement, by steps: Int) {
        let start = ruler.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        start.press(
            forDuration: 0.1, thenDragTo: start.withOffset(CGVector(dx: -50 * steps - 20, dy: 0)), withVelocity: .slow,
            thenHoldForDuration: 0.5)
    }

    /// Seconds on a « m:ss » clock.
    private func seconds(_ clock: String) -> Int? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : nil
    }

    func testOneTapLogsPrefilled() {
        let app = launch("history")
        openCover(app)
        let ruler = element(app, "rep-ruler")
        let prefilled = ruler.value as? String ?? ""
        XCTAssertFalse(prefilled.isEmpty, "the ruler opens on a count")
        XCTAssertEqual(queuedSets(app), "0", "nothing is queued for this session yet")

        element(app, "log-set").tap()
        let row = element(app, "done-0-0")
        XCTAssertTrue(row.waitForExistence(timeout: 3), "the set shows in « Faites »")
        XCTAssertTrue(app.staticTexts["Faites"].exists)
        XCTAssertTrue(row.label.contains("Montée"), "the warm-up: \(row.label)")
        XCTAssertTrue(row.label.contains("× \(prefilled)"), "with the ruler's count \(prefilled): \(row.label)")
        XCTAssertEqual(queuedSets(app), "1", "the set is stored and queued once")
    }

    func testRulerReachesTwelve() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        let ruler = element(app, "rep-ruler")
        XCTAssertEqual(ruler.value as? String, "8", "last time's count")
        slide(ruler, by: 4)
        XCTAssertEqual(ruler.value as? String, "12")
        XCTAssertTrue(app.buttons["Noter la série 1, 12 reps"].exists, "✓ says what it logs")
        element(app, "log-set").tap()
        let row = element(app, "done-0-3")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertTrue(row.label.contains("× 12"), "the done row reads 12: \(row.label)")
    }

    func testLoadChoicesAndKeypad() {
        let app = launch("history")
        openCover(app)
        passWarmups(app)
        let load = element(app, "load")
        XCTAssertTrue(load.label.contains("62,5"), load.label)
        load.tap()
        // One increment of the bench press below, the load, one and two above.
        for kg in ["60", "62,5", "65", "67,5"] {
            XCTAssertTrue(app.buttons["\(kg)\u{202F}kg"].waitForExistence(timeout: 2), "\(kg) kg is offered")
        }
        app.buttons["65\u{202F}kg"].tap()
        XCTAssertTrue(load.waitFor(NSPredicate(format: "label CONTAINS %@", "65")), load.label)

        load.tap()
        app.buttons["Autre charge…"].tap()
        let keypad = app.alerts.textFields.firstMatch
        XCTAssertTrue(keypad.waitForExistence(timeout: 2), "a keypad opens")
        keypad.typeText("70,5")
        app.alerts.buttons["OK"].tap()
        XCTAssertTrue(load.waitFor(NSPredicate(format: "label CONTAINS %@", "70,5")), load.label)

        element(app, "log-set").tap()
        XCTAssertTrue(element(app, "skip-rest").waitForExistence(timeout: 3))
        element(app, "skip-rest").tap()
        XCTAssertTrue(element(app, "set-title").waitFor(NSPredicate(format: "label == %@", "Série 2 sur 4")))
        XCTAssertTrue(element(app, "load").label.contains("70,5"), "the next set starts from it")
    }

    func testProgressionLine() {
        let app = launch("history")
        openCover(app)
        XCTAssertEqual(element(app, "progression").label, "Montée légère, sans forcer")
        passWarmups(app)
        let line = element(app, "progression")
        XCTAssertEqual(line.label, "Même charge, vise 8 reps")
        element(app, "load").tap()
        app.buttons["65\u{202F}kg"].tap()
        XCTAssertTrue(
            line.waitFor(NSPredicate(format: "label == %@", "+2,5\u{202F}kg depuis la dernière fois")), line.label)
        line.tap()
        XCTAssertTrue(
            text(app, containing: "62,5\u{202F}kg × 8, 8, 7, 6").waitForExistence(timeout: 2),
            "last time's sets show")
    }

    func testRestAsksRIRThenCapsuleFades() {
        let app = launch("history")
        openCover(app)
        logFirstWorkSet(app)
        XCTAssertTrue(app.staticTexts["Série 1\u{202F}: combien en réserve\u{202F}?"].exists, "the foot asks")
        for rir in 0...4 {
            XCTAssertFalse(element(app, "rir-\(rir)").isSelected, "nothing chosen")
        }
        XCTAssertTrue(text(app, containing: "Cible").exists, "the target as a hint")
        element(app, "rir-1").tap()
        let noted = app.staticTexts["Réserve 1 notée"]
        XCTAssertTrue(noted.waitForExistence(timeout: 2), "the answer shows in a capsule")
        XCTAssertTrue(noted.waitForNonExistence(timeout: 4), "and fades")
        XCTAssertTrue(element(app, "rest-clock").exists, "leaving the clock alone")
        XCTAssertFalse(element(app, "rir-1").exists, "asked once")
        XCTAssertTrue(element(app, "done-0-3").label.contains("RIR 1"), element(app, "done-0-3").label)
    }

    func testRestCountsToAbsoluteEnd() throws {
        let app = launch("history")
        openCover(app)
        logFirstWorkSet(app)
        let clock = element(app, "rest-clock")
        let first = try XCTUnwrap(seconds(clock.label), "a clock: \(clock.label)")
        let read = Date.now
        // The bench press rests 150 s; a second or two goes by before the label is read.
        XCTAssertTrue((140...150).contains(first), "the rule's rest: \(first) s")

        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 20)
        app.activate()
        XCTAssertTrue(clock.waitForExistence(timeout: 5))
        let later = try XCTUnwrap(seconds(clock.label), "a clock: \(clock.label)")
        let away = Int(Date.now.timeIntervalSince(read).rounded())
        XCTAssertGreaterThanOrEqual(away, 20)
        XCTAssertTrue((first - away - 3...first - away + 2).contains(later), "\(away) s less: \(first) then \(later)")
    }

    func testAddThirtyAndSkip() throws {
        let app = launch("history")
        openCover(app)
        logFirstWorkSet(app)
        let clock = element(app, "rest-clock")
        let before = try XCTUnwrap(seconds(clock.label))
        element(app, "add-thirty").tap()
        XCTAssertTrue(clock.waitFor(NSPredicate { object, _ in
            (object as? XCUIElement).flatMap { self.seconds($0.label) }.map { $0 >= before + 26 } ?? false
        }), "30 s more: \(before) then \(clock.label)")
        element(app, "skip-rest").tap()
        XCTAssertTrue(clock.waitForNonExistence(timeout: 3), "the rest ends")
        XCTAssertTrue(element(app, "set-title").waitFor(NSPredicate(format: "label == %@", "Série 2 sur 4")))
    }

    func testCardHeaderOpensProgramme() {
        let app = launch("history")
        openCover(app)
        let header = button(app, beginning: "Exercice 1 sur ")
        XCTAssertTrue(header.label.hasSuffix(", voir le programme"), header.label)
        header.tap()
        XCTAssertTrue(app.buttons["programme-close"].waitForExistence(timeout: 3), "the programme opens")
    }

    func testBarHoldsThreeControls() {
        var app = launch("history")
        openCover(app)
        XCTAssertTrue(app.buttons["Réduire la séance"].exists)
        XCTAssertTrue(app.buttons["Mettre la séance en pause"].exists)
        XCTAssertFalse(app.buttons["Terminer"].exists, "no Terminer in the bar")

        app.buttons["Mettre la séance en pause"].tap()
        let stop = app.buttons["Arrêter la séance"]
        XCTAssertTrue(stop.waitForExistence(timeout: 3), "pause becomes ■")
        let clock = element(app, "session-clock")
        let still = clock.label
        Thread.sleep(forTimeInterval: 2)
        XCTAssertEqual(clock.label, still, "the clock stands still")

        // The pause is kept through the cover's own updates and a relaunch.
        app.terminate()
        app = launch("keep")
        openCover(app)
        XCTAssertTrue(app.buttons["Arrêter la séance"].waitForExistence(timeout: 3), "still paused")
    }

    /// Scrolled, the cover draws no band under the bar: the card's title that went up shows
    /// through it in its own ink. A band, even a glassy one, leaves only a pale ghost of it there
    /// (184 of 255 at its darkest, measured with the hard edge effect).
    func testNoBarOnScroll() {
        let app = launch("history", extra: Self.ax3)
        openCover(app)
        passWarmups(app)
        let strip = barStrip(app)
        XCTAssertGreaterThan(darkest(pixels(app, in: strip)), 200, "nothing under the bar at rest")
        app.swipeUp()
        app.swipeUp()
        let titled = app.navigationBars.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Séance"))
        XCTAssertEqual(titled.count, 0, "no compact title: \(app.navigationBars.debugDescription)")
        XCTAssertLessThan(darkest(pixels(app, in: strip)), 100, "the title's ink shows under the bar, no band over it")
    }

    /// The bar's height, between ⌄ and the clock: nothing of the bar's own is drawn there.
    private func barStrip(_ app: XCUIApplication) -> CGRect {
        let bar = app.navigationBars.firstMatch.frame
        let lower = app.buttons["Réduire la séance"].frame
        let clock = element(app, "session-clock").frame
        return CGRect(x: lower.maxX + 6, y: bar.minY, width: clock.minX - lower.maxX - 12, height: bar.height)
    }

    /// The screen's pixels in `rect`, in points, as RGBA bytes.
    private func pixels(_ app: XCUIApplication, in rect: CGRect) -> [UInt8] {
        let image = app.screenshot().image
        let scale = image.scale
        let crop = CGRect(x: rect.minX * scale, y: rect.minY * scale, width: rect.width * scale, height: rect.height * scale)
        guard let cg = image.cgImage?.cropping(to: crop.integral) else { return [] }
        var bytes = [UInt8](repeating: 0, count: cg.width * cg.height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: cg.width, height: cg.height, bitsPerComponent: 8,
                bytesPerRow: cg.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(cg, in: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        }
        return bytes
    }

    /// The darkest pixel's gray, 0 for black to 255 for white.
    private func darkest(_ rgba: [UInt8]) -> Int {
        stride(from: 0, to: rgba.count - 3, by: 4).map { (Int(rgba[$0]) + Int(rgba[$0 + 1]) + Int(rgba[$0 + 2])) / 3 }
            .min() ?? 255
    }

    func testDraftSurvivesRelaunch() {
        var app = launch("history")
        openCover(app)
        passWarmups(app)
        element(app, "load").tap()
        app.buttons["65\u{202F}kg"].tap()
        let ruler = element(app, "rep-ruler")
        slide(ruler, by: 2)
        XCTAssertEqual(ruler.value as? String, "10")
        Thread.sleep(forTimeInterval: 1.5)

        app.terminate()
        app = launch("keep")
        openCover(app)
        XCTAssertTrue(element(app, "load").label.contains("65"), element(app, "load").label)
        XCTAssertEqual(element(app, "rep-ruler").value as? String, "10", "the count chosen")
    }

    /// A ✓ right after the ruler moved logs that count, and the next set keeps last time's. The
    /// launch stretches the ruler's wait to 4 s so the ✓ lands inside it.
    func testRulerThenCheckKeepsNextPrefill() {
        let app = launch("history", extra: ["-BelayDraftDelay", "4"])
        openCover(app)
        passWarmups(app)
        let ruler = element(app, "rep-ruler")
        slide(ruler, by: 2)
        element(app, "log-set").tap()
        let skip = element(app, "skip-rest")
        XCTAssertTrue(skip.waitForExistence(timeout: 3), "the rest starts")
        XCTAssertTrue(element(app, "done-0-3").label.contains("× 10"), element(app, "done-0-3").label)
        Thread.sleep(forTimeInterval: 5)
        skip.tap()
        XCTAssertTrue(element(app, "set-title").waitFor(NSPredicate(format: "label == %@", "Série 2 sur 4")))
        XCTAssertEqual(ruler.value as? String, "8", "the next set opens on last time's count")
    }

    /// Paused past an hour, the clock reads as it ran: hours, minutes, seconds.
    func testPausedClockPastAnHour() {
        let app = launch("pausedLong")
        openCover(app)
        let clock = element(app, "session-clock")
        XCTAssertTrue(app.buttons["Arrêter la séance"].waitForExistence(timeout: 3), "paused")
        XCTAssertTrue(clock.label.hasPrefix("1:15:"), clock.label)
    }

    func testLockLoggedAsksRIR() {
        let app = launch("lockLogged")
        openCover(app)
        XCTAssertTrue(element(app, "rest-clock").waitForExistence(timeout: 3), "the rest of the set runs")
        XCTAssertTrue(app.staticTexts["Série 1\u{202F}: combien en réserve\u{202F}?"].exists, "its RIR is asked")
    }

    func testReduceMotionCrossfades() {
        var app = launch("history")
        openCover(app)
        XCTAssertEqual(element(app, "fixture-motion").value as? String, "spring", "the cover moves on the spring by default")
        app.terminate()
        app = launch("history", extra: ["-BelayReduceMotion", "YES"])
        openCover(app)
        XCTAssertEqual(element(app, "fixture-motion").value as? String, "fade", "the cover only fades")
        logFirstWorkSet(app)
    }

    func testVoiceOverLabels() {
        let app = launch("history")
        openCover(app)
        XCTAssertTrue(button(app, beginning: "Noter la montée 1, ").exists, "✓ names the warm-up")
        XCTAssertTrue(button(app, beginning: "Exercice 1 sur ").exists)
        XCTAssertTrue(app.buttons["Réduire la séance"].exists)
        XCTAssertTrue(app.buttons["Mettre la séance en pause"].exists)
        XCTAssertEqual(element(app, "rep-ruler").label, "Répétitions faites")
        passWarmups(app)
        XCTAssertTrue(app.buttons["Noter la série 1, 8 reps"].exists)
        XCTAssertTrue(element(app, "load").label.hasPrefix("Charge, 62,5"), element(app, "load").label)
        element(app, "log-set").tap()
        XCTAssertTrue(app.buttons["Ajouter 30 secondes"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["Passer le repos"].exists)
        XCTAssertEqual(element(app, "rir-4").label, "4 ou plus en réserve")
        XCTAssertEqual(element(app, "rir-0").label, "0 en réserve")
    }

    func testAx3Caps() {
        func measure(_ extra: [String]) -> (figure: CGFloat, clock: CGFloat, foot: CGFloat, row: CGFloat) {
            let app = launch("history", extra: extra)
            openCover(app)
            element(app, "log-set").tap()
            let row = element(app, "done-0-0")
            XCTAssertTrue(row.waitForExistence(timeout: 3))
            let sizes = (
                element(app, "load").frame.height, element(app, "session-clock").frame.height,
                element(app, "log-set").frame.height, row.frame.height)
            app.terminate()
            return sizes
        }
        let base = measure([])
        let large = measure(Self.ax3)
        XCTAssertLessThanOrEqual(large.figure, base.figure * 1.35, "the figure is capped")
        XCTAssertLessThanOrEqual(large.clock, base.clock * 1.6, "the clock is capped")
        XCTAssertLessThanOrEqual(large.foot, base.foot * 1.35, "the foot is capped")
        XCTAssertGreaterThan(large.row, base.row * 1.8, "a done row goes on two lines")
    }
}
