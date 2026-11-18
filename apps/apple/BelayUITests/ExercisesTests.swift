import XCTest

/// Séances › Exercices, the exercise page it opens, and the loop the fixture's instance serves.
@MainActor
final class ExercisesTests: XCTestCase {
    /// Séances › Exercices once the fixture has signed in.
    private func exercices(
        _ fixture: String = "fresh", reduceMotion: Bool = false, english: Bool = false
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            english
            ? ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-BelayFixture", fixture]
            : ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if reduceMotion { app.launchArguments += ["-BelayReduceMotion", "YES"] }
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

    /// A46: a spinner in the square while the loop comes, then it plays.
    func testLoopLoadingThenPlays() {
        let app = fromPreview()
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, chargement", timeout: 2))
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, en lecture", timeout: 10))
        XCTAssertTrue(app.buttons["Mettre en pause"].exists)
    }

    /// A session kept from before the instance served loops learns at launch that it does now.
    func testKeptSessionLearnsLoopsAtLaunch() {
        let app = exercices("mediaStale")
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(
            loop.comesToRead("Démonstration de Barbell bench press, en lecture", timeout: 30), "reads \(loop.label)")
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

    /// With Reduce Motion the first frame holds until play is tapped.
    func testReduceMotionHoldsFirstFrame() {
        let app = exercices(reduceMotion: true)
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, en pause", timeout: 10))
        let play = app.buttons["Lire la démonstration"]
        XCTAssertTrue(play.exists)
        play.tap()
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, en lecture"))
    }

    /// A50: the loop says the exercise and its state; its button says what it does.
    func testLoopLabelSaysState() {
        let app = exercices()
        _ = page(app, "ds:0025", search: "barbell bench press")
        let loop = element(app, "loop")
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, en lecture", timeout: 10))
        let pause = app.buttons["Mettre en pause"]
        XCTAssertGreaterThanOrEqual(pause.frame.height, 44)
        pause.tap()
        XCTAssertTrue(loop.comesToRead("Démonstration de Barbell bench press, en pause"))
        XCTAssertTrue(app.buttons["Lire la démonstration"].exists)
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
            element(app, "loop").comesToRead("Démonstration de Barbell bench press, en lecture", timeout: 20))
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
    }
}
