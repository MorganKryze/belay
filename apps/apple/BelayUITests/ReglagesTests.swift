import XCTest

/// Réglages reached from Accueil's avatar: its sections in order, the theme reaching sheets and
/// alerts and kept after a relaunch, the language left to the iPhone's Réglages, and each display
/// row switched, then read on the screen it changes. Every fixture launch but `keep` starts from
/// the web's defaults.
@MainActor
final class ReglagesTests: XCTestCase {
    private static let ax3 = ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]

    override func setUp() {
        continueAfterFailure = false
    }

    private func launch(_ fixture: String, english: Bool = false, extra: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            (english
                ? ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
                : ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR"])
            + ["-BelayFixture", fixture] + extra
        app.launchFixture()
        return app
    }

    /// Réglages, from Accueil's avatar.
    private func reglages(_ app: XCUIApplication, title: String = "Réglages") {
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Accueil leads to Réglages")
        settings.tap()
        XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 5), "Réglages opens")
    }

    private func back(_ app: XCUIApplication) {
        app.navigationBars.buttons.firstMatch.tap()
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    private func reach(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        let row = element(app, id)
        XCTAssertTrue(app.swipeUpUntil(row), "the row \(id) is reached")
        // A row can be hittable at its centre while its end sits under the floating tab bar, where
        // a tap would switch tabs, or under the open session's bar above it, which the tab bar no
        // longer folds away: bring it clear of both first.
        let bar = app.tabBars.firstMatch
        let accessory = element(app, "resume-accessory")
        func top() -> CGFloat { accessory.exists ? accessory.frame.minY : bar.frame.minY }
        for _ in 0..<3 where bar.exists && row.frame.maxY > top() - 8 {
            app.swipeUp(velocity: .slow)
        }
        return row
    }

    /// A switch row turned off.
    private func switchOff(_ app: XCUIApplication, _ id: String) {
        let row = reach(app, id)
        XCTAssertEqual(row.value as? String, "1", "\(id) starts on")
        row.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        XCTAssertTrue(row.waitFor(NSPredicate(format: "value == '0'"), timeout: 3), "\(id) goes off")
    }

    /// A menu row set to `choice`.
    private func choose(_ app: XCUIApplication, _ id: String, _ choice: String) {
        reach(app, id).tap()
        let option = app.buttons[choice].firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 3), "the menu offers « \(choice) »")
        option.tap()
        XCTAssertTrue(element(app, id).waitFor(NSPredicate(format: "label CONTAINS %@", choice), timeout: 3))
    }

    /// The average lightness, 0 to 1, of what the screen shows inside `element`.
    private func lightness(_ app: XCUIApplication, of element: XCUIElement) -> Double {
        let image = app.screenshot().image
        guard let cg = image.cgImage else { return -1 }
        let scale = Double(cg.width) / Double(image.size.width)
        let frame = element.frame.insetBy(dx: 2, dy: 2)
        let rect = CGRect(
            x: frame.minX * scale, y: frame.minY * scale, width: frame.width * scale, height: frame.height * scale
        ).integral.intersection(CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
        guard let crop = cg.cropping(to: rect) else { return -1 }
        // Drawn down to one pixel, the region's mean colour.
        var pixel = [UInt8](repeating: 0, count: 4)
        let context = CGContext(
            data: &pixel, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        context?.interpolationQuality = .medium
        context?.draw(crop, in: CGRect(x: 0, y: 0, width: 1, height: 1))
        return (0.2126 * Double(pixel[0]) + 0.7152 * Double(pixel[1]) + 0.0722 * Double(pixel[2])) / 255
    }

    /// The row ids in the order the list shows them, read while scrolling down.
    private func order(_ app: XCUIApplication, _ ids: [String]) -> [String] {
        var seen: [String] = []
        for _ in 0..<8 {
            let shown = ids.filter { !seen.contains($0) && element(app, $0).exists && element(app, $0).isHittable }
            seen += shown.sorted { element(app, $0).frame.minY < element(app, $1).frame.minY }
            if seen.count == ids.count { break }
            app.swipeUp(velocity: .slow)
        }
        return seen
    }

    private static let unitsFooter = "Belay garde tout en kilos\u{202F}: changer d’unité ne touche à aucune saisie."
    private static let silentFooter =
        "En mode silencieux, iOS coupe le son de l’alerte quand Belay n’est pas à l’écran."

    func testSectionsInOrder() {
        let app = launch("fresh")
        reglages(app)
        let rows = [
            "reglages-language", "reglages-theme", "reglages-weight-unit", "reglages-trend", "reglages-pause",
            "reglages-rest-sound", "reglages-history", "reglages-volume", "reglages-pill", "reglages-intake",
            "reglages-one-rep-max", "reglages-sources",
        ]
        XCTAssertEqual(
            order(app, rows + ["signout"]), rows + ["signout"], "Général, Unités, Accueil, Séances, Corps, Outils")
        for header in ["Général", "Unités", "Accueil", "Séances", "Corps", "Outils"] {
            XCTAssertTrue(app.swipeDownUntil(app.staticTexts[header].firstMatch) || app.swipeUpUntil(app.staticTexts[header].firstMatch), "the section \(header)")
        }
        XCTAssertFalse(app.staticTexts["Prototype seulement"].exists, "no prototype row")
        XCTAssertFalse(app.staticTexts["Mensurations et taille"].exists, "no length unit")
    }

    /// The weight unit as kg | lb in the « Poids » row, kilos by default, said as words, and kept
    /// after a relaunch.
    func testUnitSegmentKeptAfterRelaunch() {
        let app = launch("fresh")
        reglages(app)
        let row = reach(app, "reglages-weight-unit")
        XCTAssertTrue(app.staticTexts[Self.unitsFooter].exists, "the footer says nothing typed changes")
        let segment = row.segmentedControls.firstMatch
        XCTAssertTrue(segment.exists, "a segmented control in the row")
        XCTAssertEqual(segment.label, "Poids")
        XCTAssertTrue(row.frame.contains(segment.frame), "inside the row")
        XCTAssertGreaterThan(segment.frame.midX, row.frame.midX, "at the row's trailing edge")
        XCTAssertEqual(segment.buttons.allElementsBoundByIndex.map(\.label), ["kilos", "livres"])
        XCTAssertTrue(segment.buttons["kilos"].isSelected, "kilos by default")
        segment.buttons["livres"].tap()
        XCTAssertTrue(segment.buttons["livres"].waitFor(NSPredicate(format: "isSelected == true"), timeout: 3))

        let again = launch("keep")
        reglages(again)
        let kept = reach(again, "reglages-weight-unit").segmentedControls.firstMatch
        XCTAssertTrue(kept.buttons["livres"].isSelected, "pounds after a relaunch")
        XCTAssertFalse(kept.buttons["kilos"].isSelected)
    }

    func testRestSoundMenuStartsOnDiscret() {
        let app = launch("fresh")
        reglages(app)
        let row = reach(app, "reglages-rest-sound")
        XCTAssertTrue(row.label.hasPrefix("Son de fin de repos"), row.label)
        XCTAssertTrue(row.label.contains("Discret"), "Discret by default: \(row.label)")
        XCTAssertTrue(app.staticTexts[Self.silentFooter].exists, "the footer says what silent mode does")
        row.tap()
        for choice in ["Coupé", "Discret", "Toujours"] {
            XCTAssertTrue(app.buttons[choice].firstMatch.waitForExistence(timeout: 3), "the menu offers « \(choice) »")
        }
        app.buttons["Coupé"].firstMatch.tap()
        XCTAssertTrue(element(app, "reglages-rest-sound").waitFor(NSPredicate(format: "label CONTAINS 'Coupé'"), timeout: 3))

        let again = launch("keep")
        reglages(again)
        XCTAssertTrue(reach(again, "reglages-rest-sound").label.contains("Coupé"), "kept after a relaunch")
    }

    func testHistoryMenuStartsWithActivities() {
        let app = launch("fresh")
        reglages(app)
        let row = reach(app, "reglages-history")
        XCTAssertTrue(row.label.hasPrefix("Historique"), row.label)
        XCTAssertTrue(row.label.contains("Avec activités"), "with activities by default: \(row.label)")
        choose(app, "reglages-history", "Séances seules")
    }

    /// Tes semaines, from Corps.
    private func weeks(_ app: XCUIApplication) {
        app.tab("Corps")
        if app.navigationBars["Ta tendance"].exists { return }
        let row = element(app, "corps-weeks")
        XCTAssertTrue(app.swipeUpUntil(row), "the row Tes semaines")
        row.tap()
        XCTAssertTrue(app.navigationBars["Ta tendance"].waitForExistence(timeout: 5))
    }

    /// The week lines' labels, read from the newest while scrolling down.
    private func weekLabels(_ app: XCUIApplication) -> [String] {
        XCTAssertTrue(app.swipeDownUntil(element(app, "week-0")) || app.swipeUpUntil(element(app, "week-0")))
        var labels: [String] = []
        for index in 0..<8 {
            let week = element(app, "week-\(index)")
            guard app.swipeUpUntil(week) else { break }
            labels.append(week.label)
        }
        return labels
    }

    func testApportsSwitchAddsWeekKcal() {
        let app = launch("bodyUsual")
        weeks(app)
        let shown = weekLabels(app)
        XCTAssertGreaterThan(shown.count, 1, "the weeks show")
        XCTAssertNotNil(
            shown[0].range(of: "1.850\u{202F}kcal", options: .regularExpression),
            "this week's average calories: \(shown[0])")
        XCTAssertFalse(shown.dropFirst().contains { $0.contains("kcal") }, "a week without calories adds nothing")

        app.tab("Accueil")
        reglages(app)
        switchOff(app, "reglages-intake")
        back(app)
        weeks(app)
        let hidden = weekLabels(app)
        XCTAssertEqual(hidden.count, shown.count)
        XCTAssertFalse(hidden.contains { $0.contains("kcal") }, "no week shows calories: \(hidden)")
    }

    func testNoCompactTitle() {
        let app = launch("fresh")
        reglages(app)
        XCTAssertGreaterThan(app.largeTitleHeight("Réglages"), 30, "a large title")
        app.swipeUp()
        let inBar = app.navigationBars.staticTexts.matching(NSPredicate(format: "label == 'Réglages'"))
            .allElementsBoundByIndex.contains { $0.isHittable && $0.frame.width > 2 }
        XCTAssertFalse(inBar, "no compact title once the list has scrolled")
    }

    func testAx3StacksValues() {
        let app = launch("fresh", extra: Self.ax3)
        reglages(app)
        // A one-word switch row holds one line; a choice row with its value under the name, two.
        // Read in the list's order, each row as it comes into reach.
        var heights: [String: CGFloat] = [:]
        for (id, value) in [
            ("reglages-theme", "Système"), ("reglages-trend", nil), ("reglages-pause", "Tout s’arrête"),
            ("reglages-one-rep-max", "Deux formules"),
        ] as [(String, String?)] {
            let row = reach(app, id)
            if let value { XCTAssertTrue(row.label.contains(value), "\(id) says its value: \(row.label)") }
            heights[id] = row.frame.height
        }
        let line = heights["reglages-trend"] ?? 0
        for id in ["reglages-theme", "reglages-pause", "reglages-one-rep-max"] {
            XCTAssertGreaterThan(heights[id] ?? 0, line * 1.5, "\(id)'s value under its name, against \(line)")
        }
    }

    // MARK: A5

    /// One refusal of each kind the phone now writes, listed first in the web's words, then gone
    /// once the list is cleared.
    func testRefusedListedFirstAndCleared() {
        let app = launch("refused")
        reglages(app)
        let first = element(app, "rejected-0")
        XCTAssertTrue(first.waitForExistence(timeout: 5), "the refusals show")
        XCTAssertLessThan(first.frame.minY, element(app, "reglages-profile").frame.minY, "before the profile cell")
        XCTAssertTrue(app.staticTexts["Saisies refusées"].exists)
        let day = frenchDayMonth(0)
        let expected = [
            "Profil\u{202F}: taille", "Fourchette de perte", "Complément\u{202F}: Magnésium", "Activité du \(day)",
            "Pas du \(day)",
        ]
        for (index, words) in expected.enumerated() {
            let row = element(app, "rejected-\(index)")
            XCTAssertTrue(app.swipeUpUntil(row), "refusal \(index)")
            XCTAssertTrue(row.label.contains(words), "« \(words) » in \(row.label)")
            XCTAssertTrue(row.label.contains("Refusée par le serveur"), row.label)
        }
        XCTAssertTrue(
            app.staticTexts[
                "Le serveur les a refusées\u{202F}: elles ne sont plus en attente. Saisis-les à nouveau si besoin."
            ].exists, "the web's note")
        app.buttons["rejected-clear"].tap()
        XCTAssertFalse(element(app, "rejected-0").waitForExistence(timeout: 2), "the list is emptied")
        XCTAssertFalse(app.staticTexts["Saisies refusées"].exists)
    }

    /// A refusal a sync records while Réglages is open shows there, and « Effacer la liste »
    /// forgets what it shows.
    func testRefusalRecordedWhileOpenShows() {
        let app = launch("refused", extra: ["-BelayPull", "refusal"])
        reglages(app)
        XCTAssertTrue(element(app, "rejected-4").waitForExistence(timeout: 5), "the five refusals show")
        XCTAssertFalse(element(app, "rejected-5").exists)
        XCUIDevice.shared.press(.home)
        app.activate()
        let weighIn = element(app, "rejected-5")
        XCTAssertTrue(weighIn.waitForExistence(timeout: 5), "the refusal recorded meanwhile shows")
        XCTAssertTrue(weighIn.label.contains("Pesée du \(frenchDayMonth(0))"), weighIn.label)
        XCTAssertTrue(app.swipeUpUntil(app.buttons["rejected-clear"]))
        app.buttons["rejected-clear"].tap()
        XCTAssertFalse(element(app, "rejected-0").waitForExistence(timeout: 2), "the list is emptied")
    }

    // MARK: A27

    func testThemeReachesSheetAndAlert() {
        let app = launch("bodyUsual")
        reglages(app)
        choose(app, "reglages-theme", "Sombre")
        back(app)
        let weighIn = element(app, "today.weighIn")
        XCTAssertTrue(app.swipeUpUntil(weighIn))
        weighIn.tap()
        let title = app.sheetTitle("Pesée")
        XCTAssertTrue(title.waitForExistence(timeout: 5), "the weigh-in sheet opens")
        XCTAssertLessThan(lightness(app, of: title), 0.35, "the sheet is dark")

        // The sign-out question, on a launch that keeps the choice: nothing to put away first.
        let again = launch("keep")
        reglages(again)
        reach(again, "signout").tap()
        let confirm = again.buttons["signout-confirm"].firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 3))
        XCTAssertLessThan(lightness(again, of: confirm), 0.35, "the sign-out question is dark")
    }

    func testThemeKeptAfterRelaunch() {
        let app = launch("fresh")
        reglages(app)
        let theme = reach(app, "reglages-theme")
        XCTAssertTrue(theme.label.contains("Système"), "Système by default: \(theme.label)")
        XCTAssertGreaterThan(lightness(app, of: theme), 0.6, "the simulator's light appearance")
        choose(app, "reglages-theme", "Sombre")
        XCTAssertLessThan(lightness(app, of: element(app, "reglages-theme")), 0.35, "dark at once")

        let again = launch("keep")
        reglages(again)
        let kept = reach(again, "reglages-theme")
        XCTAssertTrue(kept.label.contains("Sombre"), kept.label)
        XCTAssertLessThan(lightness(again, of: kept), 0.35, "still dark after a relaunch")
    }

    // MARK: A28

    func testLanguageRowOpensSettings() {
        let app = launch("fresh")
        reglages(app)
        let row = reach(app, "reglages-language")
        XCTAssertTrue(row.label.contains("Français"), row.label)
        XCTAssertTrue(
            app.staticTexts["La langue se choisit dans les Réglages de l’iPhone, comme pour toute app."].exists,
            "the footer says where the language is chosen")
        row.tap()
        let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
        XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 10), "the iPhone's Réglages open")
        settings.terminate()
    }

    func testAppDeclaresFrenchAndEnglish() {
        let app = launch("fresh", english: true)
        reglages(app, title: "Settings")
        XCTAssertTrue(reach(app, "reglages-language").label.contains("English"), "Belay runs in English")
    }

    // MARK: A32

    func testTrendRowHidesCard() {
        let app = launch("bodyUsual")
        XCTAssertTrue(element(app, "accueil-trend").waitForExistence(timeout: 10), "the trend card shows")
        reglages(app)
        switchOff(app, "reglages-trend")
        back(app)
        XCTAssertTrue(element(app, "today.weighIn").waitForExistence(timeout: 5), "back on Accueil")
        XCTAssertFalse(element(app, "accueil-trend").exists, "no trend card")
    }

    func testPauseRowKeepsRestRunning() {
        let app = launch("lockLogged")
        reglages(app)
        choose(app, "reglages-pause", "Le repos continue")
        back(app)
        let resume = app.buttons["Reprendre"]
        XCTAssertTrue(resume.waitForExistence(timeout: 5), "the session is open")
        resume.tap()
        XCTAssertTrue(element(app, "rest-clock").waitForExistence(timeout: 5), "a rest runs")
        app.buttons["Mettre la séance en pause"].tap()
        XCTAssertTrue(app.staticTexts["En pause"].waitForExistence(timeout: 3))
        let rest = element(app, "paused-rest")
        XCTAssertTrue(rest.waitForExistence(timeout: 3), "the rest shows through the pause")
        let before = rest.label
        XCTAssertTrue(rest.waitFor(NSPredicate(format: "label != %@", before), timeout: 4), "and keeps counting")
        XCTAssertTrue(rest.label.hasPrefix("Le repos continue"), rest.label)
    }

    func testVolumeRowHidesVolume() {
        let app = launch("pastSession")
        reglages(app)
        switchOff(app, "reglages-volume")
        back(app)
        app.tab("Séances")
        let segment = app.segmentedControls.firstMatch.buttons["Historique"]
        XCTAssertTrue(segment.waitForExistence(timeout: 5))
        segment.tap()
        let row = app.descendants(matching: .any).matching(identifier: "history.row").firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertFalse(row.label.contains("kg"), "the history leaves the volume out: \(row.label)")
        row.tap()
        XCTAssertTrue(element(app, "past.duration").waitForExistence(timeout: 5), "the past session opens")
        XCTAssertFalse(element(app, "past.volume").exists, "the past session leaves it out")

        let summary = launch("finished", extra: ["-belay.sessionVolume", "hidden"])
        summary.buttons["Reprendre"].firstMatch.tap()
        summary.finishSession()
        XCTAssertTrue(element(summary, "summary-sets").waitForExistence(timeout: 5), "the summary shows")
        XCTAssertFalse(element(summary, "summary-volume").exists, "the summary leaves it out")
    }

    func testPillRowKeepsFigure() {
        let app = launch("bodyUsual")
        XCTAssertTrue(element(app, "accueil-trend").waitForExistence(timeout: 10))
        XCTAssertTrue(element(app, "trend-range").exists, "the pill shows in range")
        reglages(app)
        switchOff(app, "reglages-pill")
        back(app)
        XCTAssertTrue(element(app, "accueil-trend").waitForExistence(timeout: 5))
        XCTAssertFalse(element(app, "trend-range").exists, "no pill on Accueil")
        XCTAssertTrue(element(app, "accueil-trend").label.contains("kilos"), "the figure stays")
        app.tab("Corps")
        XCTAssertTrue(element(app, "trend-change").waitForExistence(timeout: 5), "Corps's figure stays")
        XCTAssertFalse(element(app, "trend-range").exists, "no pill on Corps")
    }

    func testOneRepMaxRowEpleyOnly() {
        let app = launch("tools")
        reglages(app)
        choose(app, "reglages-one-rep-max", "Epley seule")
        back(app)
        app.tab("Outils")
        reach(app, "tool-row-one-rep-max").tap()
        XCTAssertTrue(element(app, "tool-header").waitForExistence(timeout: 5))
        reach(app, "tool-field-load").tap()
        for key in ["8", "0"] { app.keys[key].tap() }
        app.buttons["Ajouter une répétition"].tap()
        XCTAssertEqual(element(app, "tool-figure-epley").label, "Epley, 96 kilos")
        XCTAssertFalse(element(app, "tool-figure-brzycki").exists, "Brzycki is left out")
    }

    func testSourceRowHidesLines() {
        let app = launch("tools")
        reglages(app)
        switchOff(app, "reglages-sources")
        back(app)
        app.tab("Outils")
        reach(app, "tool-row-energy").tap()
        XCTAssertTrue(element(app, "tool-figure-energy").waitForExistence(timeout: 5), "still prefilled")
        XCTAssertEqual(app.staticTexts.matching(identifier: "tool-source").count, 0, "no source line")
    }
}

extension XCUIApplication {
    /// Swipes down until `target` shows, or gives up.
    func swipeDownUntil(_ target: XCUIElement, swipes: Int = 8) -> Bool {
        for _ in 0..<swipes {
            if target.exists && target.isHittable { return true }
            swipeDown(velocity: .slow)
        }
        return target.exists && target.isHittable
    }
}
