import XCTest

/// Énergie's and Corps's tools on the fixture: `toolsEmpty` opens every field empty, so the demo
/// inputs are typed through the keypad; `tools` holds a man born in 1990, 180 cm, a week of
/// weigh-ins averaging 80,1 kg and a waist of 84,5 cm, which the fields open on. Each figure is the
/// shared rule's on the inputs typed.
@MainActor
final class BodyToolsTests: XCTestCase {
    private func launch(_ fixture: String, largestText: Bool = false, arguments: [String] = []) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(fr)", "-AppleLocale", "fr_FR", "-BelayFixture", fixture] + arguments
        if largestText {
            app.launchArguments += ["-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL"]
        }
        app.launchFixture()
        return app
    }

    /// Opens Outils on `app`.
    private func outils(_ app: XCUIApplication) {
        app.tab("Outils")
        XCTAssertTrue(app.navigationBars["Outils"].waitForExistence(timeout: 5), "Outils is native")
    }

    /// Opens the tool `id` from Outils, and waits for its header.
    private func open(_ app: XCUIApplication, _ id: String) {
        let row = element(app, "tool-row-\(id)")
        XCTAssertTrue(app.swipeUpUntil(row), "the row \(id) is reached")
        row.tap()
        XCTAssertTrue(element(app, "tool-header").waitForExistence(timeout: 5), "the tool's page opens")
    }

    /// Back to Outils from a tool's page.
    private func back(_ app: XCUIApplication) {
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.navigationBars["Outils"].waitForExistence(timeout: 5))
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any)[id].firstMatch
    }

    /// Types `digits` on the decimal keypad into the field `id`, one key at a time.
    private func type(_ app: XCUIApplication, _ digits: String, into id: String) {
        let field = element(app, id)
        hideKeypad(app)
        XCTAssertTrue(app.swipeUpUntil(field), "\(id) is reached")
        field.tapAtEnd()
        for key in digits {
            let button = app.keys[String(key)]
            XCTAssertTrue(button.waitForExistence(timeout: 3), "the keypad shows « \(key) »")
            button.tap()
        }
    }

    /// Empties the field `id` with the keypad's delete key.
    private func clear(_ app: XCUIApplication, _ id: String) {
        let field = element(app, id)
        hideKeypad(app)
        XCTAssertTrue(app.swipeUpUntil(field), "\(id) is reached")
        field.tapAtEnd()
        let count = (field.value as? String)?.count ?? 0
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: count + 1))
    }

    private func hideKeypad(_ app: XCUIApplication) { app.putKeypadAway() }

    /// Picks `choice` in the segmented control `id`.
    private func choose(_ app: XCUIApplication, _ choice: String, in id: String) {
        let control = app.segmentedControls[id]
        hideKeypad(app)
        XCTAssertTrue(app.swipeUpUntil(control), "\(id) is reached")
        control.buttons[choice].tap()
    }

    /// Scrolls back to the top of the page, where the result is.
    private func toTop(_ app: XCUIApplication) {
        hideKeypad(app)
        for _ in 0..<4 { app.swipeDown(velocity: .fast) }
    }

    /// Picks the level `id` in « Ton activité » on the open Dépense énergétique.
    private func pickLevel(_ app: XCUIApplication, _ id: String) {
        let row = element(app, "tool-pal")
        hideKeypad(app)
        XCTAssertTrue(app.swipeUpUntil(row), "« Ton activité » is reached")
        row.tap()
        let level = element(app, "pal-\(id)")
        XCTAssertTrue(level.waitForExistence(timeout: 5), "the sheet lists the levels")
        level.tap()
        XCTAssertTrue(level.waitForNonExistence(timeout: 5), "one tap picks and closes")
    }

    /// Opens Apports from Corps, or brings it back if Corps still shows it.
    private func apports(_ app: XCUIApplication) -> XCUIElement {
        app.tab("Corps")
        let meter = element(app, "intake-kcal")
        if !meter.waitForExistence(timeout: 2) {
            let row = element(app, "today.intake")
            XCTAssertTrue(app.swipeUpUntil(row, swipes: 10), "Corps's Apports row is reached")
            row.tap()
        }
        XCTAssertTrue(meter.waitForExistence(timeout: 5), "Apports opens")
        return meter
    }

    /// A12, A17: homme, 34 ans, 178 cm, 80,2 kg, sédentaire give 2 710 kcal, 2 440 to 2 980, 1 750 at
    /// rest; « Ton activité » opens the four levels with their words, and one tap on « Actif » picks
    /// it, closes the sheet and gives 3 060 kcal.
    func testEnergyDemoAndPalSheet() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "energy")
        XCTAssertTrue(
            app.staticTexts["Il manque la formule, l’âge, la taille et le poids."].exists, "empty says what is missing")
        choose(app, "Homme", in: "tool-formula")
        type(app, "34", into: "tool-field-age")
        type(app, "178", into: "tool-field-height")
        type(app, "80,2", into: "tool-field-weight")
        toTop(app)
        let figure = element(app, "tool-figure-energy")
        XCTAssertTrue(figure.waitForExistence(timeout: 5))
        XCTAssertEqual(figure.label, "Dépense du jour, 2\u{202F}710\u{202F}kcal")
        XCTAssertTrue(app.staticTexts["entre 2\u{202F}440 et 2\u{202F}980 environ"].exists, "the ±10 % range")
        XCTAssertEqual(element(app, "tool-energy-bmr").label, "Dépense au repos, 1\u{202F}750\u{202F}kcal")

        let row = element(app, "tool-pal")
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertEqual(row.label, "Ton activité, Sédentaire / activité légère · 1,55")
        row.tap()
        for (id, words) in [
            ("very-sedentary", "Assis presque toute la journée, peu de marche."),
            ("sedentary", "Travail peu physique, sans exercice régulier."),
            ("active", "Sédentaire, plus environ une heure d’exercice modéré à soutenu par jour."),
            ("very-active", "Travail physique ou exercice intense une bonne partie de la journée."),
        ] {
            let level = element(app, "pal-\(id)")
            XCTAssertTrue(level.waitForExistence(timeout: 5), "\(id) is listed")
            XCTAssertTrue(level.label.contains(words), "\(id) says what it means: \(level.label)")
            XCTAssertGreaterThanOrEqual(level.frame.height, 44)
        }
        XCTAssertTrue(element(app, "pal-sedentary").isSelected, "the level in use is ticked")
        element(app, "pal-active").tap()
        XCTAssertTrue(element(app, "pal-active").waitForNonExistence(timeout: 5), "one tap picks and closes")
        XCTAssertEqual(row.label, "Ton activité, Actif · 1,75")
        toTop(app)
        XCTAssertEqual(figure.label, "Dépense du jour, 3\u{202F}060\u{202F}kcal")
    }

    /// A12, A18: maintien at 80,2 kg gives 110 to 160 g, 40 to 50 g over 3 meals, 30 to 40 g over 4;
    /// « Sèche » asks for the body fat, optional, and says what it takes without one.
    func testProteinRangeAndMeals() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "protein")
        XCTAssertTrue(app.segmentedControls["tool-goal"].buttons["Maintien"].isSelected, "maintien by default")
        type(app, "80,2", into: "tool-field-weight")
        toTop(app)
        XCTAssertEqual(element(app, "tool-figure-protein").label, "Par jour, 110 à 160\u{202F}g")
        XCTAssertEqual(element(app, "tool-meals-3").label, "Sur 3 repas, 40 à 50\u{202F}g")
        XCTAssertEqual(element(app, "tool-meals-4").label, "Sur 4 repas, 30 à 40\u{202F}g")
        XCTAssertFalse(element(app, "tool-field-fat").exists, "no body fat outside a cut")
        choose(app, "Sèche", in: "tool-goal")
        XCTAssertTrue(element(app, "tool-field-fat").waitForExistence(timeout: 3), "a cut asks for the body fat")
        let without = app.staticTexts.containing(
            NSPredicate(format: "label BEGINSWITH %@", "Sans masse grasse, Belay prend")
        ).firstMatch
        hideKeypad(app)
        XCTAssertTrue(app.swipeUpUntil(without), "and says what it takes without one")
        toTop(app)
        XCTAssertEqual(element(app, "tool-figure-protein").label, "Par jour, 145 à 200\u{202F}g")
    }

    /// A12, A19: 80,2 to 75 kg at « Équilibré » lands in 9 to 12 weeks; past 1 % and 1,5 % a week
    /// the web's warnings show in words.
    func testProjectionWarningsInWords() {
        let app = launch("toolsEmpty", arguments: ["-BelayNow", "2026-10-07T09:00:00"])
        outils(app)
        open(app, "projection")
        type(app, "80,2", into: "tool-field-weight")
        type(app, "75", into: "tool-field-target")
        toTop(app)
        let weeks = element(app, "tool-projection-weeks")
        XCTAssertTrue(weeks.waitForExistence(timeout: 5))
        XCTAssertTrue(weeks.label.hasPrefix("Dans 9 à 12 semaines."), weeks.label)
        XCTAssertEqual(element(app, "tool-projection-dates").label, "Entre le 9 décembre et le 30 décembre")
        XCTAssertTrue(element(app, "tool-projection-band").exists, "the month band")
        XCTAssertTrue(app.segmentedControls["tool-rate"].buttons["Équilibré"].isSelected)
        XCTAssertTrue(app.staticTexts["0,75\u{202F}% · 0,6\u{202F}kg par semaine"].exists, "the pace in kilos")
        let warning = element(app, "tool-rate-warning")
        choose(app, "Soutenu", in: "tool-rate")
        XCTAssertFalse(warning.exists, "1 % a week says nothing")
        let fine = app.buttons["Réglage fin"]
        XCTAssertTrue(app.swipeUpUntil(fine))
        fine.tap()
        let more = app.buttons["Ajouter 0,05\u{202F}%"]
        XCTAssertTrue(app.swipeUpUntil(more), "fine tuning by 0,05 %")
        more.tap()
        XCTAssertTrue(element(app, "tool-rate-pct").label.contains("1,05\u{202F}%"), element(app, "tool-rate-pct").label)
        XCTAssertTrue(warning.waitForExistence(timeout: 3), "past 1 %")
        XCTAssertTrue(warning.label.contains("Garthe 2011"), warning.label)
        for _ in 0..<10 { more.tap() }
        XCTAssertTrue(element(app, "tool-rate-pct").label.contains("1,55\u{202F}%"), element(app, "tool-rate-pct").label)
        XCTAssertEqual(
            warning.label, "À ce rythme, Belay te conseille de te faire suivre par un médecin ou un diététicien.")
        for _ in 0..<30 { if more.isEnabled { more.tap() } }
        XCTAssertTrue(element(app, "tool-rate-pct").label.contains("2,5\u{202F}%"), "up to 2,5 %")
        XCTAssertFalse(more.isEnabled, "no faster than 2,5 %")
    }

    /// A12, A20: 178 cm and 80,2 kg give 25,3, in « Au-dessus » with the « toi » pill.
    func testBmiBandAndToi() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "bmi")
        XCTAssertTrue(app.staticTexts["Entre ta taille et ton poids."].exists)
        type(app, "178", into: "tool-field-height")
        type(app, "80,2", into: "tool-field-weight")
        toTop(app)
        XCTAssertEqual(element(app, "tool-figure-bmi").label, "Ton IMC, 25,3")
        XCTAssertTrue(app.staticTexts["Au-dessus de la plage de référence de l’OMS (25 à 30)."].exists)
        XCTAssertFalse(element(app, "tool-bmi-professional").exists)
        let above = element(app, "band-above")
        XCTAssertTrue(app.swipeUpUntil(above))
        XCTAssertTrue(above.label.contains("toi"), "the person's band says « toi »: \(above.label)")
        XCTAssertTrue(above.label.contains("25 – 30"), above.label)
        for other in ["band-below", "band-reference", "band-well-above"] {
            XCTAssertFalse(element(app, other).label.contains("toi"), "\(other) is not the person's")
        }
    }

    /// A20: under 18,5 the web's line suggests a professional.
    func testBmiSuggestsProfessional() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "bmi")
        type(app, "178", into: "tool-field-height")
        type(app, "50", into: "tool-field-weight")
        toTop(app)
        XCTAssertEqual(element(app, "tool-figure-bmi").label, "Ton IMC, 15,8")
        XCTAssertEqual(
            element(app, "tool-bmi-professional").label,
            "Si tu te poses des questions sur ton poids, parles-en à un professionnel de santé.")
        let below = element(app, "band-below")
        XCTAssertTrue(app.swipeUpUntil(below))
        XCTAssertTrue(below.label.contains("toi"), below.label)
    }

    /// A12, A21: homme, 34 ans, cou 38, taille 84,5, 178 cm give 16 %, in the reference band of
    /// 20 to 39; the female formula asks for the hips before it gives a figure.
    func testBodyFatFemaleNeedsHips() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "body-fat")
        choose(app, "Homme", in: "tool-formula")
        XCTAssertFalse(element(app, "tool-field-hip").exists, "no hips for the male formula")
        type(app, "34", into: "tool-field-age")
        type(app, "38", into: "tool-field-neck")
        type(app, "84,5", into: "tool-field-waist")
        type(app, "178", into: "tool-field-height")
        toTop(app)
        XCTAssertEqual(element(app, "tool-figure-body-fat").label, "Ta masse grasse estimée, 16\u{202F}%")
        let reference = element(app, "band-reference")
        XCTAssertTrue(app.swipeUpUntil(reference))
        XCTAssertTrue(reference.label.contains("toi"), reference.label)
        XCTAssertTrue(reference.label.contains("8 – 19\u{202F}%"), reference.label)
        XCTAssertTrue(
            app.staticTexts["Pour la formule homme, de 20 à 39 ans (Gallagher 2000, tableau 4)."].exists, "the set read")

        choose(app, "Femme", in: "tool-formula")
        let hip = element(app, "tool-field-hip")
        XCTAssertTrue(hip.waitForExistence(timeout: 3), "the female formula asks for the hips")
        XCTAssertEqual(element(app, "tool-field-waist").label, "Tour de taille au plus fin")
        toTop(app)
        XCTAssertFalse(element(app, "tool-figure-body-fat").exists, "no figure without the hips")
        XCTAssertTrue(app.staticTexts["Il manque le tour de hanches."].exists)
        type(app, "98", into: "tool-field-hip")
        toTop(app)
        XCTAssertEqual(element(app, "tool-figure-body-fat").label, "Ta masse grasse estimée, 28\u{202F}%")

        choose(app, "Asiatique", in: "tool-reference")
        toTop(app)
        let asian = app.staticTexts[
            "Pour la formule femme, de 20 à 39 ans, personnes d’origine asiatique (Gallagher 2000, tableau 5)."
        ]
        XCTAssertTrue(app.swipeUpUntil(asian), "the Asian set")
    }

    /// A23: the inputs typed and the level chosen are still there after a relaunch.
    func testInputsKeptAfterRelaunch() {
        var app = launch("toolsEmpty")
        outils(app)
        open(app, "bmi")
        type(app, "178", into: "tool-field-height")
        type(app, "80,2", into: "tool-field-weight")
        toTop(app)
        XCTAssertEqual(element(app, "tool-figure-bmi").label, "Ton IMC, 25,3")
        hideKeypad(app)
        back(app)
        open(app, "energy")
        pickLevel(app, "active")

        app = launch("keep")
        outils(app)
        open(app, "bmi")
        XCTAssertTrue(element(app, "tool-figure-bmi").waitForExistence(timeout: 5), "the inputs are kept")
        XCTAssertEqual(element(app, "tool-figure-bmi").label, "Ton IMC, 25,3")
        XCTAssertEqual(element(app, "tool-field-height").value as? String, "178")
        back(app)
        open(app, "energy")
        let row = element(app, "tool-pal")
        XCTAssertTrue(app.swipeUpUntil(row))
        XCTAssertEqual(row.label, "Ton activité, Actif · 1,75", "the level is kept")
    }

    /// A23, R1: signing out takes the tools' memory with it; signed in again, the tool opens empty.
    func testInputsGoneAfterSignOut() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "bmi")
        type(app, "178", into: "tool-field-height")
        type(app, "80,2", into: "tool-field-weight")
        toTop(app)
        XCTAssertTrue(element(app, "tool-figure-bmi").waitForExistence(timeout: 5))
        hideKeypad(app)

        app.tab("Accueil")
        let settings = app.buttons["settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 5))
        settings.tap()
        let signOut = app.buttons["signout"]
        XCTAssertTrue(app.swipeUpUntil(signOut), "Réglages offers to sign out")
        signOut.tap()
        let sure = app.buttons["signout-confirm"].firstMatch
        XCTAssertTrue(sure.waitForExistence(timeout: 3))
        sure.tap()
        let submit = app.buttons["signin-submit"]
        XCTAssertTrue(submit.waitForExistence(timeout: 5), "signed out")
        submit.tap()

        outils(app)
        open(app, "bmi")
        XCTAssertTrue(app.staticTexts["Entre ta taille et ton poids."].waitForExistence(timeout: 5), "nothing kept")
        XCTAssertFalse(element(app, "tool-figure-bmi").exists, "no figure from before the sign-out")
    }

    /// A25: Apports reads « sédentaire » and maintien until the tools say otherwise; « Actif » and
    /// « Prise » chosen there show in Apports next time it appears.
    func testApportsFollowsActif() {
        let app = launch("tools")
        let meter = apports(app)
        XCTAssertTrue(meter.label.contains("sur 2\u{202F}710"), "sédentaire: \(meter.label)")
        XCTAssertTrue(element(app, "intake-protein").label.contains("sur 135\u{202F}g"), element(app, "intake-protein").label)

        outils(app)
        open(app, "energy")
        pickLevel(app, "active")
        back(app)
        open(app, "protein")
        choose(app, "Prise", in: "tool-goal")

        let after = apports(app)
        XCTAssertTrue(after.label.contains("sur 3\u{202F}060"), "actif: \(after.label)")
        XCTAssertTrue(element(app, "intake-protein").label.contains("sur 155\u{202F}g"), element(app, "intake-protein").label)
    }

    /// A49: at AX3, Dépense énergétique puts each field's value under its name and the formula's
    /// segments under theirs; the figure stays on one line.
    func testEnergyAx3TwoLines() {
        let app = launch("tools", largestText: true)
        outils(app)
        open(app, "energy")
        let figure = element(app, "tool-figure-energy")
        XCTAssertTrue(figure.waitForExistence(timeout: 5))
        XCTAssertGreaterThan(figure.frame.width, figure.frame.height, "the figure on one line: \(figure.frame)")
        let formula = app.segmentedControls["tool-formula"]
        XCTAssertTrue(app.swipeUpUntil(formula))
        let formulaName = app.staticTexts["Formule"].firstMatch
        XCTAssertGreaterThanOrEqual(formula.frame.minY, formulaName.frame.maxY - 1, "the segments under « Formule »")
        for (id, name) in [("tool-field-age", "Âge"), ("tool-field-height", "Taille"), ("tool-field-weight", "Poids")] {
            let field = element(app, id)
            XCTAssertTrue(app.swipeUpUntil(field), "\(id) is reached")
            let label = app.staticTexts[name].firstMatch
            XCTAssertGreaterThanOrEqual(field.frame.minY, label.frame.maxY - 1, "\(id) under its name")
        }
    }

    /// A22: the fields open on the profile, the average and the measures, each saying where from;
    /// a field changed loses its line, and « Reprendre mes dernières saisies » goes back to what
    /// was typed here.
    func testSourceLinesAndRestore() {
        let app = launch("tools")
        outils(app)
        open(app, "energy")
        let figure = element(app, "tool-figure-energy")
        XCTAssertTrue(figure.waitForExistence(timeout: 5), "the prefilled fields give a figure at once")
        XCTAssertEqual(element(app, "tool-field-height").value as? String, "180")
        XCTAssertEqual(element(app, "tool-field-weight").value as? String, "80,1")
        let lines = app.staticTexts.matching(identifier: "tool-source")
        XCTAssertEqual(lines.count, 4, "formula, age, height and weight say where they come from")
        XCTAssertTrue(app.staticTexts["depuis ton année de naissance"].exists)
        XCTAssertTrue(app.staticTexts["ta moyenne 7 jours"].exists)
        type(app, "5", into: "tool-field-weight")
        XCTAssertEqual(element(app, "tool-field-weight").value as? String, "80,15")
        XCTAssertFalse(app.staticTexts["ta moyenne 7 jours"].exists, "a changed field loses its line")
        XCTAssertEqual(lines.count, 3)
        let restore = element(app, "tool-restore")
        hideKeypad(app)
        XCTAssertTrue(app.swipeUpUntil(restore))
        restore.tap()
        XCTAssertEqual(lines.count, 0, "every field shows what was typed here")
        XCTAssertEqual(element(app, "tool-field-weight").value as? String, "80,15")
        XCTAssertFalse(restore.exists, "nothing left to restore")
        back(app)
        open(app, "body-fat")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "mensurations du ")).firstMatch.exists)
    }

    /// A22: Réglages' « Origine des champs » off hides every source line.
    func testSourceLinesHiddenByPref() {
        let app = launch("tools", arguments: ["-belay.fieldSources", "hidden"])
        outils(app)
        open(app, "energy")
        XCTAssertTrue(element(app, "tool-figure-energy").waitForExistence(timeout: 5), "still prefilled")
        XCTAssertEqual(app.staticTexts.matching(identifier: "tool-source").count, 0, "no source line")
    }

    /// A22: a height typed apart from the profile's offers the update; « Mettre à jour » writes the
    /// profile, which Apports then reads.
    func testProfileProposalWrites() {
        let app = launch("tools")
        outils(app)
        open(app, "energy")
        clear(app, "tool-field-height")
        type(app, "182", into: "tool-field-height")
        let proposal = element(app, "tool-proposal")
        hideKeypad(app)
        XCTAssertTrue(app.swipeUpUntil(proposal), "the update is offered")
        XCTAssertEqual(
            proposal.staticTexts.firstMatch.label,
            "Ton profil indique 180\u{202F}cm. Mettre à jour ton profil avec 182\u{202F}cm\u{202F}?")
        element(app, "tool-proposal-update").tap()
        XCTAssertTrue(proposal.waitForNonExistence(timeout: 5), "the profile now says 182 cm")
        // 182 cm in place of 180 adds 12,5 kcal at rest: 2 730 a sedentary day.
        XCTAssertTrue(apports(app).label.contains("sur 2\u{202F}730"), "Apports reads the profile written")
    }

    /// A20: Taille and Poids first, then the WHO bands.
    func testBmiFieldsBeforeBands() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "bmi")
        type(app, "178", into: "tool-field-height")
        type(app, "80,2", into: "tool-field-weight")
        hideKeypad(app)
        let band = element(app, "band-below")
        XCTAssertTrue(app.swipeUpUntil(band))
        XCTAssertLessThan(element(app, "tool-field-weight").frame.minY, band.frame.minY, "the fields come first")
    }

    /// A21: the formula's bias under the estimate; the fields, then the bands.
    func testBodyFatCaveatThenFieldsThenBands() {
        let app = launch("toolsEmpty")
        outils(app)
        open(app, "body-fat")
        choose(app, "Homme", in: "tool-formula")
        type(app, "34", into: "tool-field-age")
        type(app, "38", into: "tool-field-neck")
        type(app, "84,5", into: "tool-field-waist")
        type(app, "178", into: "tool-field-height")
        toTop(app)
        let bias = "Elle surestime souvent les personnes minces et sous-estime les personnes à forte masse grasse."
        XCTAssertTrue(element(app, "tool-result").staticTexts[bias].exists, "the bias under the estimate")
        let band = element(app, "band-below")
        XCTAssertTrue(app.swipeUpUntil(band))
        XCTAssertLessThan(element(app, "tool-field-height").frame.minY, band.frame.minY, "the fields come first")
    }

    /// A19: the pace in its own card, titled, « perte par semaine » under its name.
    func testProjectionPaceTitledInCard() {
        let app = launch("toolsEmpty", arguments: ["-BelayNow", "2026-10-07T09:00:00"])
        outils(app)
        open(app, "projection")
        type(app, "80,2", into: "tool-field-weight")
        type(app, "75", into: "tool-field-target")
        hideKeypad(app)
        let hint = app.staticTexts["perte par semaine"]
        XCTAssertTrue(app.swipeUpUntil(hint), "the pace says what it measures")
        XCTAssertTrue(app.staticTexts["Ton rythme"].exists)
    }
}

