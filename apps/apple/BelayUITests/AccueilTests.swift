import XCTest

/// Accueil's session card on a fixture account that stores no program: the starting program's
/// first session comes next, starts, and is still open after a relaunch.
@MainActor
final class AccueilTests: XCTestCase {
    /// `fresh` opens an empty store, `keep` the one the previous launch left; `now` sets the
    /// app's clock, a local `yyyy-MM-ddTHH:mm:ss`.
    private func launch(
        _ fixture: String, largestText: Bool = false, increasedContrast: Bool = false, now: String? = nil
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if let now { app.launchArguments += ["-BelayNow", now] }
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        if increasedContrast {
            app.launchArguments += ["-BelayContrast", "increased"]
        }
        app.launchFixture()
        return app
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    /// Session A of the starting program: six exercises, about 55 minutes.
    func testNextSessionOfTheStartingProgram() {
        let app = launch("fresh")
        XCTAssertTrue(app.staticTexts["La prochaine"].waitForExistence(timeout: 10), "the card says what comes next")
        XCTAssertTrue(app.staticTexts["Séance A"].exists, "the starting program begins with session A")
        XCTAssertTrue(text(app, containing: "6 exercices").exists, "with its exercise count")
        XCTAssertTrue(text(app, containing: "environ 55\u{202F}min").exists, "and its estimated time")
        XCTAssertTrue(app.buttons["Voir la séance"].exists, "the card opens it")
    }

    /// The day's state is a chip in the session's colour, holding the card's own words; no other
    /// domain marks Accueil.
    func testStateIsTheSessionChip() {
        let app = launch("fresh")
        let chip = app.descendants(matching: .any)["chip.session"]
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "the day card carries the session chip")
        XCTAssertEqual(chip.label, "La prochaine", "the chip reads the state as is")
        let chips = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'chip.'"))
        XCTAssertEqual(chips.count, 1, "the session is the only domain on Accueil")
    }

    /// How much bluer than red the top left of the screen reads, between the status bar and the
    /// title, in 0-255 steps: the session's tint is about 20 bluer in both appearances, the wall
    /// and the paper are grey.
    private func blueCast(_ app: XCUIApplication) -> Int {
        cast(app).blue
    }

