import XCTest

/// Séances › Exercices, the exercise page it opens, and the loop the fixture's instance serves.
@MainActor
final class ExercisesTests: XCTestCase {
    /// Séances › Exercices once the fixture has signed in.
    private func exercices(
        _ fixture: String = "fresh", english: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            english
            ? ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-BelayFixture", fixture]
            : ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        app.launchFixture()
        let tab = app.tabBars.firstMatch.buttons[english ? "Sessions" : "Séances"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        let segment = app.segmentedControls.firstMatch.buttons[english ? "Exercises" : "Exercices"]
        XCTAssertTrue(segment.waitForExistence(timeout: 5))
        segment.tap()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func search(_ app: XCUIApplication, _ text: String) {
        let field = app.searchFields.firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        field.typeText(text)
    }

    /// The page of `id`, opened from Exercices' list.
    private func page(_ app: XCUIApplication, _ id: String, search text: String) -> XCUIElement {
        search(app, text)
        let row = element(app, "exercise.\(id)")
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.tap()
        let name = element(app, "exercise-name")
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        return name
    }

    /// A44: the third segment lists the program's exercises with their session's letter first, then
    /// the library; each row is one element of 52 pt or more.
    func testSegmentProgramThenAll() {
        let app = exercices()
        XCTAssertEqual(app.segmentedControls.firstMatch.buttons.count, 3)
        XCTAssertTrue(app.staticTexts["Dans ton programme"].waitForExistence(timeout: 5))
        let bench = element(app, "exercise.ds:0025")
        XCTAssertTrue(bench.exists)
        XCTAssertEqual(bench.label, "Barbell bench press, Pectoraux · Barre, séance A")
        XCTAssertGreaterThanOrEqual(bench.frame.height, 52)
        let benchTop = bench.frame.minY
        let all = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Tous · '")).firstMatch
        XCTAssertTrue(app.swipeUpUntil(all), "the whole library after the program")
        XCTAssertGreaterThan(all.frame.minY, benchTop)
    }

    /// While searching the count heads the list; nothing found shows the system's empty search.
    func testSearchCountsAndEmptyState() {
        let app = exercices()
        search(app, "bench incline barbell")
        XCTAssertTrue(app.staticTexts["4 exercices"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Dans ton programme"].exists)
        app.searchFields.firstMatch.typeText(" zzz")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Aucun résultat'")).firstMatch
            .waitForExistence(timeout: 5), "the system's empty search")
    }

    /// The Muscle and Matériel menus narrow the list together, each saying its choice.
    func testFiltersByMuscleAndEquipment() {
        let app = exercices()
        let muscle = app.buttons["filter-muscle"]
        XCTAssertTrue(muscle.waitForExistence(timeout: 5))
        XCTAssertGreaterThanOrEqual(muscle.frame.height, 44)
        muscle.tap()
        app.buttons["Mollets"].firstMatch.tap()
        XCTAssertTrue(muscle.comesToRead("Muscle\u{202F}: Mollets"))
        XCTAssertTrue(app.staticTexts["59 exercices"].waitForExistence(timeout: 5))
        let equipment = app.buttons["filter-equipment"]
        equipment.tap()
        app.buttons["Machine"].firstMatch.tap()
        XCTAssertTrue(equipment.comesToRead("Matériel\u{202F}: Machine"))
        XCTAssertTrue(app.staticTexts["21 exercices"].waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "exercise.ds:0605").exists, "Lever standing calf raise")
    }

    /// A45: the name, the loop, the muscles in words, the program's sessions with sets, RIR and rest
    /// (each opening its preview), then how to do it and the credit.
    func testPageSectionsInOrder() {
        let app = exercices()
        let name = page(app, "ds:0025", search: "barbell bench press")
        XCTAssertEqual(name.label, "Barbell bench press")
        XCTAssertTrue(app.staticTexts["Barre · incrément 2,5\u{202F}kg"].exists)
        let loop = element(app, "loop")
        XCTAssertTrue(loop.exists)
        XCTAssertGreaterThan(loop.frame.minY, name.frame.minY)
        XCTAssertEqual(loop.frame.width, loop.frame.height, accuracy: 1, "a square")
        let primary = app.staticTexts["Pectoraux"]
        XCTAssertTrue(app.swipeUpUntil(primary))
        XCTAssertTrue(app.staticTexts["Triceps, Épaules avant"].exists, "the secondary muscles in words")
        let session = element(app, "uses.A")
        XCTAssertTrue(app.swipeUpUntil(session))
        XCTAssertEqual(session.label, "Séance A, 4 × 6–8 · RIR 1–2 · repos 2\u{202F}min\u{202F}30")
        XCTAssertGreaterThan(session.frame.minY, primary.frame.minY)
        let step = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Allonge-toi à plat'")).firstMatch
        XCTAssertTrue(app.swipeUpUntil(step), "the steps in French")
        let credit = app.staticTexts["Texte\u{202F}: exercises-dataset (MIT)"]
        XCTAssertTrue(app.swipeUpUntil(credit))
        XCTAssertGreaterThan(credit.frame.minY, step.frame.minY)
        app.swipeDown()
        app.swipeDown()
        XCTAssertTrue(app.swipeUpUntil(session))
        session.tap()
        XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5), "the session's preview")
    }