extension XCUIApplication {
    /// Opens the tab `name`. A scrolled page folds the tab bar down to its own tab: a tap on it
    /// unfolds the others first.
    func tab(_ name: String) {
        let bar = tabBars.firstMatch
        XCTAssertTrue(bar.waitForExistence(timeout: 10), "the tab bar shows")
        let button = bar.buttons[name]
        if !button.waitForExistence(timeout: 2) { bar.buttons.firstMatch.tap() }
        XCTAssertTrue(button.waitForExistence(timeout: 5), "« \(name) » is in the tab bar")
        button.tap()
    }

    /// The decimal keypad has no key to close it and may stand over a row, or come back with the
    /// field's focus after a pushed page: a drag from the list down into it puts it away, as the
    /// lists' interactive dismissal does. A swipe that stays above the keypad leaves it up.
    func putKeypadAway() {
        for _ in 0..<3 where keyboards.firstMatch.exists {
            let from = coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
            from.press(forDuration: 0.05, thenDragTo: coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.98)))
            _ = keyboards.firstMatch.waitForNonExistence(timeout: 1)
        }
    }
}

extension XCUIElement {
    /// A tap at the field's trailing end, where its right-aligned figure ends: the cursor lands
    /// after the last digit, so what follows is typed after it.
    func tapAtEnd() {
        coordinate(withNormalizedOffset: CGVector(dx: 0.97, dy: 0.5)).tap()
    }
}
