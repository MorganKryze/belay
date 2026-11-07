import XCTest

/// The session cover on a fixture account whose last session A logged the bench press at 62,5 kg
/// for 8, 8, 7 and 6, with a new session A open: tick a set, rest, finish.
@MainActor
final class SessionFlowTests: XCTestCase {
    /// `history` opens the store described above, `keep` the one the previous launch left.
    private func launch(_ fixture: String, large: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if large {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launch()
        return app
    }

    /// Accueil's Reprendre opens the cover.
    private func openCover(_ app: XCUIApplication) {
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        XCTAssertTrue(app.buttons["tick"].waitForExistence(timeout: 5), "the cover shows the next set")
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// How many set changes of the open session the queue holds, as the fixture reports it.
    private func queuedSets(_ app: XCUIApplication) -> String? {
        element(app, "fixture-queue").value as? String
    }

    /// One tap on the next set's tick records what was prefilled, with the RIR already chosen.
    private func tickFirstSet(_ app: XCUIApplication) {
        app.buttons["tick"].tap()
    }

    /// Seconds on a « m:ss » clock.
    private func seconds(_ clock: String) -> Int? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? parts[0] * 60 + parts[1] : nil
    }

    func testOneTapLogsPrefilled() {
        let app = launch("history")
        openCover(app)
        XCTAssertEqual(app.textFields["load-kg"].value as? String, "62,5", "last time's load")
        XCTAssertEqual(app.textFields["load-count"].value as? String, "8", "and last time's count")
        XCTAssertEqual(queuedSets(app), "0", "nothing is queued for this session yet")
        // The RIR is under the next set before any tap, the plan's low target chosen.
        let picker = app.segmentedControls.firstMatch
        XCTAssertTrue(picker.exists, "the RIR is shown under the next set")
        XCTAssertTrue(picker.buttons["1"].isSelected, "the plan's RIR 1–2 starts on 1")

        app.buttons["tick"].tap()
        XCTAssertFalse(app.buttons["rir-confirm"].exists, "no second step")
        let row = element(app, "set-0-3")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertTrue(row.label.contains("faite"), "the row shows done: \(row.label)")
        XCTAssertTrue(row.label.contains("62,5"), "with the load: \(row.label)")
        XCTAssertEqual(queuedSets(app), "1", "the set is stored and queued once")
        XCTAssertTrue(app.textFields["load-kg"].exists, "the next set comes up")
    }

    func testTickSurvivesRelaunch() {
        var app = launch("history")
        openCover(app)
        tickFirstSet(app)
        XCTAssertTrue(element(app, "set-0-3").label.contains("faite"))

        app.terminate()
        app = launch("keep")
        openCover(app)
        let row = element(app, "set-0-3")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertTrue(row.label.contains("faite"), "the set is still done: \(row.label)")
        XCTAssertEqual(queuedSets(app), "1", "and queued once")
    }

    func testRestCountsToAbsoluteEnd() throws {
        let app = launch("history")
        openCover(app)
        tickFirstSet(app)
        let clock = element(app, "rest-clock")
        XCTAssertTrue(clock.waitForExistence(timeout: 3), "the rest starts")
        let first = try XCTUnwrap(seconds(clock.label), "a clock: \(clock.label)")
        let read = Date.now
        // The bench press rests 150 s; a second or two goes by before the label is read.
        XCTAssertTrue((140...150).contains(first), "the rule's rest: \(first) s")

        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 20)
        app.activate()
        XCTAssertTrue(clock.waitForExistence(timeout: 5))
        let later = try XCTUnwrap(seconds(clock.label), "a clock: \(clock.label)")
        // The 20 s away plus what going and coming back took, read on the test's own clock.
        let away = Int(Date.now.timeIntervalSince(read).rounded())
        XCTAssertGreaterThanOrEqual(away, 20)
        XCTAssertTrue((first - away - 3...first - away + 2).contains(later), "\(away) s less: \(first) then \(later)")
    }

