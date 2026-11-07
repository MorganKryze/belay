import XCTest

/// Signing out from Réglages on a fixture account whose session A is open, then back in on the
/// same fixture instance: the set ticked before is still done and still queued once.
@MainActor
final class SignOutTests: XCTestCase {
    private func launch(_ fixture: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        app.launch()
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
        XCTAssertTrue(app.buttons["tick"].waitForExistence(timeout: 5), "the cover shows the next set")
    }

    func testSignOutKeepsTheTickedSetForTheNextSignIn() {
        let app = launch("history")
        openCover(app)
        app.buttons["tick"].tap()
        XCTAssertTrue(element(app, "set-0-3").label.contains("faite"), "the set is done")
        XCTAssertEqual(queuedSets(app), "1", "and queued once")
        app.buttons["Réduire la séance"].tap()
        XCTAssertTrue(app.buttons["resume-accessory"].waitForExistence(timeout: 5), "back on Accueil")

        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5), "Accueil leads to Réglages")
        XCTAssertEqual(settings.label, "Réglages", "the avatar is named for VoiceOver")
        settings.tap()
        let signOut = app.buttons["signout"]
        XCTAssertTrue(signOut.waitForExistence(timeout: 5), "Réglages offers to sign out")
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
        let row = element(app, "set-0-3")
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertTrue(row.label.contains("faite"), "signed in again, the set is still done: \(row.label)")
        XCTAssertEqual(queuedSets(app), "1", "and still queued once")
    }
}
