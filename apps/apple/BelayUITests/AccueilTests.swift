import XCTest

/// Accueil's session card on a fixture account that stores no program: the starting program's
/// first session comes next, starts, and is still open after a relaunch.
@MainActor
final class AccueilTests: XCTestCase {
    /// `fresh` opens an empty store, `keep` the one the previous launch left.
    private func launch(_ fixture: String, largestText: Bool = false, increasedContrast: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
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
        let shot = app.screenshot().image
        guard let image = shot.cgImage else {
            XCTFail("the screenshot has no bitmap")
            return 0
        }
        let scale = shot.scale
        let box = CGRect(x: 16 * scale, y: 70 * scale, width: 80 * scale, height: 20 * scale).integral
        guard let crop = image.cropping(to: box) else {
            XCTFail("the sample falls off the screen")
            return 0
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
        var red = 0, blue = 0
        for pixel in stride(from: 0, to: pixels.count, by: 4) {
            red += Int(pixels[pixel])
            blue += Int(pixels[pixel + 2])
        }
        return (blue - red) / (width * height)
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
}
