import XCTest

/// How a test ends the open session: by 🏁 once everything is noted, or by ■ in the pause.
enum SessionEnd {
    case flag
    case stop
}

extension XCUIApplication {
    /// Launches with the test's arguments. The first launch after an install can meet an instance
    /// the system started on its own: the launch then fails (« No such process ») or the test gets
    /// that instance without its arguments, on the English sign-in. A running instance is ended
    /// first, and a fixture launch that still shows the sign-in, which a fixture never does, is
    /// launched again once.
    func launchFixture() {
        if state != .notRunning { terminate() }
        launch()
        guard launchArguments.contains("-BelayFixture"), buttons["signin-submit"].exists else { return }
        terminate()
        launch()
    }

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
                control.identifier.hasPrefix("foot-") || control.identifier == "log-set" ? control.tapFootButton() : control.tap()
            }
            XCTAssertTrue(finish.exists, "🏁 shows once everything is noted", file: file, line: line)
            finish.tapFootButton()
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
    /// Taps one of the foot's round buttons where it is drawn. After a change, SwiftUI keeps the
    /// button's accessibility frame from before until the spring ends (measured: the reserve's
    /// 350 × 98 pt for up to 1.6 s, its centre 50 pt under the drawn ⏭), and a tap at that centre
    /// misses. A finger is not affected; the test waits for the frame to be the button's circle.
    func tapFootButton(timeout: TimeInterval = 5) {
        let deadline = Date.now.addingTimeInterval(timeout)
        while frame.width != frame.height, Date.now < deadline { Thread.sleep(forTimeInterval: 0.1) }
        tap()
    }

    /// Whether the element meets the predicate within the timeout.
    func waitFor(_ predicate: NSPredicate, timeout: TimeInterval = 3) -> Bool {
        XCTWaiter().wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout)
            == .completed
    }
}
