import XCTest

/// The steps import's switch in Réglages and the words Santé's refusals take, on the fixture's
/// `fresh` store with Santé off. Health's answer is the fixture's (`-BelayHealth`): the system's own
/// sheet is proved on the phone.
@MainActor
final class ActivityTests: XCTestCase {
    /// « Sur cet iPhone », reached from Accueil's avatar.
    private func santeSection(_ health: String) -> XCUIApplication {
        let app = XCUIApplication.fixture("fresh", health: health)
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10))
        settings.tap()
        XCTAssertTrue(app.navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens")
        XCTAssertTrue(app.swipeUpUntil(app.switches["health-steps-switch"]), "« Sur cet iPhone » is reached")
        return app
    }

    private func footer(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["health-footer"].firstMatch
    }

    /// A29, R5: with Santé off, the steps switch turns Santé on first, then itself.
    func testStepsSwitchTurnsSanteOnFirst() {
        let app = santeSection("allowed")
        let sante = app.switches["health-switch"]
        let steps = app.switches["health-steps-switch"]
        XCTAssertEqual(sante.value as? String, "0", "Santé starts off")
        steps.switches.firstMatch.tap()
        XCTAssertTrue(steps.waitFor(NSPredicate(format: "value == '1'"), timeout: 5), "the steps import is on")
        XCTAssertEqual(sante.value as? String, "1", "Santé went on with it")
        XCTAssertEqual(app.switches["health-import-switch"].value as? String, "0", "the weigh-ins stay as they were")
    }

    /// A29: the footer says what the steps switch does and where to allow a refused read.
    func testFooterNamesSteps() {
        let app = santeSection("allowed")
        XCTAssertTrue(app.swipeUpUntil(footer(app)))
        let words = footer(app).label
        XCTAssertTrue(words.contains("Importer les pas ajoute tes pas de Santé"), words)
        XCTAssertTrue(words.contains("lire le poids et les pas"), words)
    }

    /// R18: iOS refusing Santé, each switch says what was refused in its own words.
    func testRefusalWordsPerSwitch() {
        let cases = [
            ("health-switch", "Santé n’autorise pas Belay à y écrire tes séances."),
            ("health-import-switch", "Pour importer tes pesées, Belay a besoin de l’accès à Santé."),
            ("health-steps-switch", "Pour importer tes pas, Belay a besoin de l’accès à Santé."),
        ]
        for (id, words) in cases {
            let app = santeSection("refused")
            let toggle = app.switches[id]
            toggle.switches.firstMatch.tap()
            XCTAssertTrue(toggle.waitFor(NSPredicate(format: "value == '0'"), timeout: 5), "\(id) stays off")
            XCTAssertTrue(app.swipeUpUntil(footer(app)))
            XCTAssertTrue(
                footer(app).waitFor(NSPredicate(format: "label BEGINSWITH %@", words), timeout: 5),
                "\(id): \(footer(app).label)")
            XCTAssertEqual(app.switches["health-switch"].value as? String, "0", "Santé stays off")
        }
    }

    /// R18: Corps's card names the weigh-ins it imports, never the sessions Santé would hold.
    func testCorpsCardWordsSayWeighIns() {
        let app = XCUIApplication.fixture("healthCard", health: "refused")
        app.tab("Corps")
        let accept = app.buttons["Importer les pesées"]
        XCTAssertTrue(accept.waitForExistence(timeout: 10))
        accept.tap()
        let refusal = app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'Belay a besoin'")).firstMatch
        XCTAssertTrue(refusal.waitForExistence(timeout: 5), "the card says why")
        XCTAssertTrue(refusal.label.contains("tes pesées"), refusal.label)
        XCTAssertFalse(refusal.label.contains("séances"), refusal.label)
    }
}
