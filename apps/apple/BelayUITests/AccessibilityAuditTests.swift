import XCTest

/// The system's accessibility audit on each key screen: contrast, hit regions, descriptions,
/// clipped text and Dynamic Type, at the default text size and at AX5, in light and in dark. At
/// AX5 each screen is also scrolled to its end, where the last control must still take a tap.
@MainActor
final class AccessibilityAuditTests: XCTestCase {
    /// Elements the audit may flag on purpose, by identifier, with the reason.
    private static let except: [String: String] = [:]

    private static let configurations: [(appearance: XCUIDevice.Appearance, largest: Bool)] = [
        (.light, false), (.dark, false), (.light, true), (.dark, true),
    ]

    override func tearDown() {
        XCUIDevice.shared.appearance = .light
        super.tearDown()
    }

    /// Runs `walk` once per configuration on a fresh launch of `fixture`, named for the failures.
    private func eachConfiguration(_ fixture: String, _ walk: (XCUIApplication, Place) -> Void) {
        for configuration in Self.configurations {
            let app = XCUIApplication.fixture(
                fixture, appearance: configuration.appearance, largest: configuration.largest)
            walk(app, Place(appearance: configuration.appearance, largest: configuration.largest))
            app.terminate()
        }
    }

    /// Where an audit runs, for its failure messages.
    private struct Place {
        let appearance: XCUIDevice.Appearance
        let largest: Bool

        func named(_ step: String) -> String {
            "\(step), \(largest ? "AX5" : "default size"), \(appearance == .dark ? "dark" : "light")"
        }
    }

    /// The audit, then at AX5 the screen scrolled to its end. `scrolls` is false on a dialog.
    private func check(
        _ app: XCUIApplication, _ step: String, at place: Place, scrolls: Bool = true,
        file: StaticString = #filePath, line: UInt = #line
    ) {
        let ran = audit(app, at: place.named(step), except: Self.except, file: file, line: line)
        // A screen the audit could not settle on cannot be swiped either: its failure says so once.
        if ran, place.largest, scrolls { reachEveryControl(app, at: place.named(step), file: file, line: line) }
    }

    /// Fails once per issue the system audit finds, unless its element is in `except`; false when
    /// the audit could not run.
    @discardableResult private func audit(
        _ app: XCUIApplication, at step: String, except: [String: String],
        file: StaticString = #filePath, line: UInt = #line
    ) -> Bool {
        do {
            try app.performAccessibilityAudit(
                for: [.contrast, .hitRegion, .sufficientElementDescription, .textClipped, .dynamicType]
            ) { issue in
                let id = issue.element?.identifier ?? ""
                if except[id] != nil { return true }
                let element = id.isEmpty ? "« \(issue.element?.label ?? "?") »" : id
                XCTFail(
                    "\(step): \(Self.name(issue.auditType)) on \(element): \(issue.compactDescription)",
                    file: file, line: line)
                return true
            }
            return true
        } catch {
            XCTFail("\(step): the audit did not run: \(error.localizedDescription)", file: file, line: line)
            return false
        }
    }

    private static func name(_ type: XCUIAccessibilityAuditType) -> String {
        switch type {
        case .contrast: "contrast"
        case .hitRegion: "hit region"
        case .sufficientElementDescription: "description"
        case .textClipped: "clipped text"
        case .dynamicType: "Dynamic Type"
        default: "audit \(type.rawValue)"
        }
    }

    /// Swipes until the lowest control stops moving, then checks it takes a tap: nothing at AX5
    /// is left under the tab bar or past the end of the screen.
    private func reachEveryControl(
        _ app: XCUIApplication, at step: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        var last = lastControl(app)
        for _ in 0..<12 {
            app.swipeUp(velocity: .slow)
            let now = lastControl(app)
            if now?.key == last?.key { break }
            last = now
        }
        guard let last else { return }
        let control = app.descendants(matching: last.type)
            .matching(NSPredicate(format: "identifier == %@ AND label == %@", last.identifier, last.label)).firstMatch
        XCTAssertTrue(
            control.isHittable, "\(step): the last control « \(last.identifier.isEmpty ? last.label : last.identifier) » "
                + "cannot be tapped at the end of the screen", file: file, line: line)
    }