    /// How much bluer and how much greener than red the top left of the screen reads, in 0-255
    /// steps. The session's blue is greener than red (+9 light, +13 dark), the rest violet is not
    /// (-3, -2); both are bluer than red.
    private func cast(_ app: XCUIApplication) -> (blue: Int, green: Int) {
        let shot = app.screenshot().image
        guard let image = shot.cgImage else {
            XCTFail("the screenshot has no bitmap")
            return (0, 0)
        }
        let scale = shot.scale
        let box = CGRect(x: 16 * scale, y: 70 * scale, width: 80 * scale, height: 20 * scale).integral
        guard let crop = image.cropping(to: box) else {
            XCTFail("the sample falls off the screen")
            return (0, 0)
        }
        let width = crop.width, height = crop.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = pixels.withUnsafeMutableBytes { bytes in
            guard
                let context = CGContext(
                    data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
                    bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            else { return false }
            context.draw(crop, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        XCTAssertTrue(drawn, "the sample draws")
        var red = 0, green = 0, blue = 0
        for pixel in stride(from: 0, to: pixels.count, by: 4) {
            red += Int(pixels[pixel])
            green += Int(pixels[pixel + 1])
            blue += Int(pixels[pixel + 2])
        }
        return ((blue - red) / (width * height), (green - red) / (width * height))
    }

    /// The session's tint washes the top of Accueil behind the title, as on the web.
    func testSessionBandBehindTheTitle() {
        let app = launch("fresh")
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 10))
        let cast = blueCast(app)
        XCTAssertGreaterThanOrEqual(cast, 8, "the top of the screen carries the session's tint: \(cast)")
    }

    /// Under increased contrast the band is gone: the top is the plain paper.
    func testNoBandUnderIncreasedContrast() {
        let app = launch("fresh", increasedContrast: true)
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 10))
        let cast = blueCast(app)
        XCTAssertLessThanOrEqual(cast, 3, "no tint at the top under increased contrast: \(cast)")
    }

    /// The person's name as the title, their initial on the avatar.
    func testGreetsByName() {
        let app = launch("fresh")
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 10), "Accueil greets by name")
        XCTAssertTrue(app.buttons["settings"].exists, "the avatar opens Réglages")
    }

    /// Voir la séance shows the session before it starts: its title, size and exercises, and the
    /// start at its foot.
    func testPreviewShowsTheSession() {
        let fresh = launch("fresh")
        let open = fresh.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(fresh.navigationBars["Séance A"].waitForExistence(timeout: 5), "the preview is titled by the session")
        XCTAssertTrue(text(fresh, containing: "6 exercices · environ 55\u{202F}min").exists, "with its size")
        XCTAssertTrue(fresh.staticTexts["Barbell bench press"].exists, "and its exercises")
        XCTAssertTrue(text(fresh, containing: "4 × 6–8").exists, "each with its sets and reps")
        XCTAssertFalse(fresh.buttons["resume-accessory"].exists, "nothing has started yet")
        let start = fresh.buttons["Commencer la séance"]
        XCTAssertTrue(start.exists, "the start sits at the foot")
        start.tap()
        XCTAssertTrue(fresh.buttons["Réduire la séance"].waitForExistence(timeout: 5), "Commencer la séance opens it")
    }

    /// Each exercise of the preview says what was logged last time, as figures.
    func testPreviewSaysTheLastTime() {
        let app = launch("past")
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5))
        let last = text(app, containing: "la dernière fois")
        XCTAssertTrue(last.exists, "the bench press has a last time")
        XCTAssertTrue(
            last.label.hasSuffix("4 × 6–8 · la dernière fois 62,5\u{202F}kg × 8, 8, 7, 6"), "as figures: \(last.label)")
    }

    /// A session started from the preview and finished closes onto Accueil, not onto the preview.
    func testFinishingClosesOntoAccueil() {
        let app = launch("past")
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let start = app.buttons["Commencer la séance"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        XCTAssertTrue(app.buttons["log-set"].waitForExistence(timeout: 5), "the cover shows")
        // One set noted, so ■ ends the session onto its summary rather than dropping it.
        app.buttons["log-set"].tap()
        app.finishSession(by: .stop)
        let close = app.buttons["summary-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 5), "back on Accueil")
        XCTAssertFalse(app.buttons["Commencer la séance"].exists, "the preview is gone")
    }

    /// Under way, the card and the accessory say where the session stands: the load on the bar,
    /// the exercise, the set.
    func testRunningCardLeadsWithTheLoad() {
        // Past the warm-ups, so the set up is the first work set at last time's load.
        let app = launch("workSet")
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10))
        XCTAssertTrue(text(app, containing: "62,5\u{202F}kg × 8").exists, "the card leads with the load on the bar")
        XCTAssertTrue(text(app, containing: "En cours · 0 série sur 19").exists, "and the sets done")
        XCTAssertTrue(app.staticTexts["Barbell bench press"].exists, "names the exercise under way")
        XCTAssertTrue(app.staticTexts["Série 1 sur 4 · Séance A"].exists, "and the set")
        let accessory = app.buttons["resume-accessory"]
        XCTAssertTrue(accessory.label.contains("Barbell bench press"), "the accessory names the exercise: \(accessory.label)")
        XCTAssertTrue(accessory.label.contains("Série 1 sur 4 · Séance A"), "and the set: \(accessory.label)")
    }

    /// On a warm-up the card and the accessory call the set « Montée », as the cover does.
    func testRunningCardNamesAWarmup() {
        let app = launch("warmups")
        XCTAssertTrue(app.buttons["Reprendre"].waitForExistence(timeout: 10))
        let line = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Montée 1 sur ")).firstMatch
        XCTAssertTrue(line.exists, "the card names the warm-up")
        XCTAssertTrue(line.label.hasSuffix(" · Séance A"), line.label)
        XCTAssertFalse(app.staticTexts["Série 1 sur 2 · Séance A"].exists, "never as a work set")
        let accessory = app.buttons["resume-accessory"]
        XCTAssertTrue(accessory.label.contains("Montée 1 sur "), "and the accessory: \(accessory.label)")
    }

    /// The preview's start opens the session; lowered, it waits above the tab bar; a relaunch finds it open.
    func testStartThenResumeAfterRelaunch() {
        var app = launch("fresh")
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let start = app.buttons["Commencer la séance"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()

        let lower = app.buttons["Réduire la séance"]
        XCTAssertTrue(lower.waitForExistence(timeout: 5), "Commencer opens the session")
        XCTAssertTrue(app.navigationBars["Séance A"].exists, "the session shows its title")
        lower.tap()

        let accessory = app.buttons["resume-accessory"]
        XCTAssertTrue(accessory.waitForExistence(timeout: 5), "the open session waits above the tab bar")
        XCTAssertTrue(app.buttons["Reprendre la séance"].exists, "the preview's foot now resumes it")
        accessory.tap()
        XCTAssertTrue(lower.waitForExistence(timeout: 5), "the accessory opens the session again")

        app.terminate()
        app = launch("keep")
        XCTAssertTrue(app.buttons["Reprendre"].waitForExistence(timeout: 10), "a relaunch finds the session open")
        XCTAssertTrue(text(app, containing: "En cours").exists, "and says it is under way")
        XCTAssertTrue(app.buttons["resume-accessory"].exists, "with the accessory above the tab bar")
        app.buttons["Reprendre"].tap()
        XCTAssertTrue(app.buttons["Réduire la séance"].waitForExistence(timeout: 5), "Reprendre opens it")
    }

    /// At the largest text size the session path is held to, the card keeps its button in reach.
    /// The card can sit below the fold there, and a list makes a row only once it scrolls into
    /// view, so the button is reached by scrolling rather than awaited where it stands.
    func testCardAtLargestText() {
        let app = launch("fresh", largestText: true)
        XCTAssertTrue(app.buttons["settings"].waitForExistence(timeout: 10), "Accueil shows")
        let start = app.buttons["Voir la séance"]
        XCTAssertTrue(app.swipeUpUntil(start), "Voir la séance can be tapped at AX3")
        XCTAssertGreaterThanOrEqual(start.frame.height, 44, "a 44 pt target")
    }

    // MARK: The day's states

    /// The French name of a weekday `offset` days from today, as the app writes it in a sentence.
    private func weekday(_ offset: Int, from day: Date = .now) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "fr_FR")
        formatter.dateFormat = "EEEE"
        return formatter.string(from: Calendar.current.date(byAdding: .day, value: offset, to: day) ?? day)
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    /// The active program and the active-program changes queued, as the store holds them.
    private func written(_ app: XCUIApplication) -> String {
        (element(app, "fixture-active").value as? String) ?? ""
    }

    /// In rotation the card says « La prochaine », the session large, its size, and opens its
    /// preview.
    func testNextOpensPreview() {
        let app = launch("fresh")
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "La prochaine")
        XCTAssertTrue(app.staticTexts["Séance A"].exists, "the session's letter leads")
        XCTAssertTrue(text(app, containing: "6 exercices · environ 55\u{202F}min").exists, "with its size")
        XCTAssertFalse(element(app, "next-row").exists, "no quiet row under a session to do")
        app.buttons["Voir la séance"].tap()
        XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5), "the preview opens")
    }

    /// On a fixed week, today's session is « Prévue ce {jour} » and opens its preview.
    func testDueOnFixedDay() {
        let app = launch("fixedWeek")
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "Prévue ce \(weekday(0))", "the web's words, today's weekday")
        XCTAssertTrue(app.staticTexts["Séance A"].exists, "today's session is A")
        app.buttons["Voir la séance"].tap()
        XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5), "its preview opens")
    }

    /// An open session keeps its running card, and « Reprendre » opens it.
    func testRunningResumes() {
        let app = launch("workSet")
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "chip.session").label.hasPrefix("En cours"), "the chip says it is under way")
        resume.tap()
        XCTAssertTrue(app.buttons["Réduire la séance"].waitForExistence(timeout: 5), "Reprendre opens the session")
    }

    /// Today's session done: the chip, the session, its tiles with the effort this phone holds, no
    /// blue button, and a quiet row to the next session that opens its preview.
    func testDoneTodayTilesAndNextRow() {
        let app = launch("doneToday")
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "Faite aujourd’hui")
        XCTAssertTrue(app.staticTexts["Séance A"].exists, "the session done")
        XCTAssertEqual(element(app, "done.duration").label, "Durée, 1\u{00A0}h 4\u{00A0}min")
        XCTAssertEqual(element(app, "done.sets").label, "Séries, 6", "the work sets kept")
        XCTAssertEqual(element(app, "done.effort").label, "Effort, Difficile", "the effort held here")
        XCTAssertFalse(app.buttons["Voir la séance"].exists, "no blue button on a day done")
        XCTAssertFalse(app.buttons["Reprendre"].exists)
        let row = element(app, "next-row")
        XCTAssertEqual(row.label, "La prochaine, Séance B", "in rotation, the next one with no day")
        row.tap()
        XCTAssertTrue(app.navigationBars["Séance B"].waitForExistence(timeout: 5), "the row opens its preview")
    }

    /// A fixed day's session done the day before says the day it was done on.
    func testDoneEarlyNamesItsDay() {
        let app = launch("doneEarly")
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "Faite \(weekday(-1))", "not « aujourd’hui »")
        XCTAssertTrue(app.staticTexts["Séance B"].exists, "today's session, done yesterday")
        XCTAssertFalse(element(app, "done.effort").exists, "no effort held: no tile, no dash")
        let row = element(app, "next-row")
        XCTAssertEqual(row.label, "\(weekday(2).capitalized), Séance C", "the next session day, by name")
    }

    /// A rest day reads in the rest colour, band and chip, says so, and names tomorrow's session.
    func testRestDayBandAndNextRow() {
        let app = launch("restDay")
        let chip = element(app, "chip.rest")
        XCTAssertTrue(chip.waitForExistence(timeout: 10), "the chip carries the rest domain")
        XCTAssertEqual(chip.label, "Jour de repos")
        XCTAssertFalse(element(app, "chip.session").exists)
        XCTAssertTrue(app.staticTexts["Repos"].exists)
        XCTAssertTrue(app.staticTexts["Prévu par ton programme"].exists)
        XCTAssertTrue(app.staticTexts["Tes muscles se reconstruisent aujourd’hui."].exists)
        XCTAssertFalse(app.buttons["Voir la séance"].exists, "nothing to do, nothing blue")
        let band = cast(app)
        XCTAssertGreaterThanOrEqual(band.blue, 5, "the top carries a tint: \(band)")
        XCTAssertLessThanOrEqual(band.green, 2, "the rest violet, not the session's blue: \(band)")
        let row = element(app, "next-row")
        XCTAssertEqual(row.label, "Demain, Séance A")
        row.tap()
        XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5), "the row opens its preview")
    }

    /// The session's band is the session's blue, not the rest violet.
    func testSessionBandIsBlue() {
        let app = launch("fixedWeek")
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 10))
        let band = cast(app)
        XCTAssertGreaterThanOrEqual(band.green, 4, "the session's blue: \(band)")
    }

    /// Nothing planned after a session kept: one blue button opens the program sheet; a tap there
    /// writes one active-program change, closes the sheet, and Accueil turns to the next session.
    func testNoProgramChoosesInSheet() {
        let app = launch("noProgram")
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "Aucune séance prévue")
        XCTAssertTrue(text(app, containing: "ta prochaine séance s’affichera ici").exists)
        XCTAssertTrue(written(app).hasSuffix("queued=0"), written(app))
        app.buttons["Choisir un programme"].tap()
        XCTAssertTrue(app.navigationBars["Programme actif"].waitForExistence(timeout: 5), "the sheet opens")
        XCTAssertTrue(text(app, containing: "Un toucher l’active et ferme.").exists, "with its footer")
        let program = element(app, "program.00000000-0000-7000-8000-0000000000f0")
        XCTAssertEqual(program.label, "Haut / Bas, 3 séances", "the live program with its sessions")
        XCTAssertFalse(text(app, containing: "Programme de départ").exists, "a removed program is not offered")
        program.tap()
        XCTAssertTrue(app.navigationBars["Programme actif"].waitForNonExistence(timeout: 5), "the tap closes the sheet")
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        XCTAssertEqual(chip.label, "La prochaine", "Accueil turns to the next session")
        XCTAssertTrue(app.staticTexts["Séance A"].exists)
        XCTAssertEqual(
            written(app), "active=00000000-0000-7000-8000-0000000000f0 queued=1", "one change, queued once")
    }

    /// The first launch welcomes with the mark and one way in, no chip.
    func testFirstLaunchWelcome() {
        let app = launch("firstLaunch")
        XCTAssertTrue(app.staticTexts["Bienvenue"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Choisis un programme pour ta première séance."].exists)
        XCTAssertTrue(app.buttons["Choisir un programme"].exists, "one blue button")
        XCTAssertFalse(element(app, "chip.session").exists, "the welcome has no chip")
        app.buttons["Choisir un programme"].tap()
        XCTAssertTrue(app.navigationBars["Programme actif"].waitForExistence(timeout: 5), "it opens the sheet")
    }

    /// At midnight, with the app on screen, a day done turns into the next session's day.
    func testMidnightTurnsDoneIntoNext() {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        let app = launch("doneToday", now: "\(formatter.string(from: .now))T23:59:50")
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 10))
        XCTAssertEqual(chip.label, "Faite aujourd’hui", "done, before midnight")
        let next = app.buttons["Voir la séance"]
        XCTAssertTrue(next.waitForExistence(timeout: 30), "past midnight the next session shows")
        XCTAssertEqual(chip.label, "La prochaine")
        XCTAssertTrue(app.staticTexts["Séance B"].exists, "B comes after A")
    }

    /// At AX3 the letter stays on one line inside the card, the button is whole, and the done
    /// tiles never cover one another.
    func testAx3NoCutNoOverlap() {
        let app = launch("fresh", largestText: true)
        XCTAssertTrue(app.buttons["settings"].waitForExistence(timeout: 10))
        let button = app.buttons["Voir la séance"]
        XCTAssertTrue(app.swipeUpUntil(button), "the button can be reached")
        let window = app.windows.firstMatch.frame
        let letter = app.staticTexts["Séance A"]
        XCTAssertTrue(letter.exists)
        XCTAssertLessThanOrEqual(letter.frame.maxX, window.maxX - 16, "the letter stays inside the card")
        XCTAssertLessThan(letter.frame.height, 120, "on one line: \(letter.frame)")
        XCTAssertGreaterThanOrEqual(button.frame.height, 44)
        XCTAssertGreaterThanOrEqual(button.frame.minX, window.minX, "the button is whole")
        XCTAssertLessThanOrEqual(button.frame.maxX, window.maxX, "the button is whole")

        let done = launch("doneToday", largestText: true)
        XCTAssertTrue(done.buttons["settings"].waitForExistence(timeout: 10))
        let tiles = ["done.duration", "done.sets", "done.effort"].map { element(done, $0) }
        XCTAssertTrue(done.swipeUpUntil(tiles[2]), "the tiles can be reached")
        for (i, a) in tiles.enumerated() {
            XCTAssertLessThanOrEqual(a.frame.maxX, window.maxX, "\(a.identifier) is whole")
            for b in tiles[(i + 1)...] {
                XCTAssertFalse(a.frame.intersects(b.frame), "\(a.identifier) and \(b.identifier) overlap")
            }
        }
    }

    /// Once Accueil scrolls, no compact title and no bar: the content runs under the status bar,
    /// only the avatar's glass stays.
    func testNoBarOnScroll() {
        let app = launch("fresh", largestText: true)
        XCTAssertTrue(app.buttons["settings"].waitForExistence(timeout: 10))
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.exists)
        let bar = app.navigationBars.firstMatch
        let letter = app.staticTexts["Séance A"]
        // Slowly, a little at a time, until the card's letter reaches the bar.
        for _ in 0..<6 where letter.exists && letter.frame.minY >= bar.frame.maxY {
            app.swipeUp(velocity: .slow)
        }
        let compact = bar.staticTexts.matching(NSPredicate(format: "label == %@", "Bonjour Ada"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(compact, "no compact title")
        XCTAssertTrue(app.buttons["settings"].isHittable, "the avatar stays")
        XCTAssertTrue(letter.exists)
        XCTAssertLessThan(letter.frame.minY, bar.frame.maxY, "the card runs under the bar: \(letter.frame) \(bar.frame)")
    }
}
