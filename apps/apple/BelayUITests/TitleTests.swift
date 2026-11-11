import XCTest

/// A large title scrolls away with the content: no compact title takes its place in the bar, and
/// the bar's buttons stay.
@MainActor
final class TitleTests: XCTestCase {
    private func launch(_ fixture: String, largestText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launchFixture()
        return app
    }

    /// A title a person can see in the bar. The bar still names itself for VoiceOver, through an
    /// element one point wide where the compact title stood.
    private func titleInBar(_ app: XCUIApplication, _ title: String) -> Bool {
        app.navigationBars.staticTexts.matching(NSPredicate(format: "label == %@", title))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
    }

    /// The preview's « Séance A » leaves with the list; the back button stays.
    func testPreviewTitleLeavesWithTheList() {
        let app = launch("fresh")
        let open = app.buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10))
        open.tap()
        XCTAssertTrue(app.staticTexts["Barbell bench press"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertFalse(titleInBar(app, "Séance A"), "no compact title once the list has scrolled")
        XCTAssertTrue(app.navigationBars.buttons.firstMatch.isHittable, "the back button stays")
    }

    /// At the largest text Accueil scrolls; « Bonjour Ada » leaves with it, the avatar stays.
    func testAccueilTitleLeavesWithTheList() {
        let app = launch("running", largestText: true)
        XCTAssertTrue(app.buttons["Reprendre"].waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertFalse(titleInBar(app, "Bonjour Ada"), "no compact title once the list has scrolled")
        XCTAssertTrue(app.buttons["settings"].isHittable, "the avatar stays")
    }
}
