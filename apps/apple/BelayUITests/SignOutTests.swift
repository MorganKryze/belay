import XCTest

/// Signing out from Réglages on a fixture account whose session A is open, then back in on the
/// same fixture instance: the set ticked before is still done and still queued once.
@MainActor
final class SignOutTests: XCTestCase {
    private func launch(_ fixture: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        app.launchFixture()
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func queuedSets(_ app: XCUIApplication) -> String? {
        element(app, "fixture-queue").value as? String
    }

    private func openCover(_ app: XCUIApplication) {
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 10), "the session is open")
        resume.tap()
        XCTAssertTrue(app.buttons["log-set"].waitForExistence(timeout: 5), "the cover shows the next set")
    }

    func testSignOutKeepsTheTickedSetForTheNextSignIn() {
        let app = launch("history")
        openCover(app)
        app.buttons["log-set"].tap()
        XCTAssertTrue(element(app, "done-0-0").label.contains("Montée"), "the set is done, the first warm-up")
        XCTAssertEqual(queuedSets(app), "1", "and queued once")
        app.buttons["Réduire la séance"].tap()
        XCTAssertTrue(app.buttons["resume-accessory"].waitForExistence(timeout: 5), "back on Accueil")

        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5), "Accueil leads to Réglages")
        XCTAssertEqual(settings.label, "Réglages", "the avatar is named for VoiceOver")
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
        // Compte is the list's last section (A26): the list scrolls to it.
        let signOut = app.buttons["signout"]
        XCTAssertTrue(app.swipeUpUntil(signOut), "Réglages offers to sign out")
        signOut.tap()
        let sure = app.buttons["signout-confirm"].firstMatch
        XCTAssertTrue(sure.waitForExistence(timeout: 3), "signing out asks first")
        XCTAssertTrue(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "prochaine connexion")).firstMatch
                .exists, "and says the unsent entries wait for the next sign-in")
        sure.tap()

        let field = app.textFields["signin-address"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "signed out, the sign-in screen shows")
        XCTAssertEqual(field.value as? String, "belay.example", "with the instance kept")
        app.buttons["signin-submit"].tap()

        openCover(app)
        let row = element(app, "done-0-0")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertTrue(row.label.contains("Montée"), "signed in again, the set is still done: \(row.label)")
        XCTAssertEqual(queuedSets(app), "1", "and still queued once")
    }

    // MARK: A30, A31

    /// Réglages' sign-out, then its question.
    private func ask(_ app: XCUIApplication) -> XCUIElement {
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5))
        let signOut = app.buttons["signout"]
        XCTAssertTrue(app.swipeUpUntil(signOut))
        signOut.tap()
        let alert = app.alerts["Se déconnecter\u{202F}?"]
        XCTAssertTrue(alert.waitForExistence(timeout: 3), "a dialog asks first")
        return alert
    }

    /// The question in a centred alert, never an action sheet, with its body and its two buttons.
    private func expectAlert(_ fixture: String, body: String, confirm: String) {
        let app = launch(fixture)
        let alert = ask(app)
        XCTAssertEqual(app.sheets.count, 0, "not an action sheet")
        let screen = app.windows.firstMatch.frame
        XCTAssertEqual(alert.frame.midY, screen.midY, accuracy: screen.height * 0.15, "centred")
        XCTAssertTrue(alert.staticTexts[body].exists, "\(fixture): « \(body) »")
        XCTAssertTrue(alert.buttons[confirm].exists, "\(fixture): « \(confirm) »")
        XCTAssertTrue(alert.buttons["Annuler"].exists)
        alert.buttons["Annuler"].tap()
        XCTAssertTrue(app.buttons["signout"].waitForExistence(timeout: 3), "Annuler keeps the account")
    }

    func testCentredAlertAt0() {
        expectAlert("pending0", body: "Rien n’attend d’être envoyé.", confirm: "Se déconnecter")
    }

    func testAt1() {
        expectAlert(
            "pending1",
            body: "1 saisie pas encore envoyée\u{202F}: elle partira à ta prochaine connexion sur cet appareil.",
            confirm: "Se déconnecter quand même")
    }

    func testAt2() {
        expectAlert(
            "pending2",
            body: "2 saisies pas encore envoyées\u{202F}: elles partiront à ta prochaine connexion sur cet appareil.",
            confirm: "Se déconnecter quand même")
    }

    func testWhenQueueUnreadable() {
        expectAlert(
            "queueUnreadable",
            body: "Des saisies n’ont peut-être pas encore été envoyées\u{202F}: elles partiront à ta prochaine connexion sur cet appareil.",
            confirm: "Se déconnecter quand même")
    }

    func testAccountLineNoParticiple() {
        let app = launch("pending0")
        XCTAssertTrue(app.buttons["settings"].waitForExistence(timeout: 10))
        app.buttons["settings"].tap()
        let line = element(app, "account-line")
        XCTAssertTrue(app.swipeUpUntil(line), "Compte holds the account's line")
        XCTAssertEqual(line.label, "Ada, belay.example", "the name and the instance")
        XCTAssertFalse(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS[c] 'connecté'")).firstMatch.exists,
            "no participle")
        XCTAssertTrue(app.staticTexts["Compte"].exists)
    }

    func testVersionLineOpensNotes() {
        let app = launch("pending0")
        XCTAssertTrue(app.buttons["settings"].waitForExistence(timeout: 10))
        app.buttons["settings"].tap()
        let version = element(app, "version-line")
        XCTAssertTrue(app.swipeUpUntil(version))
        XCTAssertNotNil(
            version.label.wholeMatch(of: /Belay \d+(\.\d+)+ · notes de version/), "the installed version: \(version.label)")
        version.tap()
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 10), "the release notes open")
        safari.terminate()
    }
}
