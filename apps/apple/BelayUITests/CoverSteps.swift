import XCTest

/// How a test ends the open session: by 🏁 once everything is noted, or by ■ in the pause.
enum SessionEnd {
    case flag
    case stop
}

extension XCUIApplication {
    /// Ends the open session the way the cover offers, then waits for the summary. By `.flag`,
    /// each set due is logged as prefilled, each recap tapped and each rest skipped until 🏁 shows,
    /// then 🏁: on a fixture with everything noted that is one tap on the recap. One query finds
    /// whichever control the cover holds; the deadline only stops a cover that never reaches 🏁.
    /// By `.stop`, ⏸, then ■ and « Arrêter » in its alert, wherever the session stands.
    func finishSession(by end: SessionEnd = .flag, file: StaticString = #filePath, line: UInt = #line) {
        switch end {
        case .flag:
            let finish = buttons["foot-finish"]
            let ids = ["foot-finish", "log-set", "skip-rest", "foot-skip", "foot-play", "foot-stop", "exercise-recap"]
            let control = descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@", ids)).firstMatch
            let deadline = Date.now.addingTimeInterval(300)
            while Date.now < deadline {
                guard control.waitForExistence(timeout: 3) else { continue }
                if control.identifier == "foot-finish" { break }
                control.tap()
            }
            XCTAssertTrue(finish.exists, "🏁 shows once everything is noted", file: file, line: line)
            finish.tap()
        case .stop:
            buttons["Mettre la séance en pause"].tap()
            let stop = buttons["Arrêter la séance"]
            XCTAssertTrue(stop.waitForExistence(timeout: 3), "⏸ becomes ■", file: file, line: line)
            stop.tap()
            let alert = alerts.firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 3), "■ asks first", file: file, line: line)
            alert.buttons["Arrêter"].tap()
        }
        XCTAssertTrue(
            buttons["Enregistrer et fermer"].waitForExistence(timeout: 5), "the summary shows", file: file, line: line)
    }
}

extension XCUIElement {
    /// Whether the element meets the predicate within the timeout.
    func waitFor(_ predicate: NSPredicate, timeout: TimeInterval = 3) -> Bool {
        XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout)
            == .completed
    }
}
