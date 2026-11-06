import XCTest

/// The sign-in screen as a person meets it signed out: the address field and the words around it.
@MainActor
final class SignInTests: XCTestCase {
    private func launch(
        _ appearance: XCUIDevice.Appearance = .light, language: String = "fr", largestText: Bool = false
    ) -> XCUIApplication {
        XCUIDevice.shared.appearance = appearance
        let app = XCUIApplication()
        // No stored instance: the app opens signed out, the field empty with its placeholder showing.
        app.launchArguments = [
            "-AppleLanguages", "(\(language))", "-AppleLocale", language == "fr" ? "fr_FR" : "en_US",
            "-belay.instance", "",
        ]
        // AX3, the largest size the session path is held to.
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launch()
        return app
    }

    private func field(in app: XCUIApplication) -> XCUIElement {
        let field = app.textFields["signin-address"]
        XCTAssertTrue(field.waitForExistence(timeout: 5), "the sign-in screen shows its field")
        return field
    }

    /// VoiceOver and Voice Control name the field.
    func testFieldIsNamed() {
        for (language, name) in [("fr", "Adresse de l’instance"), ("en", "Instance address")] {
            let app = launch(language: language)
            XCTAssertEqual(field(in: app).label, name, language)
            app.terminate()
        }
    }

    /// VoiceOver meets the field's name once, on the field, with no header saying it before.
    func testHeaderIsNotReadBesideTheField() {
        let app = launch()
        XCTAssertEqual(field(in: app).label, "Adresse de l’instance")
        XCTAssertFalse(app.staticTexts["Adresse de l’instance"].exists, "the header is read as well")
    }

    /// At AX3 a long address wraps onto more lines instead of scrolling out of sight.
    func testLongAddressStaysWholeAtTheLargestSize() {
        let app = launch(largestText: true)
        let field = field(in: app)
        let empty = field.frame.height
        field.tap()
        field.typeText("belay.une-instance-au-nom-long.exemple.fr")
        XCTAssertGreaterThan(field.frame.height, empty * 1.5, "the field grows to show the whole address")
        XCTAssertLessThanOrEqual(field.frame.maxX, app.windows.firstMatch.frame.maxX)
    }

    /// At AX3 the refusal sits above Se connecter, not under it, even below a long address.
    func testRefusalStaysAboveTheButtonAtTheLargestSize() {
        let app = launch(largestText: true)
        let field = field(in: app)
        field.tap()
        field.typeText("https://ana:secret@belay.une-instance-au-nom-long.exemple.fr")
        let submit = app.buttons["signin-submit"]
        submit.tap()
        let problem = app.staticTexts["signin-problem"]
        XCTAssertTrue(problem.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(problem.frame.minY, app.navigationBars.firstMatch.frame.minY)
        XCTAssertLessThanOrEqual(problem.frame.maxY, submit.frame.minY, "the sentence hides under the button")
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

    /// A refused address is said in one sentence under the field, in the person's language, even
    /// when the refusal comes back before the screen has drawn the try.
    func testRefusalIsSaidUnderTheField() {
        let sentences = [
            ("fr", "L’adresse doit commencer par https://"), ("en", "The address must start with https://"),
        ]
        for (language, sentence) in sentences {
            let app = launch(language: language)
            let field = field(in: app)
            field.tap()
            field.typeText("http://belay.example")
            app.buttons["signin-submit"].tap()
            let problem = app.staticTexts["signin-problem"]
            XCTAssertTrue(problem.waitForExistence(timeout: 5), language)
            XCTAssertEqual(problem.label, sentence, language)
            app.terminate()
        }
    }

    func testPlaceholderMeetsAA() {
        for appearance in [XCUIDevice.Appearance.light, .dark] {
            let app = launch(appearance)
            let field = field(in: app)
            let name = appearance == .light ? "light" : "dark"
            XCTAssertGreaterThanOrEqual(Self.contrast(of: field.screenshot()), 4.5, "placeholder, \(name)")
            app.terminate()
        }
        XCUIDevice.shared.appearance = .light
    }

    /// The WCAG ratio between the colour most of the shot is painted in, the background, and the
    /// pixel furthest from it, the core of a glyph's stroke.
    private static func contrast(of shot: XCUIScreenshot) -> Double {
        guard let image = shot.image.cgImage, let space = CGColorSpace(name: CGColorSpace.sRGB) else { return 0 }
        let width = image.width, height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        let drawn: Bool = pixels.withUnsafeMutableBytes { bytes in
            guard let context = CGContext(
                data: bytes.baseAddress, width: width, height: height, bitsPerComponent: 8,
                bytesPerRow: width * 4, space: space,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        guard drawn else { return 0 }

        var counts: [UInt32: Int] = [:]
        for i in stride(from: 0, to: pixels.count, by: 4) {
            let rgb = UInt32(pixels[i]) << 16 | UInt32(pixels[i + 1]) << 8 | UInt32(pixels[i + 2])
            counts[rgb, default: 0] += 1
        }
        guard let background = counts.max(by: { $0.value < $1.value })?.key else { return 0 }
        let paper = luminance(background)
        return counts.keys.map { ratio(luminance($0), paper) }.max() ?? 0
    }

    private static func luminance(_ rgb: UInt32) -> Double {
        func channel(_ shift: UInt32) -> Double {
            let c = Double((rgb >> shift) & 0xFF) / 255
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
    }

    private static func ratio(_ a: Double, _ b: Double) -> Double {
        (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }
}
