import XCTest

/// Séances' Programme segment and the preview it opens for any session, on the fixture's days.
@MainActor
final class SeancesProgrammeTests: XCTestCase {
    private func launch(_ fixture: String, largestText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launchFixture()
        return app
    }

    /// Opens the Séances tab once the fixture has signed in.
    private func seances(_ fixture: String, largestText: Bool = false) -> XCUIApplication {
        let app = launch(fixture, largestText: largestText)
        let tab = app.tabBars.firstMatch.buttons["Séances"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        XCTAssertTrue(app.navigationBars["Séances"].waitForExistence(timeout: 5), "the tab is titled Séances")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id]
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }


    /// Today's place in the week, Monday 0.
    private var today: Int { (Calendar.current.component(.weekday, from: .now) + 5) % 7 }

    /// A large title and two segments; the one chosen stays across a tab switch.
    func testSegmentsAndTitle() {
        let app = seances("fresh")
        let segments = app.segmentedControls.firstMatch
        XCTAssertTrue(segments.waitForExistence(timeout: 5))
        XCTAssertEqual(segments.buttons.count, 2, "Programme and Historique, no Exercices yet")
        XCTAssertTrue(segments.buttons["Programme"].isSelected, "Programme first")
        XCTAssertFalse(text(app, containing: "sur le web pour l’instant").exists, "no longer on the web")
        segments.buttons["Historique"].tap()
        app.tabBars.firstMatch.buttons["Accueil"].tap()
        XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 5))
        app.tabBars.firstMatch.buttons["Séances"].tap()
        XCTAssertTrue(segments.waitForExistence(timeout: 5))
        XCTAssertTrue(segments.buttons["Historique"].isSelected, "the segment chosen stays")
    }

    /// On a fixed week, seven days Monday first, each read as its day and what it holds.
    func testWeekStripReadsDays() {
        let app = seances("fixedWeek")
        XCTAssertTrue(app.staticTexts["Ta semaine"].waitForExistence(timeout: 5))
        let days = (0..<7).map { element(app, "week.\($0)") }
        XCTAssertTrue(days.allSatisfy(\.exists), "seven days")
        XCTAssertLessThan(days[0].frame.minX, days[6].frame.minX, "Monday first")
        XCTAssertEqual(days[today].label, "\(frenchWeekday(0).capitalized), aujourd’hui, séance A", "today circled and named")
        XCTAssertEqual(days[(today + 1) % 7].label, "\(frenchWeekday(1).capitalized), repos")
        XCTAssertEqual(days[(today + 2) % 7].label, "\(frenchWeekday(2).capitalized), séance B")
        XCTAssertTrue(app.staticTexts["3 séances et 4 jours de repos par semaine."].exists, "the week in words")
        let rhythm = element(app, "rhythm")
        XCTAssertTrue(app.swipeUpUntil(rhythm))
        XCTAssertEqual(rhythm.label, "Rythme, 3 séances par semaine")
    }

    /// A rotation has no days: no week, and the rhythm says the rotation in words.
    func testNoWeekInRotation() {
        let app = seances("fresh")
        XCTAssertTrue(element(app, "session.A").waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["Ta semaine"].exists, "no week in rotation")
        XCTAssertFalse(element(app, "week.0").exists)
        let rhythm = element(app, "rhythm")
        XCTAssertTrue(app.swipeUpUntil(rhythm))
        XCTAssertEqual(rhythm.label, "Rythme, A, B, C à la suite")
        XCTAssertTrue(app.staticTexts["Les exercices du programme se modifient sur ordinateur."].exists)
    }

    /// One mark at most per session row, as the day stands; a tap opens the session's preview and
    /// a long press offers it.
    func testSessionMarks() {
        let marks: [(String, [String: String])] = [
            ("fresh", ["A": "La prochaine", "B": "", "C": ""]),
            ("doneToday", ["A": "Faite aujourd’hui", "B": "La prochaine", "C": ""]),
            ("restDay", ["A": "Demain", "B": "", "C": ""]),
            // Under way, A is open and B follows it.
            ("workSet", ["A": "En cours", "B": "La prochaine", "C": ""]),
        ]
        for (fixture, expected) in marks {
            let app = seances(fixture)
            for (code, mark) in expected {
                let row = element(app, "session.\(code)")
                XCTAssertTrue(row.waitForExistence(timeout: 5), "\(fixture): row \(code)")
                XCTAssertEqual(row.value as? String ?? "", mark, "\(fixture): session \(code)'s mark")
            }
            app.terminate()
        }
        let app = seances("fresh")
        XCTAssertTrue(app.staticTexts["Programme de départ"].exists, "the list is titled with the program")
        let b = element(app, "session.B")
        XCTAssertTrue(b.label.hasPrefix("Séance B"), b.label)
        b.tap()
        XCTAssertTrue(app.navigationBars["Séance B"].waitForExistence(timeout: 5), "a tap opens its preview")
        app.navigationBars.buttons.firstMatch.tap()
        let c = element(app, "session.C")
        XCTAssertTrue(c.waitForExistence(timeout: 5))
        c.press(forDuration: 1.2)
        let peek = app.buttons["Voir la séance"]
        XCTAssertTrue(peek.waitForExistence(timeout: 5), "a long press offers the session")
        peek.tap()
        XCTAssertTrue(app.navigationBars["Séance C"].waitForExistence(timeout: 5), "and opens it")
    }

    /// « Programme actif » names the program and opens the sheet, the active one ticked; the
    /// rhythm row opens nothing.
    func testActiveProgramRowOpensSheet() {
        let app = seances("fixedWeek")
        XCTAssertTrue(app.staticTexts["Haut / Bas"].waitForExistence(timeout: 5), "the sessions under the program's name")
        let row = element(app, "programme-active")
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertEqual(row.label, "Programme actif, Haut / Bas · 3 séances")
        row.tap()
        XCTAssertTrue(app.sheetTitle("Programme actif").waitForExistence(timeout: 5), "the sheet opens")
        let program = element(app, "program.00000000-0000-7000-8000-0000000000f0")
        XCTAssertTrue(program.isSelected, "the active one ticked")
        program.tap()
        XCTAssertTrue(app.sheetTitle("Programme actif").waitForNonExistence(timeout: 5), "a tap closes it")
        XCTAssertEqual(
            element(app, "fixture-active").value as? String,
            "active=00000000-0000-7000-8000-0000000000f0 queued=0", "the active one is left as it is")
    }

    /// No program active: the segment says so and chooses one through the sheet, then shows it.
    func testNoProgramCard() {
        let app = seances("noProgram")
        let chip = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Aucun programme"))
            .firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 5), "the segment says no program is active")
        XCTAssertTrue(app.staticTexts["Un programme range tes séances A, B, C et tes jours de repos."].exists)
        XCTAssertFalse(element(app, "programme-active").exists)
        let choose = element(app, "seances-choose")
        XCTAssertEqual(choose.label, "Choisir un programme")
        choose.tap()
        XCTAssertTrue(app.sheetTitle("Programme actif").waitForExistence(timeout: 5), "the sheet opens")
        element(app, "program.00000000-0000-7000-8000-0000000000f0").tap()
        XCTAssertTrue(element(app, "session.A").waitForExistence(timeout: 5), "the program's sessions show")
        XCTAssertTrue(app.staticTexts["Haut / Bas"].exists)
        XCTAssertEqual(
            element(app, "fixture-active").value as? String,
            "active=00000000-0000-7000-8000-0000000000f0 queued=1", "one change, queued once")
    }

    /// Any session opens to its preview: the letter, the size with its sets, the last time when
    /// there is one, the exercises, and the start at the foot.
    func testPreviewAnySessionAndLastTime() {
        let app = seances("past")
        let c = element(app, "session.C")
        XCTAssertTrue(c.waitForExistence(timeout: 5))
        c.tap()
        let bar = app.navigationBars["Séance C"]
        XCTAssertTrue(bar.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(bar.frame.height, 80, "a large title, not a compact bar: \(bar.frame)")
        XCTAssertTrue(text(app, containing: " séries · environ ").exists, "its size, its sets and its time")
        let last = element(app, "preview-last")
        XCTAssertTrue(last.exists, "C was done once")
        XCTAssertTrue(last.label.hasPrefix("La dernière fois\u{202F}: "), last.label)
        XCTAssertTrue(last.label.hasSuffix(", 1\u{202F}h"), "its day and its length: \(last.label)")
        XCTAssertFalse(element(app, "preview-running").exists, "nothing is open")
        XCTAssertTrue(app.buttons["Commencer la séance"].exists, "the start at the foot")
        XCTAssertTrue(app.swipeUpUntil(app.staticTexts["Le programme se modifie sur ordinateur."]))

        let fresh = seances("fresh")
        element(fresh, "session.B").tap()
        let freshBar = fresh.navigationBars["Séance B"]
        XCTAssertTrue(freshBar.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(freshBar.frame.height, 80, "a large title, not a compact bar: \(freshBar.frame)")
        XCTAssertTrue(text(fresh, containing: " séries · environ ").exists, "its size line")
        XCTAssertFalse(element(fresh, "preview-last").exists, "a first time says nothing")
    }

    /// The size line sits right under the letter, as the bar's subtitle would, at the default size.
    func testPreviewLineCloseUnderTitle() {
        let app = seances("fresh")
        let b = element(app, "session.B")
        XCTAssertTrue(b.waitForExistence(timeout: 5))
        b.tap()
        XCTAssertTrue(app.navigationBars["Séance B"].waitForExistence(timeout: 5))
        let line = text(app, containing: " séries · environ ")
        XCTAssertTrue(line.exists)
        let gap = app.gapUnderTitle("Séance B", to: line)
        XCTAssertLessThan(gap, 18, "the size line close under the title: \(gap) pt")
        let indent = app.indentFromTitle("Séance B", to: line)
        XCTAssertEqual(indent, 0, accuracy: 1, "the size line starts under the letter: \(indent) pt")
    }

    /// With A open, B's preview says A is under way, and its foot takes A up rather than starting B.
    func testPreviewWhileOpenResumes() {
        let app = seances("workSet")
        let b = element(app, "session.B")
        XCTAssertTrue(b.waitForExistence(timeout: 5))
        b.tap()
        XCTAssertTrue(app.navigationBars["Séance B"].waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "preview-running").label, "Séance A est en cours.")
        XCTAssertFalse(app.buttons["Commencer la séance"].exists, "never a second session")
        let resume = app.buttons["Reprendre la séance"]
        XCTAssertTrue(resume.exists)
        resume.tap()
        let lower = app.buttons["Réduire la séance"]
        XCTAssertTrue(lower.waitForExistence(timeout: 5), "the open session shows")
        lower.tap()
        let accessory = app.buttons["resume-accessory"]
        XCTAssertTrue(accessory.waitForExistence(timeout: 5))
        XCTAssertTrue(accessory.label.contains("Séance A"), "A, not B: \(accessory.label)")
    }

    /// B started while A comes next counts for B: once done, Accueil names C as the next.
    func testStartOutOfTurn() {
        let app = seances("fresh")
        let b = element(app, "session.B")
        XCTAssertTrue(b.waitForExistence(timeout: 5))
        b.tap()
        let start = app.buttons["Commencer la séance"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        start.tap()
        XCTAssertTrue(app.buttons["log-set"].waitForExistence(timeout: 5), "the cover shows")
        XCTAssertTrue(app.navigationBars["Séance B"].exists, "B is the session started")
        app.buttons["log-set"].tap()
        app.finishSession(by: .stop)
        app.buttons["summary-close"].tap()
        app.tabBars.firstMatch.buttons["Accueil"].tap()
        let chip = element(app, "chip.session")
        XCTAssertTrue(chip.waitForExistence(timeout: 5))
        XCTAssertEqual(chip.label, "Faite aujourd’hui")
        XCTAssertTrue(app.staticTexts["Séance B"].exists, "B is the one done")
        XCTAssertEqual(element(app, "next-row").label, "La prochaine, Séance C", "the rotation goes on from B")
    }

    /// At AX3 the rows and their marks fit the width, and the week's marks stay capped.
    func testAx3Programme() {
        let app = seances("fixedWeek", largestText: true)
        let window = app.windows.firstMatch.frame
        let day = element(app, "week.0")
        XCTAssertTrue(day.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(day.frame.height, 90, "the week's marks are capped: \(day.frame)")
        XCTAssertLessThanOrEqual(element(app, "week.6").frame.maxX, window.maxX, "the week fits")
        let row = element(app, "session.A")
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertEqual(row.value as? String, "La prochaine", "the mark is read whole")
        XCTAssertLessThanOrEqual(row.frame.maxX, window.maxX, "the row fits the width")
        XCTAssertGreaterThan(row.frame.height, row.frame.width / 2, "the tile sits above the words: \(row.frame)")
        let active = element(app, "programme-active")
        XCTAssertTrue(app.swipeUpUntil(active))
        XCTAssertGreaterThanOrEqual(active.frame.height, 44)
    }

    /// Once Séances scrolls, no compact title and no bar.
    func testNoBarOnScroll() {
        let app = seances("fresh", largestText: true)
        app.swipeUp(velocity: .slow)
        app.swipeUp(velocity: .slow)
        let compact = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == %@", "Séances"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(compact, "no compact title")
    }

}