    /// In English the steps are the English ones.
    func testStepsInTheAppsLanguage() {
        let app = exercices(english: true)
        _ = page(app, "ds:0025", search: "barbell bench press")
        let step = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH 'Lie flat'")).firstMatch
        XCTAssertTrue(app.swipeUpUntil(step), "the steps in English")
    }

    /// A session preview's exercise opens its page.
    func testOpenedFromPreview() {
        let app = fromPreview()
        XCTAssertEqual(element(app, "exercise-name").label, "Barbell bench press")
    }

    /// The bench press's page opened from Séance A's preview, where no row's thumbnail has asked
    /// for its loop first.
    private func fromPreview() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", "fresh"]
        app.launchFixture()
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        let bench = element(app, "plan.ds:0025")
        XCTAssertTrue(bench.waitForExistence(timeout: 5))
        bench.tap()
        XCTAssertTrue(element(app, "exercise-name").waitForExistence(timeout: 5))
        return app
    }

    /// A spinner in the square while the loop comes, then its first frame, still, with a play button.
    func testLoopLoadingThenRestsOnFirstFrame() {
        let app = fromPreview()
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, chargement", timeout: 2))
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 10))
        XCTAssertTrue(app.buttons["Lire la démonstration"].exists)
        Thread.sleep(forTimeInterval: 1)
        XCTAssertEqual(loop.label, "Démonstration de Barbell bench press, prête", "it never plays by itself")
        XCTAssertFalse(app.buttons["Mettre en pause"].exists)
    }

    /// A session kept from before the instance served loops learns at launch that it does now.
    func testKeptSessionLearnsLoopsAtLaunch() {
        let app = exercices("mediaStale")
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(
            loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 30), "reads \(loop.label)")
    }

    /// A kept loop scrolled off the page and back shows its frame again, never a spinner for good.
    func testKeptLoopShowsAfterScrollingBack() {
        let app = exercices()
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 30))
        let credit = app.staticTexts["Texte\u{202F}: exercises-dataset (MIT)"]
        XCTAssertTrue(app.swipeUpUntil(credit))
        XCTAssertFalse(loop.exists && loop.isHittable, "the loop left the screen")
        let play = app.buttons["Lire la démonstration"]
        for _ in 0..<6 where !(loop.exists && loop.isHittable) { app.swipeDown() }
        XCTAssertTrue(
            loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 10), "reads \(loop.label)")
        XCTAssertTrue(play.exists)
        XCTAssertFalse(app.activityIndicators.firstMatch.exists, "no spinner")
    }

    /// The instance not answering keeps the spinner.
    func testLoopStillLoading() {
        let app = exercices("loopLoading")
        _ = page(app, "ds:0025", search: "barbell bench press")
        XCTAssertTrue(app.activityIndicators.firstMatch.waitForExistence(timeout: 3))
        XCTAssertFalse(app.buttons["Mettre en pause"].exists)
    }

    /// After a failure the stand-in shows, and the loop is not asked for again in that visit.
    func testLoopFailedShowsStandIn() {
        let app = exercices("loopFailed")
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, indisponible", timeout: 10))
        app.navigationBars.buttons.firstMatch.tap()
        element(app, "exercise.ds:0025").tap()
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, indisponible", timeout: 5))
        XCTAssertFalse(app.activityIndicators.firstMatch.exists)
        XCTAssertEqual(element(app, "loop-asked").value as? String, "1", "one request in the visit")
    }

    /// Play runs the clip once from its start, then the first frame rests with the play button again.
    func testLoopPlaysOnceThenRests() {
        let app = exercices()
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 10))
        app.buttons["Lire la démonstration"].tap()
        XCTAssertEqual(loop.label, "Démonstration de Barbell bench press, en lecture")
        XCTAssertTrue(app.buttons["Mettre en pause"].exists)
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 10), "reads \(loop.label)")
        XCTAssertTrue(app.buttons["Lire la démonstration"].exists)
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(loop.label, "Démonstration de Barbell bench press, prête", "played once, not again")
    }

    /// The loop says the exercise and its state; its button says what it does. Pause stops the
    /// clip; play starts it again from its start.
    func testLoopLabelSaysState() {
        let app = exercices()
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 10))
        let play = app.buttons["Lire la démonstration"]
        XCTAssertGreaterThanOrEqual(play.frame.height, 44)
        play.tap()
        let pause = app.buttons["Mettre en pause"]
        // The fixture's clip lasts two seconds: pause it at once.
        pause.tap()
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, en pause"), "reads \(loop.label)")
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(loop.label, "Démonstration de Barbell bench press, en pause", "pause stops it")
        play.tap()
        XCTAssertEqual(loop.label, "Démonstration de Barbell bench press, en lecture", "playing again")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 10), "reads \(loop.label)")
    }

    /// Réglages' sign-out, confirmed, then the sign-in again on the same fixture instance.
    private func signOutAndBack(_ app: XCUIApplication) {
        app.tab("Accueil")
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let signOut = app.buttons["signout"]
        XCTAssertTrue(app.swipeUpUntil(signOut), "Réglages offers to sign out")
        signOut.tap()
        let sure = app.buttons["signout-confirm"].firstMatch
        XCTAssertTrue(sure.waitForExistence(timeout: 3))
        sure.tap()
        let submit = app.buttons["signin-submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5), "signed out")
        submit.tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 10), "signed in again")
    }

    private func comesToValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval) -> Bool {
        let met = expectation(for: NSPredicate(format: "value == %@", value), evaluatedWith: element)
        return XCTWaiter.wait(for: [met], timeout: timeout) == .completed
    }

    /// A46: the loops kept for the account go at its sign-out.
    func testKeptLoopsGoAtSignOut() {
        let app = exercices()
        _ = page(app, "ds:0025", search: "barbell bench press")
        let kept = element(app, "loops-kept")
        let landed = expectation(for: NSPredicate(format: "value != '0'"), evaluatedWith: kept)
        XCTAssertEqual(XCTWaiter.wait(for: [landed], timeout: 30), .completed, "the loop is kept")
        signOutAndBack(app)
        XCTAssertTrue(kept.waitForExistence(timeout: 5))
        XCTAssertEqual(kept.value as? String, "0", "signed in again, no loop is left from before")
    }

    /// A row's thumbnail drawn before a sign-out is not shown from memory after it: signed in again,
    /// the row asks the instance anew.
    func testThumbnailsGoAtSignOut() {
        let app = exercices()
        _ = page(app, "ds:0025", search: "barbell bench press")
        XCTAssertTrue(
            element(app, "loop").comesToRead("Démonstration de Barbell bench press, prête", timeout: 20))
        let asked = element(app, "loop-asked")
        XCTAssertEqual(asked.value as? String, "1", "the row and the page asked once")
        // Time for the row below the page to draw its first frame from the loop.
        Thread.sleep(forTimeInterval: 2)
        signOutAndBack(app)
        let tab = app.tabBars.firstMatch.buttons["Séances"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        let segment = app.segmentedControls.firstMatch.buttons["Exercices"]
        XCTAssertTrue(segment.waitForExistence(timeout: 5))
        segment.tap()
        search(app, "barbell bench press")
        XCTAssertTrue(element(app, "exercise.ds:0025").waitForExistence(timeout: 5))
        XCTAssertTrue(comesToValue(asked, "2", timeout: 10), "asked again: \(asked.value ?? "none")")
    }

    /// A48: the page opens on its name in the page; once scrolled no title stands in the bar, and
    /// the back button stays.
    func testNoCompactTitle() {
        let app = exercices()
        let name = page(app, "ds:0025", search: "barbell bench press")
        XCTAssertTrue(name.isHittable)
        XCTAssertGreaterThan(name.frame.minY, app.navigationBars.firstMatch.frame.minY)
        app.swipeUp()
        let inBar = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == 'Barbell bench press'"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(inBar, "no compact title once scrolled")
        XCTAssertTrue(app.navigationBars.buttons.firstMatch.isHittable, "the back button stays")
    }


    /// A46: a loop the player cannot read shows the stand-in, never a blank square.
    func testUnreadableLoopShowsStandIn() {
        let app = exercices("loopBroken")
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, indisponible", timeout: 15))
        XCTAssertFalse(app.buttons["Mettre en pause"].exists)
        XCTAssertFalse(app.buttons["Lire la démonstration"].exists)
    }

    // MARK: The figure

    private typealias RGB = (r: Int, g: Int, b: Int)

    /// The figure's shades as the web gives them, light then dark: the primary muscles, the
    /// secondary ones, the muscles at rest.
    private static let shades: [(primary: RGB, secondary: RGB, rest: RGB)] = [
        ((0x12, 0x18, 0x1C), (0x8E, 0x9A, 0xA1), (0xD5, 0xDB, 0xDD)),
        ((0xEE, 0xF2, 0xF3), (0x6F, 0x7D, 0x86), (0x2E, 0x3A, 0x43)),
    ]

    /// How many of the screen's pixels inside `rect`, in points, sit near each colour.
    private func counts(_ app: XCUIApplication, in rect: CGRect, near colors: [RGB]) -> [Int] {
        let shot = app.screenshot().image
        let scaled = rect.applying(.init(scaleX: shot.scale, y: shot.scale)).integral
        guard let crop = shot.cgImage?.cropping(to: scaled) else {
            XCTFail("the sample falls off the screen")
            return colors.map { _ in 0 }
        }
        let width = crop.width, height = crop.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        pixels.withUnsafeMutableBytes { bytes in
            let context = CGContext(
                data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
            context?.draw(crop, in: CGRect(x: 0, y: 0, width: width, height: height))
        }
        var found = colors.map { _ in 0 }
        for pixel in stride(from: 0, to: pixels.count, by: 4) {
            let (r, g, b) = (Int(pixels[pixel]), Int(pixels[pixel + 1]), Int(pixels[pixel + 2]))
            for (index, c) in colors.enumerated()
            where abs(r - c.r) <= 10 && abs(g - c.g) <= 10 && abs(b - c.b) <= 10 {
                found[index] += 1
            }
        }
        return found
    }

    /// The figure's pixels inside `rect` in the theme the screen shows: the one with the most
    /// muscles at rest.
    private func shades(_ app: XCUIApplication, in rect: CGRect) -> (primary: Int, secondary: Int, rest: Int) {
        Self.shades.map { palette in
            let found = counts(app, in: rect, near: [palette.primary, palette.secondary, palette.rest])
            return (found[0], found[1], found[2])
        }.max { $0.rest < $1.rest } ?? (0, 0, 0)
    }

    /// Scrolls the page by a short drag until both elements are on screen.
    private func reveal(_ app: XCUIApplication, _ top: XCUIElement, _ bottom: XCUIElement) -> Bool {
        let middle = app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
        for _ in 0..<12 {
            let topShown = top.exists && top.isHittable, bottomShown = bottom.exists && bottom.isHittable
            if topShown && bottomShown { return true }
            let by: CGFloat = bottomShown ? 140 : -140
            middle.press(forDuration: 0.05, thenDragTo: middle.withOffset(CGVector(dx: 0, dy: by)))
        }
        return top.isHittable && bottom.isHittable
    }

    /// The bench press's page scrolled to « Muscles », and the band between its header and the
    /// words, where the figure stands.
    private func muscles(_ app: XCUIApplication) -> CGRect {
        _ = page(app, "ds:0025", search: "barbell bench press")
        let header = app.staticTexts["Muscles"]
        let primary = app.staticTexts["Principal"]
        XCTAssertTrue(reveal(app, header, primary), "« Muscles » and its words on screen")
        // The upper part of the band: the figures without their captions below.
        let top = header.frame.maxY + 8
        return CGRect(x: 0, y: top, width: app.frame.width, height: (primary.frame.minY - top) * 0.8)
    }

    /// The front and the back side by side, the primary muscle in full on the front only, the
    /// secondary ones lighter on both, and the muscles named in words below.
    func testMusclesShowFrontAndBackWithWords() {
        let app = exercices()
        let band = muscles(app)
        XCTAssertGreaterThan(band.height, 150, "room for the figure")
        let (left, right) = band.divided(atDistance: band.width / 2, from: .minXEdge)
        let front = shades(app, in: left), back = shades(app, in: right)
        XCTAssertGreaterThan(front.rest, 500, "the front drawn: \(front)")
        XCTAssertGreaterThan(back.rest, 500, "the back drawn: \(back)")
        XCTAssertGreaterThan(front.primary, 150, "the chest in full, on the front: \(front)")
        XCTAssertLessThan(back.primary, 20, "no chest on the back: \(back)")
        XCTAssertGreaterThan(front.secondary, 150, "the front deltoids lighter: \(front)")
        XCTAssertGreaterThan(back.secondary, 150, "the triceps lighter, from the back: \(back)")
        XCTAssertTrue(app.staticTexts["Principal"].exists)
        XCTAssertTrue(app.staticTexts["Pectoraux"].exists)
        XCTAssertTrue(app.staticTexts["Secondaires"].exists)
        XCTAssertTrue(app.staticTexts["Triceps, Épaules avant"].exists)
    }

    /// VoiceOver reads the words, not the figure: the figure's band holds no image, no control and
    /// no words but its two captions. The tree a test reads also lists what VoiceOver skips, so
    /// the captions stay in it; the skipping itself is heard on the phone.
    func testFigureHiddenFromVoiceOver() {
        let app = exercices()
        let band = muscles(app).insetBy(dx: 40, dy: 0)
        let inBand = app.descendants(matching: .any).allElementsBoundByIndex.filter { element in
            let frame = element.frame
            guard band.contains(CGPoint(x: frame.midX, y: frame.midY)), frame.width < band.width else { return false }
            return [.image, .button, .staticText].contains(element.elementType)
                && !["De face", "De dos"].contains(element.label)
        }
        XCTAssertTrue(inBand.isEmpty, "elements in the figure: \(inBand.map(\.label))")
    }

    /// The loop still waits for a tap: shown at rest, it plays only once play is tapped.
    func testLoopStillPlaysOnTapOnly() {
        let app = exercices()
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, prête", timeout: 10))
        Thread.sleep(forTimeInterval: 3)
        XCTAssertEqual(loop.label, "Démonstration de Barbell bench press, prête", "it never plays by itself")
        app.buttons["Lire la démonstration"].tap()
        XCTAssertEqual(loop.label, "Démonstration de Barbell bench press, en lecture")
    }
}
