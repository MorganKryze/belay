import XCTest

/// The sign-in screen as a person meets it signed out: the address field and the words around it.
@MainActor
final class SignInTests: XCTestCase {
    private func launch(_ appearance: XCUIDevice.Appearance = .light) -> XCUIApplication {
        XCUIDevice.shared.appearance = appearance
        let app = XCUIApplication()
        // No stored instance: the app opens signed out, the field empty with its placeholder showing.
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-belay.instance", ""]
        app.launch()
        return app
    }

    private func field(in app: XCUIApplication) -> XCUIElement {
        let field = app.textFields["signin-address"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the sign-in screen shows its field")
        return field
    }

    /// The typed line is 22 pt tall; a tap anywhere in the 44 pt around it starts typing.
    func testFieldTakesATapAcrossItsTarget() {
        for offset in [-21.0, -15.0, 0, 15.0, 21.0] {
            let app = launch()
            let field = field(in: app)
            field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .withOffset(CGVector(dx: 0, dy: offset))
                .tap()
            let focused = NSPredicate { element, _ in
                (element as? XCUIElement)?.value(forKey: "hasKeyboardFocus") as? Bool == true
            }
            let wait = XCTNSPredicateExpectation(predicate: focused, object: field)
            XCTAssertEqual(
                XCTWaiter().wait(for: [wait], timeout: 2), .completed,
                "a tap \(offset) pt from the line's middle starts typing"
            )
            app.terminate()
        }
    }
}
