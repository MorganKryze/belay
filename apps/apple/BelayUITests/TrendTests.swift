import XCTest

/// Ta tendance and its weeks on the fixture's `trend` mode: five weeks of weigh-ins losing 0,1 kg a
/// day, today's at 79,9 kg, creatine ticked every day of the last 23, a « Semaine allégée » from
/// 19 days back and a « Note · voyage » 9 days back.
@MainActor
final class TrendTests: XCTestCase {
    /// Launches on `fixture`, opens Corps, then Ta tendance through « Tes semaines ».
    private func trend(_ fixture: String = "trend", largestText: Bool = false) -> XCUIApplication {
        let app = XCUIApplication.fixture(fixture, largestText: largestText)
        let tab = app.tabBars.firstMatch.buttons["Corps"]
        XCTAssertTrue(tab.waitForExistence(timeout: 10))
        tab.tap()
        let row = element(app, "corps-weeks")
        XCTAssertTrue(app.swipeUpUntil(row), "the row Tes semaines")
        row.tap()
        XCTAssertTrue(app.navigationBars["Ta tendance"].waitForExistence(timeout: 5), "Ta tendance is native")
        return app
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// The span's segment named `name` tapped.
    private func pick(_ app: XCUIApplication, _ name: String) {
        app.segmentedControls["trend-span"].buttons[name].tap()
    }

    /// CO22: S, M and A each draw their own days' weigh-ins.
    func testSpansChangeTheCurve() {
        let app = trend()
        let chart = element(app, "trend-chart")
        XCTAssertTrue(chart.waitForExistence(timeout: 5))
        XCTAssertEqual(chart.value as? String, "30 pesées", "M: the last 30 days")
        pick(app, "Semaine")
        XCTAssertTrue(chart.waitFor(NSPredicate(format: "value == %@", "7 pesées")), "S: the last 7 days")
        pick(app, "Année")
        XCTAssertTrue(chart.waitFor(NSPredicate(format: "value == %@", "35 pesées")), "A: every weigh-in of the year")
    }

    /// CO22: a tap, then a drag on the curve reads the day's weigh-in and average.
    func testSelectionReadsDay() {
        let app = trend()
        pick(app, "Semaine")
        let chart = element(app, "trend-chart")
        XCTAssertTrue(chart.waitForExistence(timeout: 5))
        let pattern = ".*Pesée [0-9]+,[0-9] kilos · Moyenne 7 j [0-9]+,[0-9] kilos"
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5)).tap()
        XCTAssertTrue(chart.waitFor(NSPredicate(format: "value MATCHES %@", pattern)), "a tap reads a day: \(chart.value ?? "")")
        let first = chart.value as? String
        chart.coordinate(withNormalizedOffset: CGVector(dx: 0.3, dy: 0.5))
            .press(forDuration: 0.4, thenDragTo: chart.coordinate(withNormalizedOffset: CGVector(dx: 0.85, dy: 0.5)))
        XCTAssertTrue(chart.waitFor(NSPredicate(format: "value MATCHES %@", pattern)), "a drag reads a day")
        XCTAssertNotEqual(chart.value as? String, first, "the drag moved to another day")
    }

    /// CO22, R14: the band covers creatine's 14 days from its first tick, and the legend names
    /// each mark in words.
    func testCreatineBandAndLegend() {
        let app = trend()
        let creatine = element(app, "legend-creatine")
        XCTAssertTrue(creatine.waitForExistence(timeout: 5))
        XCTAssertEqual(creatine.label, "Créatine, du \(frenchDayMonth(-22)) au \(frenchDayMonth(-9))")
        for (id, words) in [("legend-day", "Pesée du jour"), ("legend-average", "Moyenne 7 jours")] {
            XCTAssertEqual(element(app, id).label, words)
        }
    }

    /// CO22, CO24: each annotation is drawn, named in the legend, and marks its week.
    func testAnnotationMarked() {
        let app = trend()
        let legend = element(app, "legend-annotation")
        XCTAssertTrue(legend.waitForExistence(timeout: 5))
        XCTAssertEqual(legend.label, "2 annotations")
        let deload = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH 'week-' AND label CONTAINS 'allégée'")
        ).firstMatch
        XCTAssertTrue(app.swipeUpUntil(deload), "the deload's week reads « allégée »")
        let trip = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier BEGINSWITH 'week-' AND label CONTAINS 'voyage'")
        ).firstMatch
        XCTAssertTrue(trip.exists, "the note's week reads its word")
    }

    /// CO22: VoiceOver reads the chart as one summary naming the span and the latest average.
    func testChartSummaryLabel() {
        let app = trend()
        let chart = element(app, "trend-chart")
        XCTAssertTrue(chart.waitForExistence(timeout: 5))
        XCTAssertEqual(chart.label, "Moyenne 7 jours et pesées, mois, 80,2 kilos")
        pick(app, "Année")
        XCTAssertTrue(chart.waitFor(NSPredicate(format: "label == %@", "Moyenne 7 jours et pesées, année, 80,2 kilos")))
    }

    /// CO23: the range pill opens « Comment c'est calculé » with the shared catalogue's words.
    func testPillOpensScience() throws {
        let app = trend()
        let pill = element(app, "trend-range")
        XCTAssertTrue(pill.waitForExistence(timeout: 5))
        pill.tap()
        XCTAssertTrue(app.navigationBars["Comment c’est calculé"].waitForExistence(timeout: 5))
        let url = URL(filePath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appending(path: "BelayCore/Sources/BelayCore/Resources/science.json")
        let catalogue = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        let entry = try XCTUnwrap(
            ((catalogue["target-rate"] as? [String: Any])?["content"] as? [String: Any])?["fr"] as? [String: Any])
        XCTAssertEqual(element(app, "science-brief").label, entry["brief"] as? String)
        let lines = [("formula", entry["formula"]), ("limit", entry["limits"])]
        for (kind, list) in lines {
            for (index, line) in ((list as? [String]) ?? []).enumerated() {
                let text = element(app, "science-\(kind)-\(index)")
                XCTAssertTrue(app.swipeUpUntil(text), "\(kind) \(index) shows")
                XCTAssertEqual(text.label, line)
            }
        }
        let source = element(app, "science-source-0")
        XCTAssertTrue(app.swipeUpUntil(source))
        XCTAssertTrue(source.label.hasPrefix("Helms et al. 2014"), source.label)
    }

    /// CO24: newest week first, the running one « à suivre », each with its loss, weigh-ins and
    /// range in words, then the footer and « Ajouter une annotation ».
    func testWeeksWordsAndCurrent() {
        let app = trend()
        let current = element(app, "week-0")
        XCTAssertTrue(app.swipeUpUntil(current))
        XCTAssertTrue(current.label.hasPrefix("Cette semaine"), current.label)
        XCTAssertTrue(current.label.contains("à suivre"), current.label)
        XCTAssertTrue(current.label.contains(" pesée"), current.label)
        let last = element(app, "week-1")
        XCTAssertTrue(app.swipeUpUntil(last))
        XCTAssertTrue(
            last.label.range(of: "perte [0-9],[0-9]\u{202F}%", options: .regularExpression) != nil, last.label)
        XCTAssertTrue(last.label.contains("7 pesées · "), last.label)
        XCTAssertTrue(
            last.label.contains("dans ta fourchette") || last.label.contains("hors de ta fourchette, 0,5 à 1\u{202F}%"),
            last.label)
        let footer = app.staticTexts["Ta fourchette se règle dans ton profil, de 0,25 à 1\u{202F}% par semaine."]
        XCTAssertTrue(app.swipeUpUntil(footer))
        XCTAssertTrue(app.swipeUpUntil(element(app, "trend-annotate")))
    }

    /// CO25: « Ajouter une annotation » writes one; the row opens it to edit, then to remove.
    func testAddEditRemoveAnnotation() {
        let app = trend()
        let add = element(app, "trend-annotate")
        XCTAssertTrue(app.swipeUpUntil(add))
        add.tap()
        XCTAssertTrue(app.sheetTitle("Annotation").waitForExistence(timeout: 5))
        XCTAssertTrue(element(app, "annotation-save").isEnabled, "a deload needs no label")
        element(app, "annotation-kind").tap()
        app.buttons["Pause diète"].firstMatch.tap()
        let label = element(app, "annotation-label")
        label.tap()
        label.typeText("vacances")
        element(app, "annotation-save").tap()
        let row = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pause diète · vacances'")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue(app.swipeUpUntil(row))

        row.tap()
        XCTAssertTrue(app.sheetTitle("Annotation").waitForExistence(timeout: 5))
        XCTAssertEqual(element(app, "annotation-label").value as? String, "vacances", "the sheet opens on it")
        element(app, "annotation-kind").tap()
        app.buttons["Note"].firstMatch.tap()
        element(app, "annotation-save").tap()
        let edited = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Note · vacances'")).firstMatch
        XCTAssertTrue(edited.waitForExistence(timeout: 5))
        XCTAssertFalse(row.exists, "edited in place, not added")

        XCTAssertTrue(app.swipeUpUntil(edited))
        edited.tap()
        let delete = element(app, "annotation-delete")
        XCTAssertTrue(delete.waitForExistence(timeout: 5))
        delete.tap()
        app.buttons["Supprimer"].firstMatch.tap()
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: edited)
        XCTAssertEqual(XCTWaiter().wait(for: [gone], timeout: 5), .completed, "removed")
    }

    /// CO36: Ta tendance and « Comment c'est calculé » open on their large titles.
    func testPushOpensOnLargeTitle() {
        let app = trend()
        XCTAssertGreaterThan(app.largeTitleHeight("Ta tendance"), 30, "Ta tendance opens large")
        element(app, "trend-range").tap()
        XCTAssertTrue(app.navigationBars["Comment c’est calculé"].waitForExistence(timeout: 5))
        XCTAssertGreaterThan(app.largeTitleHeight("Comment c’est calculé"), 30, "the page opens large")
    }

    /// CO22, CO24 at AX3: the span and the legend stay whole, every week and the add row can be
    /// reached and stay inside the screen.
    func testAx3Trend() {
        let app = trend(largestText: true)
        let window = app.windows.firstMatch.frame
        let span = app.segmentedControls["trend-span"]
        XCTAssertTrue(app.swipeUpUntil(span))
        XCTAssertLessThanOrEqual(span.frame.maxX, window.maxX, "the span is whole")
        for id in ["legend-day", "legend-average", "legend-creatine", "legend-annotation", "week-0", "week-1", "trend-annotate"] {
            let item = element(app, id)
            XCTAssertTrue(app.swipeUpUntil(item, swipes: 14), "\(id) can be reached")
            XCTAssertLessThanOrEqual(item.frame.maxX, window.maxX + 1, "\(id) is whole")
            XCTAssertGreaterThanOrEqual(item.frame.height, 20, "\(id) is readable")
        }
    }
}
