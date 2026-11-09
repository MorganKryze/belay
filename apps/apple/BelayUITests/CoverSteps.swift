import XCTest

extension XCUIApplication {
    /// Ends the open session the way the cover offers once everything is noted: each set due is
    /// logged as prefilled and each rest skipped until 🏁 shows, then 🏁 opens the summary. The
    /// bound only stops a cover that never reaches 🏁.
    func finishSession(file: StaticString = #filePath, line: UInt = #line) {
        let finish = buttons["foot-finish"]
        for _ in 0..<120 {
            if finish.waitForExistence(timeout: 0.5) { break }
            for id in ["log-set", "skip-rest", "foot-skip", "foot-play", "foot-stop"] {
                let control = descendants(matching: .any)[id].firstMatch
                if control.exists, control.isHittable {
                    control.tap()
                    break
                }
            }
        }
        XCTAssertTrue(finish.exists, "🏁 shows once everything is noted", file: file, line: line)
        finish.tap()
        XCTAssertTrue(
            buttons["Enregistrer et fermer"].waitForExistence(timeout: 5), "the summary shows", file: file, line: line)
    }
}
