import XCTest

/// What Accueil says while the queue waits, on fixture accounts whose instance never syncs:
/// offline once and quietly while logging goes on, a load the rules refuse not saved, a session
/// the instance refused, and an instance on another contract version, which `-BelayApi` sets.
@MainActor
final class SyncNoticeTests: XCTestCase {
    private let offline = "Hors ligne. Tout est gardé sur ce téléphone."
    private let ahead =
        "Ton instance est plus récente que cette version de Belay\u{202F}: mets l’app à jour. Tes saisies restent sur ce téléphone en attendant."
    private let behind =
        "Ton instance doit être mise à jour pour cette version de Belay. Tes saisies restent sur ce téléphone en attendant."

    private func launch(_ fixture: String, api: String? = nil) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if let api { app.launchArguments += ["-BelayApi", api] }
        app.launchFixture()
        return app
    }

    /// Every change waiting to be sent, whatever its kind.
    private func queued(_ app: XCUIApplication) -> XCUIElement {
        element(app, "fixture-outbox")
    }

    /// How many times the instance was asked its version since the launch.
    private func versionChecks(_ app: XCUIApplication) -> XCUIElement {
        element(app, "debug-api-checks")
    }

    private func reads(_ value: String) -> NSPredicate {
        NSPredicate(format: "value == %@", value)
    }

    /// Today's weigh-in typed again from Accueil, which queues one more change.
    private func weighAgain(_ app: XCUIApplication) {
        let row = element(app, "today.weighIn")
        XCTAssertTrue(app.swipeUpUntil(row), "Accueil holds the weigh-in")
        row.tap()
        XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5))
        let field = element(app, "weighin-kg")
        if !app.keyboards.firstMatch.waitForExistence(timeout: 3) { field.tap() }
        for _ in 0..<5 { field.typeText(XCUIKeyboardKey.delete.rawValue) }
        field.typeText("79,5")
        element(app, "weighin-save").tap()
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

    /// Logs the next set with ✓, as prefilled, in one tap.
    private func tick(_ app: XCUIApplication) {
        app.buttons["log-set"].tap()
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

        // Corps is native too, and says nothing of the sync.
        app.tabBars.firstMatch.buttons["Corps"].tap()
        XCTAssertTrue(app.navigationBars["Corps"].waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "sync-notice").exists, "only Accueil says it")
    }

    /// 62,3 kg is off the 0,25 kg grid: the set is not saved, and the screen says so.
    func testALoadTheRulesRefuseIsNotSaved() {
        let app = launch("history")
        openCover(app)
        element(app, "load").tap()
        app.buttons["Autre charge…"].tap()
        let keypad = app.alerts.textFields.firstMatch
        XCTAssertTrue(keypad.waitForExistence(timeout: 2), "a keypad opens")
        keypad.typeText("62,3")
        app.alerts.buttons["OK"].tap()
        tick(app)
        let alert = app.alerts.firstMatch
        XCTAssertTrue(alert.waitForExistence(timeout: 3), "the refusal is said")
        XCTAssertTrue(alert.staticTexts["Ce n’est pas noté. Réessaie."].exists, "as not saved")
        XCTAssertEqual(queuedSets(app), "0", "nothing is queued")
        alert.buttons.firstMatch.tap()
        XCTAssertFalse(element(app, "done-0-0").exists, "the set is not done")
    }

    /// A session the instance refused: the line says so and offers to sign in again.
    func testAnExpiredSessionAsksToSignInAgain() {
        let app = launch("expired")
        XCTAssertTrue(app.staticTexts["Ta connexion a expiré."].waitForExistence(timeout: 10), "the line says so")
        XCTAssertTrue(app.buttons["sync-reconnect"].exists, "with the way back in")
        XCTAssertEqual(app.buttons["sync-reconnect"].label, "Se reconnecter")
    }

    /// An instance on a later version: the line says the app needs an update, the queue stays,
    /// and a weigh-in still lands and queues.
    func testInstanceAheadIsSaidAndNothingIsSent() {
        let app = launch("pending1", api: "ahead")
        XCTAssertTrue(app.staticTexts[ahead].waitForExistence(timeout: 10), "Accueil says the app needs an update")
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", ahead)).count, 1, "once")
        XCTAssertFalse(app.buttons["sync-retry"].exists, "with no action")
        XCTAssertTrue(queued(app).waitFor(reads("1")), "nothing is sent")
        weighAgain(app)
        XCTAssertTrue(queued(app).waitFor(reads("2"), timeout: 5), "the weigh-in is stored and queued")
        // Past the 1 s pause before the weigh-in's sync: the queue still waits.
        XCTAssertFalse(queued(app).waitFor(reads("0"), timeout: 3), "the weigh-in's sync sends nothing")
        XCTAssertEqual(queued(app).value as? String, "2", "the queue stays")
        XCTAssertTrue(app.staticTexts[ahead].exists, "the line stays")
    }

    /// An instance on an earlier version: the line says the instance needs an update.
    func testInstanceBehindIsSaid() {
        let app = launch("pending1", api: "behind")
        XCTAssertTrue(app.staticTexts[behind].waitForExistence(timeout: 10), "Accueil says the instance needs an update")
        XCTAssertFalse(app.buttons["sync-retry"].exists, "with no action")
        XCTAssertTrue(queued(app).waitFor(reads("1")), "nothing is sent")
    }

    /// Once the instance speaks this build's version, the queue goes out and the line leaves.
    func testAMatchingVersionSendsTheQueueAndTheNoticeLeaves() {
        let app = launch("pending1", api: "ahead")
        XCTAssertTrue(app.staticTexts[ahead].waitForExistence(timeout: 10))
        XCTAssertTrue(queued(app).waitFor(reads("1")))
        app.terminate()

        let again = launch("keep", api: "same")
        XCTAssertTrue(queued(again).waitFor(reads("0"), timeout: 10), "the queue is sent")
        XCTAssertFalse(again.staticTexts[ahead].exists, "the line leaves")
        XCTAssertFalse(element(again, "sync-notice").exists, "nothing else is said")
    }

    /// An instance out of reach says nothing of versions: the sync goes on as before.
    func testAnUnreachableInstanceIsNotAnIncompatibility() {
        let app = launch("pending1", api: "none")
        XCTAssertTrue(element(app, "today.weighIn").waitForExistence(timeout: 10))
        XCTAssertTrue(queued(app).waitFor(reads("0"), timeout: 10), "the queue is sent")
        XCTAssertFalse(app.staticTexts[ahead].exists)
        XCTAssertFalse(app.staticTexts[behind].exists)
        XCTAssertFalse(element(app, "sync-notice").exists, "no line")
    }

    /// The version is asked at launch and again on each return, not on every sync between.
    func testReturningToTheForegroundChecksTheVersionOnce() {
        let app = launch("pending1", api: "same")
        XCTAssertTrue(versionChecks(app).waitFor(reads("1"), timeout: 10), "asked once at launch")
        XCTAssertTrue(queued(app).waitFor(reads("0"), timeout: 10))
        XCTAssertEqual(versionChecks(app).value as? String, "1", "exactly once once the queue is sent")

        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(versionChecks(app).waitFor(reads("2"), timeout: 10), "asked again on the return")

        weighAgain(app)
        XCTAssertTrue(queued(app).waitFor(reads("0"), timeout: 10), "the weigh-in's sync went out")
        XCTAssertFalse(versionChecks(app).waitFor(reads("3"), timeout: 3), "a sync between returns asks nothing")
        XCTAssertEqual(versionChecks(app).value as? String, "2")
    }
}