    private struct Control {
        let type: XCUIElement.ElementType
        let identifier: String
        let label: String
        let frame: CGRect

        var key: String { "\(type.rawValue) \(identifier) \(label) \(frame)" }
    }

    private static let controls: Set<XCUIElement.ElementType> = [
        .button, .textField, .secureTextField, .switch, .toggle, .slider, .segmentedControl, .stepper, .link, .cell,
    ]

    /// The control drawn lowest on the screen, outside the bars and the keypad, from one snapshot.
    private func lastControl(_ app: XCUIApplication) -> Control? {
        guard let root = try? app.snapshot() else { return nil }
        let screen = app.windows.firstMatch.frame
        var lowest: Control?
        func walk(_ node: XCUIElementSnapshot) {
            if [.tabBar, .navigationBar, .keyboard].contains(node.elementType) { return }
            if Self.controls.contains(node.elementType), node.frame.width > 0, node.frame.height > 0,
                node.frame.minY < screen.maxY, node.frame.maxY > screen.minY,
                node.frame.maxY > (lowest?.frame.maxY ?? -.infinity)
            {
                lowest = Control(
                    type: node.elementType, identifier: node.identifier, label: node.label, frame: node.frame)
            }
            node.children.forEach(walk)
        }
        walk(root)
        return lowest
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    // MARK: Screens

    func testSignInPassesTheAudit() {
        eachConfiguration("signedOut") { app, place in
            XCTAssertTrue(app.textFields["signin-address"].waitForExistence(timeout: 10), "the sign-in shows")
            check(app, "sign-in", at: place)
        }
    }

    func testAccueilPassesTheAudit() {
        eachConfiguration("past") { app, place in
            XCTAssertTrue(app.navigationBars["Bonjour Ada"].waitForExistence(timeout: 10), "Accueil shows")
            check(app, "Accueil", at: place)
        }
    }

    /// The preview, the set card and its ✓, the rest, the correction sheet, ■'s question and the
    /// summary, in the order a session meets them.
    func testSessionPathPassesTheAudit() {
        eachConfiguration("past") { app, place in
            app.openPreview()
            check(app, "preview", at: place)
            let start = app.buttons["Commencer la séance"]
            XCTAssertTrue(app.swipeDownUntil(start), "the start is reached")
            start.tap()
            let log = element(app, "log-set")
            XCTAssertTrue(log.waitForExistence(timeout: 5), "the cover shows")
            check(app, "set card", at: place)
            // Warm-ups have no rest: ✓ until the first work set's rest starts.
            let rest = element(app, "rest-clock")
            for _ in 0..<4 where !rest.exists {
                if log.waitForExistence(timeout: 3) { log.tapFootButton() }
                _ = rest.waitForExistence(timeout: 3)
            }
            XCTAssertTrue(rest.exists, "the rest starts")
            check(app, "rest", at: place)
            let done = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'done-'"))
                .firstMatch
            XCTAssertTrue(app.swipeUpUntil(done), "a done set is listed")
            done.tap()
            XCTAssertTrue(app.buttons["correct-save"].waitForExistence(timeout: 3), "the correction sheet opens")
            check(app, "correction sheet", at: place)
            app.buttons["correct-close"].tap()
            XCTAssertTrue(app.buttons["correct-save"].waitForNonExistence(timeout: 3))
            let pause = app.buttons["Mettre la séance en pause"]
            XCTAssertTrue(app.swipeDownUntil(pause))
            pause.tap()
            let stop = app.buttons["Arrêter la séance"]
            XCTAssertTrue(stop.waitForExistence(timeout: 3), "pause becomes ■")
            stop.tap()
            let alert = app.alerts.firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 3), "■ asks first")
            check(app, "finish dialog", at: place, scrolls: false)
            alert.buttons["Arrêter"].tap()
            XCTAssertTrue(app.buttons["Enregistrer et fermer"].waitForExistence(timeout: 5), "the summary shows")
            check(app, "summary", at: place)
        }
    }

    func testPeseePassesTheAudit() {
        eachConfiguration("bodyUsual") { app, place in
            app.tab("Corps")
            let weighIn = element(app, "today.weighIn")
            XCTAssertTrue(app.swipeUpUntil(weighIn, swipes: 10), "Pesée's row is reached")
            weighIn.tap()
            XCTAssertTrue(app.sheetTitle("Pesée").waitForExistence(timeout: 5), "Pesée opens")
            check(app, "Pesée", at: place)
        }
    }

    /// Corps's average and curve at the top, then Tes semaines.
    func testCorpsPassesTheAudit() {
        eachConfiguration("bodyUsual") { app, place in
            app.tab("Corps")
            XCTAssertTrue(element(app, "trend-chart").waitForExistence(timeout: 5), "Corps shows its curve")
            check(app, "Corps", at: place)
            let weeks = element(app, "corps-weeks")
            XCTAssertTrue(app.swipeDownUntil(weeks) || app.swipeUpUntil(weeks), "Tes semaines' row is reached")
            weeks.tap()
            XCTAssertTrue(element(app, "legend-day").waitForExistence(timeout: 5), "Tes semaines opens")
            check(app, "Tes semaines", at: place)
        }
    }

    func testSeancesHistoryPassesTheAudit() {
        eachConfiguration("pastSession") { app, place in
            app.openHistory()
            let row = app.descendants(matching: .any).matching(identifier: "history.row").firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 5), "the session kept is listed")
            check(app, "Historique", at: place)
            XCTAssertTrue(app.swipeDownUntil(row) || app.swipeUpUntil(row))
            row.tap()
            XCTAssertTrue(app.navigationBars["Séance A"].waitForExistence(timeout: 5), "the past session opens")
            check(app, "past session", at: place)
        }
    }

    /// Réglages, its Unités, the Thème menu open and the sign-out question.
    func testReglagesPassesTheAudit() {
        eachConfiguration("fresh") { app, place in
            app.openReglages()
            check(app, "Réglages", at: place)
            let unit = element(app, "reglages-weight-unit")
            // At AX5 the list is many screens long, and the check above left it at its end.
            XCTAssertTrue(app.swipeDownUntil(unit, swipes: 24), "Unités is reached")
            audit(app, at: place.named("Unités"), except: Self.except)
            let theme = element(app, "reglages-theme")
            XCTAssertTrue(app.swipeDownUntil(theme, swipes: 24), "the theme row is reached")
            theme.tap()
            let system = app.buttons["Système"].firstMatch
            XCTAssertTrue(system.waitForExistence(timeout: 3), "the Thème menu opens")
            check(app, "Thème menu", at: place, scrolls: false)
            XCTAssertTrue(system.exists, "the Thème menu is still open after its audit")
            if system.exists { system.tap() }
            let signOut = app.buttons["signout"]
            XCTAssertTrue(app.swipeUpUntil(signOut, swipes: 24), "the sign-out is reached")
            signOut.tap()
            let alert = app.alerts.firstMatch
            XCTAssertTrue(alert.waitForExistence(timeout: 3), "a dialog asks first")
            check(app, "sign-out dialog", at: place, scrolls: false)
            let cancel = alert.buttons["Annuler"]
            XCTAssertTrue(cancel.exists, "the sign-out dialog is still up after its audit")
            if cancel.exists { cancel.tap() }
        }
    }

    func testOneRepMaxPassesTheAudit() {
        eachConfiguration("tools") { app, place in
            app.openTool("one-rep-max")
            check(app, "1RM", at: place)
        }
    }
}