    func testFinishShowsSummary() {
        let app = launch("history")
        openCover(app)
        tickFirstSet(app)
        app.buttons["Terminer"].tap()
        let save = app.buttons["Terminer et enregistrer"]
        XCTAssertTrue(save.waitForExistence(timeout: 3), "Terminer asks first")
        // The web's words: what is kept, what is not, and that the program stays as it is.
        let message = "1 série notée sur 19. Les 18 séries non cochées ne seront pas enregistrées\u{202F}; ton programme ne change pas."
        XCTAssertTrue(app.staticTexts[message].exists, "the dialog says what is kept: \(app.staticTexts.allElementsBoundByIndex.map(\.label))")
        save.tap()

        XCTAssertTrue(element(app, "summary-close").waitForExistence(timeout: 5), "the summary shows")
        XCTAssertTrue(
            app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Séance terminée")).firstMatch.exists,
            "saying the session is done: \(app.navigationBars.debugDescription)")
        let sets = element(app, "summary-sets")
        XCTAssertTrue(sets.label.contains("1"), "one set done: \(sets.label)")
        XCTAssertTrue(app.staticTexts["Barbell bench press"].exists, "what was logged")
        app.buttons["Fermer"].tap()
        XCTAssertTrue(app.buttons["Voir la séance"].waitForExistence(timeout: 5), "the session is ended")
    }

    /// Wet hands on the narrowest phone: every RIR segment is a 44 pt target at the default size.
    func testRIRSegmentsAreTargets() {
        let app = launch("history")
        openCover(app)
        let picker = app.segmentedControls.firstMatch
        XCTAssertTrue(picker.waitForExistence(timeout: 3), "the RIR is under the next set")
        let segments = picker.buttons.allElementsBoundByIndex
        XCTAssertEqual(segments.count, 5)
        for segment in segments {
            let frame = segment.frame
            XCTAssertGreaterThanOrEqual(frame.width, 44, "segment \(segment.label) is \(frame.size)")
            XCTAssertGreaterThanOrEqual(frame.height, 44, "segment \(segment.label) is \(frame.size)")
        }
    }

