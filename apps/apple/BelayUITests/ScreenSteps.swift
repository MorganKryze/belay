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
