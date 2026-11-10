import XCTest

extension XCUIApplication {
    /// Ends the open session the way the cover offers once everything is noted: each set due is
    /// logged as prefilled and each rest skipped until 🏁 shows, then 🏁 opens the summary. One
    /// query finds whichever control the foot holds, so a whole session takes a minute or two; the
    /// deadline only stops a cover that never reaches 🏁.
    func finishSession(file: StaticString = #filePath, line: UInt = #line) {
        let finish = buttons["foot-finish"]
        let ids = ["foot-finish", "log-set", "skip-rest", "foot-skip", "foot-play", "foot-stop"]
        let control = descendants(matching: .any).matching(NSPredicate(format: "identifier IN %@", ids)).firstMatch
        let deadline = Date.now.addingTimeInterval(300)
        while Date.now < deadline {
            guard control.waitForExistence(timeout: 3) else { continue }
            if control.identifier == "foot-finish" { break }
            control.tap()
        }
        XCTAssertTrue(finish.exists, "🏁 shows once everything is noted", file: file, line: line)
        finish.tap()
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
