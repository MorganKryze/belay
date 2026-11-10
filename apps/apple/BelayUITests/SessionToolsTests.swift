import XCTest

/// The session's tools on the fixture account: a timed hold, the correction and removal of a done
/// set, and the programme with one menu of actions per exercise and the same actions by a swipe,
/// the picker and the note.
@MainActor
final class SessionToolsTests: XCTestCase {
    private static let ax3 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityL"]

    private func launch(_ fixture: String, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture] + extra
        app.launchFixture()
        let resume = app.buttons["Reprendre"]
        // The full fixture writes thirty exercises before the first frame.
        XCTAssertTrue(resume.waitForExistence(timeout: 30), "the session is open")
        resume.tap()
        XCTAssertTrue(element(app, "session-clock").waitForExistence(timeout: 5), "the cover shows")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func text(_ app: XCUIApplication, containing part: String) -> XCUIElement {
        app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    private func queuedSets(_ app: XCUIApplication) -> Int? {
        (element(app, "fixture-queue").value as? String).flatMap(Int.init)
    }

    /// The seconds left on the hold's ring.
    private func ringLeft(_ app: XCUIApplication) -> Int? {
        (element(app, "hold-ring").value as? String)?.split(separator: " ").first.flatMap { Int($0) }
    }

    /// The header's « Exercice n sur N » opens the programme; N.
    @discardableResult
    private func openProgramme(_ app: XCUIApplication) -> Int {
        let header = app.buttons.matching(NSPredicate(format: "label ENDSWITH %@", "voir le programme")).firstMatch
        XCTAssertTrue(header.waitForExistence(timeout: 5), "the card's header shows")
        let count = header.label.split(separator: ",").first?.split(separator: " ").last.flatMap { Int($0) } ?? 0
        header.tap()
        XCTAssertTrue(app.buttons["programme-close"].waitForExistence(timeout: 5), "the programme opens")
        return count
    }

    /// The programme's control, scrolled to.
    private func reach(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        let control = element(app, id)
        XCTAssertTrue(app.swipeUpUntil(control), "\(id) is reached")
        return control
    }

    /// Opens the exercise's menu in the programme and picks the action labelled `action`.
    private func pick(_ action: String, for slot: Int, in app: XCUIApplication, line: UInt = #line) {
        reach(app, "actions-\(slot)").tap()
        let item = app.buttons[action].firstMatch
        XCTAssertTrue(item.waitForExistence(timeout: 3), "the menu offers « \(action) »", line: line)
        item.tap()
    }

    /// The first row of the exercise's sets in the programme.
    private func firstRow(_ app: XCUIApplication, slot: Int) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "programme-row-\(slot)-"))
            .firstMatch
    }

    /// Replaces the field's text by `value`.
    private func type(_ value: String, into field: XCUIElement) {
        field.tap()
        if let current = field.value as? String, !current.isEmpty {
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count + 2))
        }
        field.typeText(value)
    }

    // MARK: The hold

    func testHoldRunsAndWaitsForCheck() {
        let app = launch("timed")
        let title = element(app, "set-title")
        XCTAssertTrue(title.label.hasSuffix("· tenue"), "a timed set: \(title.label)")
        XCTAssertTrue(element(app, "hold-figure").exists, "the target is the main figure")
        app.buttons["foot-play"].tap()
        XCTAssertTrue(element(app, "hold-ring").waitForExistence(timeout: 3), "the ring runs")
        let first = ringLeft(app)
        sleep(2)
        let later = ringLeft(app)
        XCTAssertNotNil(first)
        XCTAssertTrue((later ?? 0) < (first ?? 0), "the ring counts down: \(String(describing: first)) then \(String(describing: later))")
        app.buttons["foot-stop"].tap()
        let held = text(app, containing: "s tenues")
        XCTAssertTrue(held.waitForExistence(timeout: 3), "the seconds held show")
        // The hold waits for ✓, it never logs itself.
        sleep(2)
        XCTAssertFalse(element(app, "done-0-3").exists, "nothing is logged before ✓")
        element(app, "log-set").tap()
        XCTAssertTrue(element(app, "done-0-3").waitForExistence(timeout: 3), "✓ logs the hold")
    }

    func testStopRightAfterPlay() {
        let app = launch("timed")
        app.buttons["foot-play"].tap()
        // At once, while the foot's glass still morphs from play into ■: the tap stops the hold.
        app.buttons["foot-stop"].tap()
        XCTAssertTrue(text(app, containing: "s tenues").waitForExistence(timeout: 3), "the hold stops")
    }

    func testHoldSurvivesRelaunch() {
        var app = launch("timed")
        app.buttons["foot-play"].tap()
        XCTAssertTrue(element(app, "hold-ring").waitForExistence(timeout: 3))
        let before = ringLeft(app) ?? 0
        let stopped = Date.now
        app.terminate()
        app = launch("keep")
        XCTAssertTrue(element(app, "hold-ring").waitForExistence(timeout: 5), "the hold still runs")
        let gone = Int(Date.now.timeIntervalSince(stopped).rounded())
        let after = ringLeft(app) ?? 0
        XCTAssertLessThan(after, before, "the time went on while the app was gone")
        XCTAssertLessThanOrEqual(abs(before - gone - after), 2, "read from the absolute end: \(before) − \(gone) ≈ \(after)")
    }

    // MARK: Correct and remove

    func testCorrectFieldsAre44pt() {
        let app = launch("lockLogged")
        element(app, "done-0-3").tap()
        for id in ["correct-kg", "correct-count"] {
            let field = element(app, id)
            XCTAssertTrue(field.waitForExistence(timeout: 3), "\(id) shows")
            XCTAssertGreaterThanOrEqual(field.frame.height, 44, "\(id) is \(field.frame.height) pt high")
        }
    }

    func testCorrectWritesOnce() {
        let app = launch("lockLogged")
        let queued = queuedSets(app)
        element(app, "done-0-3").tap()
        let save = app.buttons["correct-save"]
        XCTAssertTrue(save.waitForExistence(timeout: 3))
        XCTAssertFalse(save.isEnabled, "✓ waits for a change")
        type("7", into: element(app, "correct-count").textFields.firstMatch)
        XCTAssertTrue(save.isEnabled, "✓ turns on once a value changes")
        save.tap()
        let row = element(app, "done-0-3")
        XCTAssertTrue(row.waitFor(NSPredicate(format: "label CONTAINS %@", "× 7")), "the row reads 7: \(row.label)")
        XCTAssertEqual(queuedSets(app), queued.map { $0 + 1 }, "one values change is queued")
    }

    func testRemoveAsksInBubble() {
        let app = launch("lockLogged")
        let queued = queuedSets(app)
        element(app, "done-0-3").tap()
        let remove = element(app, "correct-remove")
        XCTAssertTrue(remove.waitForExistence(timeout: 3))
        remove.tap()
        XCTAssertTrue(text(app, containing: "Supprimer la série 1").waitForExistence(timeout: 3), "it asks first")
        XCTAssertTrue(text(app, containing: "Elle redevient la prochaine à noter.").exists)
        let confirm = app.buttons["Supprimer"]
        XCTAssertTrue(confirm.exists, "one red action")
        // A bubble at the button, not a sheet of actions at the bottom of the screen.
        XCTAssertLessThan(abs(confirm.frame.midY - remove.frame.midY), 260, "anchored to « Supprimer la série »")
        confirm.tap()
        XCTAssertTrue(element(app, "done-0-3").waitForNonExistence(timeout: 3), "the set goes")
        XCTAssertEqual(queuedSets(app), queued.map { $0 + 1 }, "its removal is queued")
        element(app, "skip-rest").tap()
        XCTAssertTrue(element(app, "set-title").waitFor(NSPredicate(format: "label == %@", "Série 1 sur 4")), "it is due again")
    }

    func testSwipeRemovesOn27() throws {
        guard #available(iOS 27, *) else { throw XCTSkip("the swipe outside a list comes with iOS 27") }
        let app = launch("lockLogged")
        let row = element(app, "done-0-3")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        row.swipeLeft()
        let swiped = app.buttons["Supprimer"]
        XCTAssertTrue(swiped.waitForExistence(timeout: 3), "the swipe offers removal")
        swiped.tap()
        XCTAssertTrue(text(app, containing: "Elle redevient la prochaine à noter.").waitForExistence(timeout: 3), "it asks first")
        app.buttons.matching(NSPredicate(format: "label == %@", "Supprimer")).allElementsBoundByIndex.last?.tap()
        XCTAssertTrue(row.waitForNonExistence(timeout: 3), "the set goes")
    }

    // MARK: The programme

    func testProgrammeListsAll() {
        let app = launch("workSet")
        let count = openProgramme(app)
        XCTAssertGreaterThan(count, 1)
        for slot in 0..<count {
            reach(app, "programme-exercise-\(slot)")
        }
        let add = reach(app, "add-exercise")
        XCTAssertTrue(add.isHittable, "« + Exercice » closes the list")
        XCTAssertEqual(add.label, "Ajouter un exercice")
    }

    func testProgrammeMarksDoneAndNext() {
        let app = launch("workSet")
        openProgramme(app)
        XCTAssertEqual(reach(app, "programme-row-0-0").value as? String, "faite", "a warm-up done")
        XCTAssertEqual(reach(app, "programme-row-0-3").value as? String, "la prochaine", "the set up next")
        XCTAssertEqual(reach(app, "programme-row-0-4").value as? String, "à venir", "a set to come")
    }

    /// The programme, the picker and the note keep no title in their bar, before or after a
    /// scroll: the title sits at the top of the content, only ✕ and ✓ stay over it.
    func testSheetsShowNoBarTitle() {
        let app = launch("workSet")
        openProgramme(app)
        assertTitleInContent(app, "the programme", close: "programme-close")
        pick("Remplacer", for: 1, in: app)
        XCTAssertTrue(app.buttons["picker-close"].waitForExistence(timeout: 3), "the picker opens")
        assertTitleInContent(app, "the picker", close: "picker-close")
        app.buttons["picker-close"].tap()
        pick("Note", for: 0, in: app)
        XCTAssertTrue(app.buttons["note-close"].waitForExistence(timeout: 3), "the note opens")
        assertTitleInContent(app, "the note", close: "note-close")
    }

    /// The sheet's bar is the one holding its ✕.
    private func assertTitleInContent(_ app: XCUIApplication, _ sheet: String, close: String, line: UInt = #line) {
        let bars = app.navigationBars.containing(.button, identifier: close)
        XCTAssertTrue(bars.firstMatch.exists, "\(sheet): ✕ sits in its bar", line: line)
        XCTAssertFalse(
            bars.staticTexts.firstMatch.exists, "\(sheet): no title in the bar: \(bars.debugDescription)", line: line)
        let title = app.staticTexts["sheet-title"].firstMatch
        XCTAssertTrue(title.exists, "\(sheet): its title at the top of the content", line: line)
        XCTAssertFalse(bars.firstMatch.identifier == title.label, "\(sheet): no bar named after it", line: line)
        app.swipeUp()
        XCTAssertFalse(bars.staticTexts.firstMatch.exists, "\(sheet): none once scrolled either", line: line)
        app.swipeDown()
    }

    func testReplaceBySearch() {
        let app = launch("workSet")
        openProgramme(app)
        pick("Remplacer", for: 1, in: app)
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3), "the search is at the top")
        search.tap()
        search.typeText("dead hang")
        let pick = element(app, "pick-belay:dead-hang")
        XCTAssertTrue(pick.waitForExistence(timeout: 3), "the library is searched by name")
        pick.tap()
        XCTAssertTrue(
            element(app, "programme-exercise-1").waitFor(NSPredicate(format: "label CONTAINS %@", "Dead hang")),
            "one tap replaces it")
    }

    func testLeaveOutAndPutBack() {
        let app = launch("workSet")
        openProgramme(app)
        pick("Mettre de côté", for: 1, in: app)
        XCTAssertTrue(text(app, containing: "Mis de côté pour cette séance").waitForExistence(timeout: 3), "set aside")
        pick("Remettre", for: 1, in: app)
        XCTAssertTrue(text(app, containing: "Mis de côté pour cette séance").waitForNonExistence(timeout: 3), "put back")
    }

    func testAddExerciseAndFull() {
        var app = launch("workSet")
        let count = openProgramme(app)
        reach(app, "add-exercise").tap()
        let search = app.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 3))
        search.tap()
        search.typeText("hammer curl")
        let pick = element(app, "pick-ds:0313")
        XCTAssertTrue(pick.waitForExistence(timeout: 3))
        pick.tap()
        XCTAssertTrue(app.swipeUpUntil(element(app, "programme-exercise-\(count)")), "the exercise is appended")

        app.terminate()
        app = launch("full")
        openProgramme(app)
        let add = element(app, "add-exercise")
        XCTAssertTrue(app.swipeUpUntil(add, swipes: 30, velocity: .fast), "« + Exercice » closes the thirty")
        add.tap()
        XCTAssertTrue(text(app, containing: "au plus 30 exercices").waitForExistence(timeout: 3), "it says the session is full")
        XCTAssertFalse(app.searchFields.firstMatch.exists, "nothing to pick")
    }

    func testAddSetMarkedAdded() {
        let app = launch("workSet")
        openProgramme(app)
        pick("Ajouter une série", for: 0, in: app)
        let added = element(app, "programme-row-0-7")
        XCTAssertTrue(app.swipeUpUntil(added), "one set past the plan")
        XCTAssertTrue(added.label.contains("Série 5 · ajoutée"), "marked added: \(added.label)")
    }

    func testNoteCountAndIcon() {
        let app = launch("workSet")
        XCTAssertFalse(app.buttons["card-note"].exists, "no note yet")
        openProgramme(app)
        pick("Note", for: 0, in: app)
        let field = element(app, "note-field")
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.tap()
        field.typeText("Coude")
        XCTAssertEqual(element(app, "note-count").label, "5 sur 500 · gardée avec cette séance")
        app.buttons["note-save"].tap()
        app.buttons["programme-close"].tap()
        let icon = app.buttons["card-note"]
        XCTAssertTrue(icon.waitForExistence(timeout: 3), "the card shows the note's icon")
        icon.tap()
        XCTAssertTrue(element(app, "note-field").waitFor(NSPredicate(format: "value == %@", "Coude")), "it opens the note")
    }

    /// One menu per exercise, named for it, 44 pt at least, that says each action in words.
    func testMenuNamesItsActions() {
        let app = launch("workSet")
        openProgramme(app)
        let menu = reach(app, "actions-0")
        XCTAssertEqual(menu.label, "Actions pour Barbell bench press")
        XCTAssertGreaterThanOrEqual(menu.frame.width, 44, "\(menu.frame.width) pt wide")
        XCTAssertGreaterThanOrEqual(menu.frame.height, 44, "\(menu.frame.height) pt high")
        XCTAssertFalse(app.buttons["Remplacer"].exists, "no bare action beside the exercise")
        menu.tap()
        for action in ["Remplacer", "Mettre de côté", "Note", "Ajouter une série"] {
            XCTAssertTrue(app.buttons[action].waitForExistence(timeout: 3), "the menu offers « \(action) »")
        }
    }

    /// The rows offer the note from the leading edge, set aside and replace from the trailing one.
    func testRowsSwipeToActions() {
        let app = launch("workSet")
        openProgramme(app)
        let row = firstRow(app, slot: 1)
        XCTAssertTrue(app.swipeUpUntil(row), "the exercise's rows are reached")
        row.swipeRight()
        let note = app.buttons["Note"]
        XCTAssertTrue(note.waitForExistence(timeout: 3), "a swipe right offers the note")
        note.tap()
        XCTAssertTrue(app.buttons["note-close"].waitForExistence(timeout: 3), "the note opens")
        app.buttons["note-close"].tap()
        XCTAssertTrue(app.swipeUpUntil(row))
        row.swipeLeft()
        XCTAssertTrue(app.buttons["Remplacer"].waitForExistence(timeout: 3), "a swipe left offers to replace")
        let aside = app.buttons["Mettre de côté"]
        XCTAssertTrue(aside.exists, "and to set aside")
        aside.tap()
        XCTAssertTrue(text(app, containing: "Mis de côté pour cette séance").waitForExistence(timeout: 3), "set aside")
    }

    func testAx3Sheets() {
        let app = launch("lockLogged", extra: Self.ax3)
        let width = app.windows.firstMatch.frame.width
        // The reserve answered, the foot leaves the done rows free under the thumb.
        element(app, "rir-2").tap()
        XCTAssertTrue(element(app, "rir-2").waitForNonExistence(timeout: 4))
        XCTAssertTrue(app.swipeUpUntil(element(app, "done-0-3")))
        element(app, "done-0-3").tap()
        for id in ["correct-kg", "correct-count", "correct-rir-4", "correct-remove"] {
            let control = element(app, id)
            XCTAssertTrue(app.swipeUpUntil(control), "\(id) is reached at AX3")
            XCTAssertLessThanOrEqual(control.frame.maxX, width + 0.5, "\(id) fits the width")
            XCTAssertGreaterThanOrEqual(control.frame.height, 44, "\(id) keeps 44 pt")
        }
    }

    func testAx3Programme() {
        let app = launch("workSet", extra: Self.ax3)
        let width = app.windows.firstMatch.frame.width
        openProgramme(app)
        for id in ["programme-row-0-3", "actions-0"] {
            let control = element(app, id)
            XCTAssertTrue(app.swipeUpUntil(control), "\(id) is reached at AX3")
            XCTAssertLessThanOrEqual(control.frame.maxX, width + 0.5, "\(id) fits the width")
        }
    }
}

extension XCUIApplication {
    /// Scrolls up until the element is on screen and hittable, `swipes` at most.
    @discardableResult
    func swipeUpUntil(_ target: XCUIElement, swipes: Int = 8, velocity: XCUIGestureVelocity = .slow) -> Bool {
        for _ in 0..<swipes {
            if target.exists && target.isHittable { return true }
            swipeUp(velocity: velocity)
        }
        return target.exists && target.isHittable
    }
}
