import XCTest

extension XCUIApplication {
    /// A sheet's title, the first row of its list: no sheet here has a bar.
    func sheetTitle(_ label: String) -> XCUIElement {
        descendants(matching: .any).matching(NSPredicate(format: "identifier == 'sheet-title' AND label == %@", label))
            .firstMatch
    }
}

/// The French name of the weekday `offset` days from `day`, as the app writes it in a sentence.
func frenchWeekday(_ offset: Int, from day: Date = .now) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "fr_FR")
    formatter.dateFormat = "EEEE"
    return formatter.string(from: Calendar.current.date(byAdding: .day, value: offset, to: day) ?? day)
}
