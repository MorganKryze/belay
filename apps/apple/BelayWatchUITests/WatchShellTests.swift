import XCTest

/// The watch's screens, one per state of its account, on a scripted iPhone and instance.
@MainActor
final class WatchShellTests: XCTestCase {
    /// The watch app on the fixture `fixture`, in French; `largest` sets the largest accessibility
    /// text size; `keep` relaunches on what the previous launch kept.
    private func launch(_ fixture: String, largest: Bool = false, keep: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayWatchFixture", fixture]
        if largest {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        if keep { app.launchArguments += ["-BelayWatchKeep", "YES"] }
        if app.state != .notRunning { app.terminate() }
        app.launch()
        return app
    }

    private func status(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: "watch-status").firstMatch
    }

    /// Whether the status comes to read every one of `words`, as one element.
    private func statusSays(_ app: XCUIApplication, _ words: String..., timeout: TimeInterval = 10) -> Bool {
        let element = status(app)
        let says = NSCompoundPredicate(
            andPredicateWithSubpredicates: words.map { NSPredicate(format: "label CONTAINS %@", $0) })
        let expectation = XCTNSPredicateExpectation(predicate: says, object: element)
        return XCTWaiter().wait(for: [expectation], timeout: timeout) == .completed
    }

    private func mark(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["belay-mark"]
    }

    func testAskingThePhoneSaysSo() {
        let app = launch("asking")
        XCTAssertTrue(statusSays(app, "Connexion à ton iPhone…"), "the watch says it asks: \(status(app).label)")
        XCTAssertFalse(app.buttons["watch-retry"].exists, "and offers nothing while it asks")
        XCTAssertFalse(mark(app).exists, "the mark stays out of VoiceOver")
    }

    func testPhoneOutOfReachSaysWhatToDo() {
        let app = launch("phoneOut")
        XCTAssertTrue(
            statusSays(app, "Ouvre Belay sur ton iPhone", "Ta montre utilise la connexion de ton iPhone."),
            "the watch says where to go: \(status(app).label)")
        let retry = app.buttons["watch-retry"]
        XCTAssertTrue(retry.exists, "and offers to try again")
        XCTAssertEqual(retry.label, "Réessayer")
        retry.tap()
        XCTAssertTrue(statusSays(app, "Ouvre Belay sur ton iPhone"), "trying again with no iPhone says it again")
    }

    func testPhoneSignedOutSaysToSignInOnTheIPhone() {
        let app = launch("phoneSignedOut")
        XCTAssertTrue(
            statusSays(app, "Connecte-toi dans Belay sur ton iPhone"),
            "the watch says to sign in on the iPhone: \(status(app).label)")
        XCTAssertEqual(app.buttons["watch-retry"].label, "Réessayer", "and offers to try again")
    }

    func testConnectedShowsTheNameAndTheInstance() {
        let app = launch("connected")
        XCTAssertTrue(
            statusSays(app, "Montre connectée", "Ana", "belay.example", "Instance jointe"),
            "the watch says who and where: \(status(app).label)")
        XCTAssertEqual(app.buttons["watch-signout"].label, "Déconnecter cette montre")
    }

    func testAnUnreachableInstanceIsSaidWithoutDisconnecting() {
        let app = launch("unreached")
        XCTAssertTrue(
            statusSays(app, "Montre connectée", "Ana", "Instance injoignable pour l’instant"),
            "the watch stays connected and says the instance did not answer: \(status(app).label)")
        XCTAssertFalse(status(app).label.contains("Instance jointe"))
        XCTAssertTrue(app.buttons["watch-signout"].exists, "and still offers to sign out")
    }

    func testSigningOutThisWatchAsksFirstAndHoldsAfterARelaunch() {
        var app = launch("connected")
        XCTAssertTrue(statusSays(app, "Montre connectée"))
        app.buttons["watch-signout"].tap()
        // The system's sheet drops the button's identifier on the watch: its row is found instead.
        let sure = app.cells.buttons["Déconnecter cette montre"].firstMatch
        XCTAssertTrue(sure.waitForExistence(timeout: 3), "signing out asks first")
        XCTAssertTrue(app.staticTexts["Déconnecter cette montre\u{202F}?"].exists, "with the question")
        XCTAssertTrue(app.staticTexts["Ton iPhone reste connecté."].exists, "and says the iPhone stays signed in")
        sure.tap()
        XCTAssertTrue(statusSays(app, "Montre déconnectée"), "the watch is signed out: \(status(app).label)")

        app = launch("connected", keep: true)
        XCTAssertTrue(statusSays(app, "Montre déconnectée"), "and stays so after a relaunch: \(status(app).label)")
        let connect = app.buttons["watch-connect"]
        XCTAssertEqual(connect.label, "Connecter avec l’iPhone")
        connect.tap()
        XCTAssertTrue(statusSays(app, "Montre connectée", "Instance jointe"), "connecting again asks the iPhone")
    }

    func testTheLargestTextKeepsEveryControlReachable() {
        let states: [(fixture: String, words: [String], control: String?)] = [
            ("asking", ["Connexion à ton iPhone…"], nil),
            ("phoneOut", ["Ouvre Belay sur ton iPhone", "Ta montre utilise la connexion de ton iPhone."], "watch-retry"),
            ("phoneSignedOut", ["Connecte-toi dans Belay sur ton iPhone"], "watch-retry"),
            ("connected", ["Montre connectée", "Ana", "belay.example", "Instance jointe"], "watch-signout"),
            ("signedOutHere", ["Montre déconnectée"], "watch-connect"),
        ]
        for state in states {
            let app = launch(state.fixture, largest: true)
            for word in state.words {
                XCTAssertTrue(statusSays(app, word), "\(state.fixture): the status reads « \(word) » as one element")
            }
            XCTAssertFalse(mark(app).exists, "\(state.fixture): the mark stays out of VoiceOver")
            guard let control = state.control else { continue }
            let button = app.buttons[control]
            var swipes = 0
            while !(button.exists && button.isHittable && app.frame.contains(button.frame)), swipes < 10 {
                app.swipeUp()
                swipes += 1
            }
            XCTAssertTrue(button.isHittable, "\(state.fixture): \(control) is reached by scrolling")
            XCTAssertTrue(app.frame.contains(button.frame), "\(state.fixture): \(control) sits whole on the screen")
            XCTAssertGreaterThanOrEqual(
                button.frame.height, 44, "\(state.fixture): \(control) grows with its text, not a fixed frame")
        }
    }
}