    /// The whole load box is the target: a tap on its « kg » or « reps » line focuses its field.
    func testLoadBoxFocusesItsField() {
        let app = launch("history")
        openCover(app)
        for id in ["load-kg", "load-count"] {
            let field = app.textFields[id]
            // The unit line sits under the figure, 30 pt below the field's middle.
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).withOffset(CGVector(dx: 0, dy: 30)).tap()
            let focused = NSPredicate(format: "hasKeyboardFocus == true")
            XCTAssertEqual(
                XCTWaiter.wait(for: [expectation(for: focused, evaluatedWith: field)], timeout: 3), .completed,
                "a tap on the unit line of \(id) focuses it")
        }
    }

    /// « +30 s » moves the rest's end 30 s later and « Passer » ends it, each a 44 pt target.
    func testRestMovesAndSkips() throws {
        let app = launch("history")
        openCover(app)
        tickFirstSet(app)
        let clock = element(app, "rest-clock")
        XCTAssertTrue(clock.waitForExistence(timeout: 3), "the rest starts")
        let more = app.buttons["rest-more"]
        let skip = app.buttons["rest-skip"]
        XCTAssertTrue(more.exists && skip.exists, "the rest row offers +30 s and Passer")
        XCTAssertEqual(more.label, "+30\u{202F}s")
        XCTAssertEqual(skip.label, "Passer")
        for button in [more, skip] {
            XCTAssertGreaterThanOrEqual(button.frame.width, 44, "\(button.label) is \(button.frame.size)")
            XCTAssertGreaterThanOrEqual(button.frame.height, 44, "\(button.label) is \(button.frame.size)")
        }

        let before = try XCTUnwrap(seconds(clock.label), "a clock: \(clock.label)")
        more.tap()
        let moved = NSPredicate { _, _ in (self.seconds(clock.label) ?? 0) >= before + 25 }
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation(for: moved, evaluatedWith: nil)], timeout: 3), .completed,
            "30 s more: \(before) then \(clock.label)")

        skip.tap()
        let gone = NSPredicate(format: "exists == false")
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation(for: gone, evaluatedWith: clock)], timeout: 3), .completed,
            "Passer ends the rest")
        app.terminate()
        let again = launch("keep")
        openCover(again)
        XCTAssertFalse(element(again, "rest-clock").waitForExistence(timeout: 2), "the rest stays ended: it was stored")
    }

    func testVoiceOverLabels() {
        let app = launch("history")
        openCover(app)
        let next = element(app, "set-0-3").label
        for part in ["Barbell bench press", "série 1 sur 4", "62,5 kg", "8 répétitions", "à faire"] {
            XCTAssertTrue(next.contains(part), "the next set reads \(part): \(next)")
        }
        let later = element(app, "set-0-4").label
        for part in ["Barbell bench press", "série 2 sur 4", "62,5 kg", "8 répétitions", "à faire"] {
            XCTAssertTrue(later.contains(part), "a later set reads \(part): \(later)")
        }
        tickFirstSet(app)
        let done = element(app, "set-0-3")
        XCTAssertTrue(done.waitForExistence(timeout: 3))
        for part in ["Barbell bench press", "série 1 sur 4", "62,5 kg", "8 répétitions", "faite"] {
            XCTAssertTrue(done.label.contains(part), "a done set reads \(part): \(done.label)")
        }
    }

    /// The foot says what it logs, and logs it in the one tap the row's tick takes.
    func testFootSaysWhatItLogs() {
        let app = launch("history")
        openCover(app)
        let foot = app.buttons["foot"]
        XCTAssertEqual(foot.label, "Valider la série 1 · 62,5\u{202F}kg × 8")
        foot.tap()
        let row = element(app, "set-0-3")
        XCTAssertTrue(row.label.contains("faite"), "one tap logs the set: \(row.label)")
        XCTAssertEqual(queuedSets(app), "1", "stored and queued once")
        XCTAssertEqual(foot.label, "Valider la série 2 · 62,5\u{202F}kg × 8", "the foot moves to the next set")
    }

    /// At the largest sizes the row above holds the values; the foot keeps the set alone.
    func testFootLeavesValuesOutAtAccessibilitySizes() {
        let app = launch("history", large: true)
        openCover(app)
        XCTAssertEqual(app.buttons["foot"].label, "Valider la série 1")
    }

    /// A set with no history shows a dash in its empty load, never the field's spoken label.
    func testEmptyLoadShowsADash() {
        let app = launch("running")
        openCover(app)
        let kg = app.textFields["load-kg"]
        XCTAssertEqual(kg.placeholderValue, "–", "a dash, not « Charge de la série 1, kg »")
        XCTAssertEqual(kg.label, "Charge de la série 1, kg", "VoiceOver still hears what the field is")
        XCTAssertFalse((app.textFields["load-count"].value as? String ?? "").isEmpty, "the count is prefilled")
    }

    /// The next set and its RIR take the prototype's 165 pt from « Série 1 sur 4 » to the hairline
    /// of the row after, whose own label sits 26 pt lower in its 52 pt row of boxes: 191 pt, as
    /// measured on both. Armed with its « Noter » pill, the block took 74 pt more.
    func testNextSetBlockKeepsItsHeight() {
        let app = launch("history")
        openCover(app)
        let next = element(app, "set-0-3").frame
        let rir = app.segmentedControls.firstMatch.frame
        let after = element(app, "set-0-4").frame
        XCTAssertTrue(next.maxY < rir.minY && rir.maxY < after.minY, "the RIR sits under the next set: \(next) \(rir) \(after)")
        XCTAssertLessThanOrEqual(after.minY - next.minY, 192, "next set \(next), the one after \(after)")
    }

    /// The sets after the next are boxes holding what is offered, and their own tick logs them.
    func testComingSetsAreEditableBoxes() {
        let app = launch("history")
        openCover(app)
        XCTAssertEqual(app.textFields["kg-0-4"].value as? String, "62,5", "set 2 offers last time's load")
        XCTAssertEqual(app.textFields["count-0-4"].value as? String, "8", "and its count")
        XCTAssertEqual(app.textFields["kg-0-4"].label, "Charge de la série 2, kg")
        app.buttons["tick-0-4"].tap()
        let row = element(app, "set-0-4")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertTrue(row.label.contains("faite"), "set 2 is logged from its own row: \(row.label)")
        XCTAssertEqual(queuedSets(app), "1")
    }

    /// The navigation bar's bottom edge: the exercise up next is held right under it.
    private func barBottom(_ app: XCUIApplication) -> CGFloat {
        app.navigationBars.firstMatch.frame.maxY
    }

    /// The exercise up next opens anchored under the bar, its header a button that folds it.
    func testExerciseHeaderFoldsAndIsAnchored() {
        let app = launch("history")
        openCover(app)
        let header = app.buttons["exercise-0"]
        XCTAssertTrue(header.exists, "the exercise's header is a button")
        XCTAssertLessThanOrEqual(header.frame.minY - barBottom(app), 24, "anchored under the bar: \(header.frame)")
        XCTAssertEqual(header.value as? String, "ouvert")
        XCTAssertEqual(app.buttons["exercise-1"].value as? String, "replié", "the others start folded")

        header.tap()
        XCTAssertEqual(header.value as? String, "replié")
        XCTAssertFalse(app.buttons["tick"].exists, "folded, its sets are hidden")
        XCTAssertTrue(header.label.contains("4 × 6–8 · à venir"), "with where it stands: \(header.label)")
        header.tap()
        XCTAssertTrue(app.buttons["tick"].waitForExistence(timeout: 2), "open again")
    }

    /// An exercise whose four sets are done folds with its count, and the next one takes the top.
    func testDoneExerciseFoldsAndTheNextTakesTheTop() {
        let app = launch("history")
        openCover(app)
        let foot = app.buttons["foot"]
        for _ in 0..<4 { foot.tap() }
        let done = app.buttons["exercise-0"]
        let folded = NSPredicate(format: "value == 'replié'")
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation(for: folded, evaluatedWith: done)], timeout: 3), .completed,
            "the done exercise folds")
        XCTAssertTrue(done.label.contains("4 séries notées"), "saying so: \(done.label)")
        let next = app.buttons["exercise-1"]
        XCTAssertEqual(next.value as? String, "ouvert", "the next exercise opens")
        let anchored = NSPredicate { _, _ in abs(next.frame.minY - self.barBottom(app)) <= 24 }
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation(for: anchored, evaluatedWith: nil)], timeout: 3), .completed,
            "and is anchored under the bar: \(next.frame), bar \(barBottom(app))")
    }

    /// At the largest sizes the next set takes the middle of the screen, the header above it.
    func testNextSetTakesTheMiddleAtAccessibilitySizes() {
        let app = launch("history", large: true)
        openCover(app)
        let window = app.windows.firstMatch.frame
        let centred = { (id: String) in
            NSPredicate { _, _ in abs(app.buttons[id].frame.midY - window.midY) <= window.height * 0.2 }
        }
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation(for: centred("tick"), evaluatedWith: nil)], timeout: 3), .completed,
            "the next set's tick near the middle: \(app.buttons["tick"].frame) in \(window)")
    }

    /// « Supprimer la séance… » in Terminer's dialog, drawn from its button, asks again, then the
    /// session is gone and stays gone.
    func testDeleteRemovesTheSession() {
        let app = launch("history")
        openCover(app)
        tickFirstSet(app)
        app.buttons["Terminer"].tap()
        let ask = app.buttons["Supprimer la séance…"]
        XCTAssertTrue(ask.waitForExistence(timeout: 3), "Terminer offers the delete")
        let window = app.windows.firstMatch.frame
        XCTAssertLessThan(ask.frame.midY, window.midY, "the dialog comes from its button at the top: \(ask.frame)")
        ask.tap()
        let confirm = app.buttons["Supprimer la séance"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 3), "asked again before anything goes")
        let message = "La série notée ne sera pas gardée\u{202F}; ton programme ne change pas."
        XCTAssertTrue(app.staticTexts[message].exists, "saying what goes: \(app.staticTexts.allElementsBoundByIndex.map(\.label))")
        confirm.tap()
        XCTAssertTrue(app.buttons["Commencer"].waitForExistence(timeout: 5), "the session is gone")
        app.terminate()
        let again = launch("keep")
        XCTAssertTrue(again.buttons["Commencer"].waitForExistence(timeout: 10), "and stays gone: it was stored")
    }
}
