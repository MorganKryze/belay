import XCTest

extension XCUIApplication {
    /// The app launched on the fixture mode `fixture`, in French unless `english`; `now` sets its
    /// clock, a local `yyyy-MM-ddTHH:mm:ss`; `health` stands in for Health's answer, `allowed` or
    /// `refused`; `pull` lands a sync as the app goes to the background, `range`, `height` or
    /// `refusal`.
    static func fixture(
        _ fixture: String, largestText: Bool = false, now: String? = nil, english: Bool = false,
        health: String? = nil, pull: String? = nil
    ) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments =
            english
            ? ["-AppleLanguages", "(en)", "-AppleLocale", "en_US", "-BelayFixture", fixture]
            : ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if let now { app.launchArguments += ["-BelayNow", now] }
        if let health { app.launchArguments += ["-BelayHealth", health] }
        if let pull { app.launchArguments += ["-BelayPull", pull] }
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launchFixture()
        return app
    }

    /// The app on `fixture`, in French, with the device in `appearance` and the text at the
    /// system's default size or, `largest`, at AX5, the largest of the accessibility sizes.
    static func fixture(
        _ fixture: String, appearance: XCUIDevice.Appearance, largest: Bool
    ) -> XCUIApplication {
        XCUIDevice.shared.appearance = appearance
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture]
        if largest {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL"]
        }
        app.launchFixture()
        return app
    }

    /// Accueil's « Voir la séance », then the preview of session `title`.
    func openPreview(_ title: String = "Séance A", file: StaticString = #filePath, line: UInt = #line) {
        let open = buttons["Voir la séance"]
        XCTAssertTrue(open.waitForExistence(timeout: 10), "Accueil offers the session", file: file, line: line)
        open.tap()
        XCTAssertTrue(navigationBars[title].waitForExistence(timeout: 5), "the preview opens", file: file, line: line)
    }

    /// Réglages, from Accueil's avatar.
    func openReglages(file: StaticString = #filePath, line: UInt = #line) {
        let settings = buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "Accueil leads to Réglages", file: file, line: line)
        settings.tap()
        XCTAssertTrue(navigationBars["Réglages"].waitForExistence(timeout: 5), "Réglages opens", file: file, line: line)
    }

    /// Séances' Historique.
    func openHistory(file: StaticString = #filePath, line: UInt = #line) {
        tab("Séances")
        let segment = segmentedControls.firstMatch.buttons["Historique"]
        XCTAssertTrue(segment.waitForExistence(timeout: 5), "Séances shows Historique", file: file, line: line)
        segment.tap()
    }

    /// Outils' tool `id`, once its header shows.
    func openTool(_ id: String, file: StaticString = #filePath, line: UInt = #line) {
        tab("Outils")
        let row = descendants(matching: .any)["tool-row-\(id)"].firstMatch
        XCTAssertTrue(swipeUpUntil(row), "the row \(id) is reached", file: file, line: line)
        row.tap()
        XCTAssertTrue(
            descendants(matching: .any)["tool-header"].firstMatch.waitForExistence(timeout: 5), "the tool opens",
            file: file, line: line)
    }

    /// The height of the large title `title` as drawn, 0 when it is not: above 30 pt it is large.
    func largeTitleHeight(_ title: String) -> CGFloat {
        navigationBars[title].staticTexts.matching(NSPredicate(format: "label == %@", title))
            .allElementsBoundByIndex.filter { $0.frame.width > 2 }.map(\.frame.height).max() ?? 0
    }

    /// A sheet's title, the first row of its list: no sheet here has a bar.
    func sheetTitle(_ label: String) -> XCUIElement {
        descendants(matching: .any).matching(NSPredicate(format: "identifier == 'sheet-title' AND label == %@", label))
            .firstMatch
    }

    /// From the foot of the large title `title` to the top of `line`, in points.
    func gapUnderTitle(_ title: String, to line: XCUIElement) -> CGFloat {
        let large = navigationBars[title].staticTexts.matching(NSPredicate(format: "label == %@", title))
            .allElementsBoundByIndex.filter { $0.frame.width > 2 }.map(\.frame.maxY).max() ?? 0
        return line.frame.minY - large
    }

    /// From the leading edge of the large title `title` to that of `line`, in points.
    func indentFromTitle(_ title: String, to line: XCUIElement) -> CGFloat {
        let large = navigationBars[title].staticTexts.matching(NSPredicate(format: "label == %@", title))
            .allElementsBoundByIndex.filter { $0.frame.width > 2 }.map(\.frame.minX).min() ?? 0
        return line.frame.minX - large
    }
}

extension XCUIElement {
    /// Whether the element comes to read `label` within `timeout` seconds.
    func comesToRead(_ label: String, timeout: TimeInterval = 3) -> Bool {
        waitFor(NSPredicate(format: "label == %@", label), timeout: timeout)
    }
}

/// « 24 octobre », the day `offset` days from today as the app writes it in a sentence.
func frenchDayMonth(_ offset: Int) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "fr_FR")
    formatter.dateFormat = "d MMMM"
    return formatter.string(from: Calendar.current.date(byAdding: .day, value: offset, to: .now) ?? .now)
}

/// The French name of the weekday `offset` days from `day`, as the app writes it in a sentence.
func frenchWeekday(_ offset: Int, from day: Date = .now) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "fr_FR")
    formatter.dateFormat = "EEEE"
    return formatter.string(from: Calendar.current.date(byAdding: .day, value: offset, to: day) ?? day)
}
