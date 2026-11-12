import XCTest

/// Séances' Historique segment and a past session opened from it: its figures, its sets, their
/// corrections and its deletion.
@MainActor
final class SeancesHistoryTests: XCTestCase {
    /// A Wednesday evening: the fixture's weeks then end on Monday 5 to Wednesday 7 October, every
    /// session of the day already kept.
    private static let wednesday = "2026-10-07T20:00:00"

    private func launch(_ fixture: String, now: String? = nil, largestText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if let now { app.launchArguments += ["-BelayNow", now] }
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launchFixture()
        return app
    }

    /// Séances' Historique, once the fixture has signed in.
    private func history(_ fixture: String, now: String? = nil, largestText: Bool = false) -> XCUIApplication {
        let app = launch(fixture, now: now, largestText: largestText)
        let tab = app.tabBars.firstMatch.buttons["Séances"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        let segment = app.segmentedControls.firstMatch.buttons["Historique"]
        XCTAssertTrue(segment.waitForExistence(timeout: 5))
        segment.tap()
        return app
    }

    /// The newest session of the history opened.
    private func past(_ fixture: String = "pastSession", now: String? = nil, largestText: Bool = false) -> XCUIApplication {
        let app = history(fixture, now: now, largestText: largestText)
        let row = rows(app).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5), "the session kept is listed")
        row.tap()
        XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5), "its letter is the title")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func rows(_ app: XCUIApplication) -> XCUIElementQuery {
        app.descendants(matching: .any).matching(identifier: "history.row")
    }

    private func sets(_ app: XCUIApplication) -> [String] {
        app.descendants(matching: .any).matching(identifier: "past.set").allElementsBoundByIndex.map(\.label)
    }

    /// The past-session changes waiting in the queue: « removed=1 sets=0 ».
    private func queued(_ app: XCUIApplication) -> String {
        (element(app, "fixture-history").value as? String) ?? ""
    }

    private func type(_ value: String, into field: XCUIElement) {
        // A tap left the cursor before the figure, where the deletes clear nothing (« 98 » for 9,
        // twice in a row): once the field has the focus, a double tap selects the figure, and the typing
        // replaces it.
        field.tap()
        field.doubleTap()
        field.typeText(value)
    }

    /// Newest first, by week: this week's three, then the week before with its five, each header
    /// with its count and length.
    func testWeeksNewestFirst() {
        let app = history("weeks", now: Self.wednesday)
        XCTAssertTrue(app.staticTexts["Cette semaine"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["3 séances · 3\u{202F}h\u{202F}12\u{202F}min"].exists, "three of 64 minutes")
        let first = rows(app).element(boundBy: 0)
        XCTAssertTrue(first.label.hasPrefix("Séance C, Mercredi 7 octobre"), first.label)
        XCTAssertTrue(first.label.contains("1\u{202F}h\u{202F}4\u{202F}min · "), "its length and volume: \(first.label)")
        XCTAssertTrue(rows(app).element(boundBy: 2).label.contains("Lundi 5 octobre"))
        let before = app.staticTexts["28 sept. – 4 oct."]
        XCTAssertTrue(app.swipeUpUntil(before), "the week before follows")
        XCTAssertTrue(app.staticTexts["5 séances · 5\u{202F}h\u{202F}20\u{202F}min"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["month-calendar"].exists, "no month calendar")
    }

    /// The effort shows only on the sessions this phone holds one for, with no dash elsewhere.
    func testEffortOnlyWhenHeld() {
        let app = history("weeks", now: Self.wednesday)
        let third = rows(app).element(boundBy: 2)
        XCTAssertTrue(third.waitForExistence(timeout: 5))
        XCTAssertTrue(third.label.hasSuffix("Soutenu"), "an effort of 3 is held: \(third.label)")
        let first = rows(app).element(boundBy: 0).label
        for word in ["Facile", "Modéré", "Soutenu", "Difficile", "Maximal", "–", "—"] {
            XCTAssertFalse(first.contains(word), "none held, nothing shown: \(first)")
        }
    }

    func testEmptyHistory() {
        let app = history("fresh")
        XCTAssertTrue(app.staticTexts["Aucune séance"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Tes séances faites apparaîtront ici, semaine par semaine."].exists)
        XCTAssertFalse(rows(app).firstMatch.exists)
    }

    /// At the largest sizes the week's count goes under its name and a row stays one element of
    /// 44 pt at least.
    func testAx3Rows() {
        let app = history("weeks", now: Self.wednesday, largestText: true)
        let name = app.staticTexts["Cette semaine"]
        XCTAssertTrue(name.waitForExistence(timeout: 5))
        let count = app.staticTexts["3 séances · 3\u{202F}h\u{202F}12\u{202F}min"]
        XCTAssertGreaterThanOrEqual(count.frame.minY, name.frame.maxY - 1, "the count under the week")
        let row = rows(app).firstMatch
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertTrue(row.label.contains("Mercredi 7 octobre"), row.label)
        // The tile, the day, the name and the figures stacked: far taller than one line.
        XCTAssertGreaterThan(row.frame.height, 160, "the figures stack: \(row.frame)")
    }

    /// The title, its day and hour, the tiles, the sets by exercise, the deletion at the foot.
    func testPastSessionTilesAndSets() {
        let app = past()
        let bar = app.navigationBars["Séance A"]
        XCTAssertGreaterThan(bar.frame.height, 80, "a large title, not a compact bar: \(bar.frame)")
        XCTAssertEqual(element(app, "past.duration").label, "Durée, 1\u{202F}h\u{202F}4\u{202F}min")
        XCTAssertEqual(element(app, "past.sets").label, "Séries, 6")
        XCTAssertTrue(element(app, "past.volume").label.hasPrefix("Volume, 2\u{202F}51"), element(app, "past.volume").label)
        XCTAssertEqual(element(app, "past.effort").label, "Effort, Soutenu")
        XCTAssertEqual(
            Array(sets(app).prefix(4)),
            ["Montée, 40\u{202F}kg × 8", "Série 1, 62,5\u{202F}kg × 8", "Série 2, 62,5\u{202F}kg × 7", "Série 3, 62,5\u{202F}kg × 6"])
        let delete = app.buttons["Supprimer la séance"]
        XCTAssertTrue(app.swipeUpUntil(delete), "the deletion at the foot")
        XCTAssertGreaterThanOrEqual(delete.frame.height, 44)
    }

    /// Under the letter, the session's name, then its day and hour.
    func testPastSessionNameAndDay() {
        let app = past(now: Self.wednesday)
        let name = app.staticTexts["Pectoraux et dos"]
        XCTAssertTrue(name.exists, "its name under the letter")
        let when = app.staticTexts["Mardi 6 octobre · 20:00"]
        XCTAssertTrue(when.exists, "its day and hour")
        XCTAssertGreaterThan(when.frame.minY, name.frame.minY, "the day under the name")
    }

    /// The name sits right under the letter, as the bar's subtitle would, at the default size.
    func testPastSessionLinesCloseUnderTitle() {
        let app = past()
        let name = app.staticTexts["Pectoraux et dos"]
        XCTAssertTrue(name.exists)
        let gap = app.gapUnderTitle("Séance A", to: name)
        XCTAssertLessThan(gap, 18, "the name close under the title: \(gap) pt")
    }

    /// The deletion asks in a bubble at the button, then the history goes on without it, its
    /// removal queued once.
    func testDeleteAsksThenLeavesHistory() {
        let app = past()
        let delete = app.buttons["Supprimer la séance"]
        XCTAssertTrue(app.swipeUpUntil(delete))
        delete.tap()
        XCTAssertTrue(app.staticTexts["Supprimer cette séance\u{202F}?"].waitForExistence(timeout: 3), "it asks first")
        let confirm = app.buttons["Supprimer"]
        XCTAssertTrue(confirm.exists, "one red action")
        XCTAssertLessThan(abs(confirm.frame.midY - delete.frame.midY), 260, "anchored to the button")
        confirm.tap()
        XCTAssertTrue(app.navigationBars["Séances"].waitForExistence(timeout: 5), "back to the history")
        XCTAssertTrue(app.staticTexts["Aucune séance"].waitForExistence(timeout: 5), "without it")
        XCTAssertEqual(queued(app), "removed=1 sets=0", "one removal, queued once")
    }

    /// « Modifier » makes the sets open the correction sheet until « OK »: a count changed reads
    /// back on its row, a set removed leaves the list, each one change queued.
    func testModifyOpensCorrectionSheet() {
        let app = past()
        let first = app.descendants(matching: .any).matching(identifier: "past.set").element(boundBy: 1)
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        first.tap()
        XCTAssertFalse(element(app, "correct-count").waitForExistence(timeout: 1), "read only until « Modifier »")
        app.navigationBars.buttons["Modifier"].tap()
        first.tap()
        let count = element(app, "correct-count")
        XCTAssertTrue(count.waitForExistence(timeout: 3), "the correction sheet opens")
        XCTAssertTrue(app.staticTexts["Série 1"].exists, "for that set")
        type("9", into: count.textFields.firstMatch)
        app.buttons["correct-save"].tap()
        XCTAssertTrue(
            first.waitFor(NSPredicate(format: "label == %@", "Série 1, 62,5\u{202F}kg × 9")), "the row reads 9: \(first.label)")
        XCTAssertEqual(queued(app), "removed=0 sets=1", "one values change")
        first.tap()
        let remove = element(app, "correct-remove")
        XCTAssertTrue(remove.waitForExistence(timeout: 3))
        remove.tap()
        let confirm = app.buttons["Supprimer"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 3), "it asks first")
        confirm.tap()
        XCTAssertTrue(app.descendants(matching: .any)["correct-count"].waitForNonExistence(timeout: 3))
        XCTAssertTrue(
            first.waitFor(NSPredicate(format: "label == %@", "Série 1, 62,5\u{202F}kg × 7")),
            "the next set takes its rank: \(first.label)")
        XCTAssertEqual(queued(app), "removed=0 sets=2", "and one removal")
        app.navigationBars.buttons["OK"].tap()
        first.tap()
        XCTAssertFalse(element(app, "correct-count").waitForExistence(timeout: 1), "read only again after « OK »")
    }

    /// A lone warm-up is « Montée » on its row, as its sheet's title and in its removal's question.
    func testLoneWarmupNamedAsItsRow() {
        let app = past()
        let warmup = app.descendants(matching: .any).matching(identifier: "past.set").element(boundBy: 0)
        XCTAssertTrue(warmup.waitForExistence(timeout: 5))
        XCTAssertEqual(warmup.label, "Montée, 40\u{202F}kg × 8")
        app.navigationBars.buttons["Modifier"].tap()
        warmup.tap()
        XCTAssertTrue(app.staticTexts["Montée"].waitForExistence(timeout: 3), "the sheet names it as its row")
        element(app, "correct-remove").tap()
        XCTAssertTrue(
            app.staticTexts["Supprimer la montée\u{202F}?"].waitForExistence(timeout: 3), "and so does the question")
    }

    /// Once the history scrolls, no compact title.
    func testHistoryNoBarOnScroll() {
        let app = history("weeks", now: Self.wednesday, largestText: true)
        XCTAssertTrue(rows(app).firstMatch.waitForExistence(timeout: 5))
        app.swipeUp(velocity: .slow)
        app.swipeUp(velocity: .slow)
        let compact = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == %@", "Séances"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(compact, "no compact title")
    }

    /// Once a past session scrolls, no compact title.
    func testNoBarOnScroll() {
        let app = past(largestText: true)
        app.swipeUp(velocity: .slow)
        app.swipeUp(velocity: .slow)
        let compact = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == %@", "Séance A"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(compact, "no compact title")
        XCTAssertTrue(app.navigationBars.buttons["Modifier"].isHittable, "the glass button stays")
    }
}
