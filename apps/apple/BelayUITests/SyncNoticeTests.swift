import XCTest

/// What Accueil says while the queue waits, on fixture accounts whose instance never syncs:
/// offline once and quietly while logging goes on, a load the rules refuse not saved, and a
/// session the instance refused.
@MainActor
final class SyncNoticeTests: XCTestCase {
    private let offline = "Hors ligne. Tout est gardé sur ce téléphone."

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

    /// Ticks the next set with the RIR shown under it, in one tap.
    private func tick(_ app: XCUIApplication) {
        app.buttons["tick"].tap()
    }

    /// Offline is said once, on Accueil only, through a return to the foreground and a tick that
    /// triggers a sync, and the tick is still stored and queued.
    func testOfflineIsSaidOnceOnAccueil() {
        let app = launch("history")
        let line = app.staticTexts[offline]
        XCTAssertTrue(line.waitForExistence(timeout: 10), "Accueil says the phone is offline")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", offline)).count, 1, "once")

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.buttons["Reprendre"].waitForExistence(timeout: 10))
        XCTAssertTrue(line.exists, "the line stays through the sync a return to the foreground runs")

        openCover(app)
        tick(app)
        XCTAssertEqual(queuedSets(app), "1", "a tick is still stored and queued")
        app.buttons["Réduire la séance"].tap()
        XCTAssertTrue(app.buttons["resume-accessory"].waitForExistence(timeout: 5), "back on Accueil")
        XCTAssertTrue(line.exists, "the line stays through the sync the tick runs")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", offline)).count, 1, "still once")

        app.buttons["dumbbell"].tap()
        XCTAssertTrue(app.staticTexts["Cet écran est sur le web pour l’instant."].waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "sync-notice").exists, "only Accueil says it")
    }

    /// 62,3 kg is off the 0,25 kg grid: the set is not saved, and the screen says so.
    func testALoadTheRulesRefuseIsNotSaved() {
        let app = launch("history")
        openCover(app)
        let kg = app.textFields["load-kg"]
        kg.tap()
        kg.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6) + "62,3")
        tick(app)
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 3), "the refusal is said")
        XCTAssertTrue(
            alert.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "La série n’a pas été notée"))
                .firstMatch.exists, "as not saved")
        XCTAssertEqual(queuedSets(app), "0", "nothing is queued")
        alert.buttons.firstMatch.tap()
        XCTAssertFalse(element(app, "set-0-3").label.contains("faite"), "the set is not done")
    }

    /// A session the instance refused: the line says so and offers to sign in again.
    func testAnExpiredSessionAsksToSignInAgain() {
        let app = launch("expired")
        XCTAssertTrue(app.staticTexts["Ta connexion a expiré."].waitForExistence(timeout: 10), "the line says so")
        XCTAssertTrue(app.buttons["sync-reconnect"].exists, "with the way back in")
        XCTAssertEqual(app.buttons["sync-reconnect"].label, "Se reconnecter")
    }
}
