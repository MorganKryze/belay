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

    private let usesThePhone = "Ta montre utilise la connexion de ton iPhone."

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

    func testReturningToTheFrontAsksThePhoneAgain() {
        let app = launch("phoneBack")
        XCTAssertTrue(
            statusSays(app, "Ouvre Belay sur ton iPhone"), "the first ask finds no iPhone: \(status(app).label)")
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(app.wait(for: .runningBackground, timeout: 5), "the watch leaves the front")
        app.activate()
        XCTAssertTrue(
            statusSays(app, "Montre connectée", "Instance jointe"),
            "coming back asks the iPhone again, without a tap: \(status(app).label)")
    }

    func testPhoneSignedOutSaysToSignInOnTheIPhone() {
        let app = launch("phoneSignedOut")
        XCTAssertTrue(
            statusSays(app, "Connecte-toi dans Belay sur ton iPhone"),
            "the watch says to sign in on the iPhone: \(status(app).label)")
        XCTAssertEqual(app.buttons["watch-retry"].label, "Réessayer", "and offers to try again")
        XCTAssertFalse(status(app).label.contains(usesThePhone), "the line on the iPhone's session is not said here")
    }

    func testTryingAgainAsksThePhoneAgain() {
        let app = launch("phoneBack")
        XCTAssertTrue(
            statusSays(app, "Ouvre Belay sur ton iPhone"), "the first ask finds no iPhone: \(status(app).label)")
        app.buttons["watch-retry"].tap()
        XCTAssertTrue(
            statusSays(app, "Montre connectée", "Instance jointe"),
            "Réessayer asks the iPhone again and is answered: \(status(app).label)")
    }

    func testARefusedTokenSendsBackToThePhone() {
        let app = launch("refused")
        XCTAssertTrue(
            statusSays(app, "Ouvre Belay sur ton iPhone"),
            "a token the instance refuses is not kept: \(status(app).label)")
        XCTAssertFalse(app.buttons["watch-signout"].exists, "and the watch is not shown connected")
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
        XCTAssertFalse(status(app).label.contains(usesThePhone), "the line on the iPhone's session is not said here")

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
            ("unreached", ["Montre connectée", "Ana", "Instance injoignable pour l’instant"], "watch-signout"),
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

        let app = launch("connected", largest: true)
        XCTAssertTrue(statusSays(app, "Montre connectée"))
        let signOut = app.buttons["watch-signout"]
        var swipes = 0
        while !(signOut.exists && signOut.isHittable), swipes < 10 {
            app.swipeUp()
            swipes += 1
        }
        signOut.tap()
        let sure = app.cells.buttons["Déconnecter cette montre"].firstMatch
        XCTAssertTrue(sure.waitForExistence(timeout: 3), "the sign-out asks first at the largest text")
        swipes = 0
        while !(sure.isHittable && app.frame.contains(sure.frame)), swipes < 10 {
            app.swipeUp()
            swipes += 1
        }
        XCTAssertTrue(sure.isHittable, "the confirmation is reached by scrolling")
        XCTAssertGreaterThanOrEqual(sure.frame.height, 44, "the confirmation keeps a 44 pt target")
    }
}
