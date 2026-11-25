import XCTest

/// What the iPhone tells its watch, read through the fixture's recording link: the state it
/// publishes and the answer it would give the watch's request, each changed only by the gestures a
/// person makes in Réglages and at the sign-in.
@MainActor
final class WatchLinkTests: XCTestCase {
    private let footer = "Ta montre utilise cette connexion\u{202F}: te déconnecter ici la déconnecte aussi."

    private func launch(watch: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = [
            "-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", "fresh", "-BelayWatch", watch,
        ]
        app.launchFixture()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// The published state: « session·<n> » or « signedOut·<n> », n counting the ids published.
    private func context(_ app: XCUIApplication) -> XCUIElement { element(app, "debug-watch-context") }

    /// The answer to the watch's request: « session|<host> » or « signedOut ».
    private func reply(_ app: XCUIApplication) -> XCUIElement { element(app, "debug-watch-reply") }

    private func comesToRead(_ probe: XCUIElement, _ value: String, timeout: TimeInterval = 10) -> Bool {
        probe.waitFor(NSPredicate(format: "value == %@", value), timeout: timeout)
    }

    /// Réglages' sign-out, confirmed, until the sign-in shows.
    private func signOut(_ app: XCUIApplication) {
        app.openReglages()
        let signOut = app.buttons["signout"]
        XCTAssertTrue(app.swipeUpUntil(signOut), "Réglages offers to sign out")
        signOut.tap()
        let sure = app.buttons["signout-confirm"].firstMatch
        XCTAssertTrue(sure.waitForExistence(timeout: 3), "signing out asks first")
        sure.tap()
        XCTAssertTrue(app.textFields["signin-address"].waitForExistence(timeout: 5), "the sign-in shows")
    }

    func testFooterSaysTheWatchUsesThisSessionWhenItsAppIsInstalled() {
        let app = launch(watch: "installed")
        app.openReglages()
        let version = element(app, "version-line")
        XCTAssertTrue(app.swipeUpUntil(version), "Compte ends on the version line")
        let line = app.staticTexts[footer]
        XCTAssertTrue(line.exists, "the footer says the watch uses this session")
        XCTAssertLessThan(line.frame.maxY, version.frame.minY + 1, "above the version line")

        let without = launch(watch: "none")
        without.openReglages()
        let versionAlone = element(without, "version-line")
        XCTAssertTrue(without.swipeUpUntil(versionAlone), "Compte still ends on the version line")
        XCTAssertFalse(without.staticTexts[footer].exists, "no watch app, no line")
        XCTAssertTrue(without.buttons["signout"].exists, "and the section as before")
    }

    func testSigningOutTellsTheWatchWithNoSecret() {
        let app = launch(watch: "installed")
        XCTAssertTrue(comesToRead(context(app), "session·1"), "signed in, the watch is told of one session")
        signOut(app)
        XCTAssertTrue(comesToRead(context(app), "signedOut·1"), "signed out, the watch is told so")
        for probe in [context(app), reply(app)] {
            XCTAssertFalse((probe.value as? String ?? "").contains("fixture-token"), "no probe shows the token")
        }
    }

    func testTheWatchIsHandedTheSessionOnlyWhileSignedIn() {
        let app = launch(watch: "installed")
        XCTAssertTrue(comesToRead(reply(app), "session|belay.example"), "signed in, the watch is handed the session")
        signOut(app)
        XCTAssertTrue(comesToRead(reply(app), "signedOut"), "signed out, it is handed none")
    }

    func testANewSignInTellsTheWatchANewSession() {
        let app = launch(watch: "installed")
        XCTAssertTrue(comesToRead(context(app), "session·1"))
        signOut(app)
        XCTAssertTrue(comesToRead(context(app), "signedOut·1"))
        app.buttons["signin-submit"].tap()
        XCTAssertTrue(comesToRead(context(app), "session·2"), "signed in again, the watch is told of a new session")
        XCTAssertTrue(comesToRead(reply(app), "session|belay.example"))
    }
}
