import BelayCore
import SwiftUI

/// IMC: the index large and the WHO band in a sentence, then the height and the weight, each
/// opening on the profile or the weigh-ins, then the four bands with « toi » on the person's. Under 18,5 or from
/// 35, the web's line suggests a professional.
struct BmiTool: View {
    @Bindable var outils: OutilsModel
    let corps: CorpsModel
    /// Read once, when the page opens.
    @State private var defaults: ToolDefaults

    private static let fields: [ToolField] = [.height, .weight]

    init(outils: OutilsModel, corps: CorpsModel) {
        self.outils = outils
        self.corps = corps
        _defaults = State(initialValue: corps.toolDefaults)
    }

    var body: some View {
        let height = outils.number(.bmi, .height, defaults)
        let weight = outils.number(.bmi, .weight, defaults)
        let value = index(height, weight)
        ToolPage(
            tool: .bmi,
            note: Text(
                "L’IMC ne distingue pas le muscle de la graisse\u{202F}: c’est un repère de population, pas un diagnostic.",
                tableName: "Outils")
        ) {
            switch value {
            case .success(let bmi): result(bmi)
            case .failure(let line): ResultWaiting(label: "Ton IMC", line: line)
            }
        } fields: {
            Section {
                KeypadField(
                    label: "Taille", text: outils.binding(.bmi, .height, defaults), unit: "cm", prompt: "170",
                    source: source(.height), id: "tool-field-height")
                ProfileOffer(corps: corps, outils: outils, tool: .bmi, field: .height, defaults: defaults)
                WeightField(
                    label: "Poids", kg: outils.binding(.bmi, .weight, defaults), step: BodyWeight.step, prompt: 70,
                    source: source(.weight), id: "tool-field-weight")
                if outils.anyPrefilled(.bmi, Self.fields, defaults) {
                    RestoreRow { outils.restore(.bmi, Self.fields) }
                }
            }
            .listRowBackground(Color.surface)
            if case .success(let bmi) = value {
                BandList(title: "Plages de l’OMS", rows: Self.bands, current: bmiBand(bmi))
            }
        }
    }

    private func source(_ field: ToolField) -> SourceLine? {
        outils.source(.bmi, field, defaults).map { SourceLine(source: $0, timeZone: corps.timeZone) }
    }

    private func index(_ height: Double?, _ weight: Double?) -> Result<Double, BodyLine> {
        guard let height, let weight else {
            return .failure(.prompt(LocalizedStringResource("Entre ta taille et ton poids.", table: "Outils")))
        }
        do {
            let value = try bmi(weightKg: weight, heightCm: height)
            return BodyWeight.holds(weight) ? .success(value) : .failure(.outside("weight"))
        } catch {
            return .failure(.outside(error.message))
        }
    }

    private func result(_ bmi: Double) -> some View {
        let shown = BodyText.number(bmi)
        return VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 4) {
                ResultLabel(text: "Ton IMC")
                Figure(text: shown, value: bmi)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: "\(String(localized: "Ton IMC", table: "Outils")), \(shown)"))
            .accessibilityIdentifier("tool-figure-bmi")
            Self.sentence(bmiBand(bmi)).font(.subheadline).foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
            if bmiSuggestsProfessional(bmi) {
                Text("Si tu te poses des questions sur ton poids, parles-en à un professionnel de santé.", tableName: "Outils")
                    .font(.subheadline).foregroundStyle(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("tool-bmi-professional")
            }
        }
        .padding(.vertical, 6)
    }

    private static let t = bmiThresholds
    private static func n(_ value: Double) -> String { value.formatted(.number.precision(.fractionLength(0...1))) }

    private static func sentence(_ band: Band) -> Text {
        switch band {
        case .below:
            Text("En dessous de la plage de référence de l’OMS (moins de \(n(t.low))).", tableName: "Outils")
        case .reference:
            Text("Dans la plage de référence de l’OMS (\(n(t.low)) à \(n(t.reference))).", tableName: "Outils")
        case .above:
            Text("Au-dessus de la plage de référence de l’OMS (\(n(t.reference)) à \(n(t.high))).", tableName: "Outils")
        case .wellAbove:
            Text("Nettement au-dessus de la plage de référence de l’OMS (\(n(t.high)) et plus).", tableName: "Outils")
        }
    }

    private static let bands: [BandList.Row] = [
        .init(band: .below, name: String(localized: "En dessous", table: "Outils"), range: "< \(n(t.low))"),
        .init(
            band: .reference, name: String(localized: "Plage de référence de l’OMS", table: "Outils"),
            range: "\(n(t.low)) – \(n(t.reference))"),
        .init(
            band: .above, name: String(localized: "Au-dessus", table: "Outils"), range: "\(n(t.reference)) – \(n(t.high))"),
        .init(
            band: .wellAbove, name: String(localized: "Nettement au-dessus", table: "Outils"),
            range: String(localized: "\(n(t.high)) et plus", table: "Outils")),
    ]
}

/// Masse grasse: the formula, the age, the neck, the waist, the hips for the female formula only,
/// and the height, each opening on the profile or the measures. The estimate large with its ±4
/// points and the formula's bias, then the fields, then Gallagher's bands for the person's age group, in the set chosen on this phone.
struct BodyFatTool: View {
    @Bindable var outils: OutilsModel
    let corps: CorpsModel
    /// Read once, when the page opens.
    @State private var defaults: ToolDefaults

    init(outils: OutilsModel, corps: CorpsModel) {
        self.outils = outils
        self.corps = corps
        _defaults = State(initialValue: corps.toolDefaults)
    }

    /// The set of reference values, « Standard » until « Asiatique » is chosen; never sent.
    private var reference: BodyFatReference {
        get { BodyFatReference(rawValue: outils.input(.bodyFat, "reference")) ?? .standard }
        nonmutating set { outils.setInput(.bodyFat, "reference", newValue.rawValue) }
    }

    var body: some View {
        let formula = ProfileFormula(rawValue: outils.text(.bodyFat, .formula, defaults))
        let female = formula == .female
        let fields: [ToolField] = [.formula, .age, .neck, .waist] + (female ? [.hip] : []) + [.height]
        let estimate = estimate(formula)
        let age = outils.number(.bodyFat, .age, defaults)
        let set = age.flatMap { gallagherThresholds(formula, ageYears: $0, reference: reference) }
        ToolPage(tool: .bodyFat, note: note(estimate, age: age, set: set != nil)) {
            switch estimate {
            case .success(let percent): result(percent)
            case .failure(let line): ResultWaiting(label: "Ta masse grasse estimée", line: line)
            }
        } fields: {
            Section {
                FormulaRow(formula: outils.binding(.bodyFat, .formula, defaults), source: source(.formula))
                ProfileOffer(corps: corps, outils: outils, tool: .bodyFat, field: .formula, defaults: defaults)
                KeypadField(
                    label: "Âge", text: outils.binding(.bodyFat, .age, defaults), unit: "ans", prompt: "30",
                    source: source(.age), id: "tool-field-age")
                KeypadField(
                    label: "Tour de cou", text: outils.binding(.bodyFat, .neck, defaults), unit: "cm", prompt: "38",
                    source: source(.neck), id: "tool-field-neck")
                KeypadField(
                    label: female ? "Tour de taille au plus fin" : "Tour de taille au nombril",
                    text: outils.binding(.bodyFat, .waist, defaults), unit: "cm", prompt: "85",
                    source: source(.waist), id: "tool-field-waist")
                if female {
                    KeypadField(
                        label: "Tour de hanches", text: outils.binding(.bodyFat, .hip, defaults), unit: "cm",
                        prompt: "98", source: source(.hip), id: "tool-field-hip")
                }
                KeypadField(
                    label: "Taille", text: outils.binding(.bodyFat, .height, defaults), unit: "cm", prompt: "170",
                    source: source(.height), id: "tool-field-height")
                ProfileOffer(corps: corps, outils: outils, tool: .bodyFat, field: .height, defaults: defaults)
                if outils.anyPrefilled(.bodyFat, fields, defaults) {
                    RestoreRow { outils.restore(.bodyFat, fields) }
                }
            }
            .listRowBackground(Color.surface)
            if case .success(let percent) = estimate, let set {
                BandList(
                    title: "Repères", rows: Self.bands(set.thresholds), current: bodyFatBand(percent, set.thresholds),
                    caption: caption(formula, set.group))
            }
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Jeu de repères", tableName: "Outils").foregroundStyle(.ink)
                    Picker(selection: Binding(get: { reference }, set: { reference = $0 })) {
                        Text("Standard", tableName: "Outils").tag(BodyFatReference.standard)
                        Text("Asiatique", tableName: "Outils").tag(BodyFatReference.asian)
                    } label: {
                        Text("Jeu de repères", tableName: "Outils")
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("tool-reference")
                    .sensoryFeedback(.selection, trigger: reference)
                }
                .padding(.vertical, 6)
            } footer: {
                Text(
                    "«\u{202F}Asiatique\u{202F}» utilise le tableau 5 de Gallagher, établi sur des personnes vivant au Japon. Ce choix reste sur ton appareil.",
                    tableName: "Outils"
                )
                .foregroundStyle(.muted)
            }
            .listRowBackground(Color.surface)
        }
    }

    private func source(_ field: ToolField) -> SourceLine? {
        outils.source(.bodyFat, field, defaults).map { SourceLine(source: $0, timeZone: corps.timeZone) }
    }

    /// The navy estimate, or in words what is missing or what the formula refuses.
    private func estimate(_ formula: ProfileFormula) -> Result<Int, BodyLine> {
        let known = formula == .female || formula == .male
        let neck = outils.number(.bodyFat, .neck, defaults)
        let waist = outils.number(.bodyFat, .waist, defaults)
        let hip = formula == .female ? outils.number(.bodyFat, .hip, defaults) : nil
        let height = outils.number(.bodyFat, .height, defaults)
        guard known, let neck, let waist, let height, formula == .male || hip != nil else {
            return .failure(
                .missing([
                    known ? nil : .formula, neck == nil ? .neck : nil, waist == nil ? .waist : nil,
                    formula == .female && hip == nil ? .hip : nil, height == nil ? .height : nil,
                ]))
        }
        guard heightRangeCm.contains(height) else { return .failure(.outside("height")) }
        switch navyBodyFat(NavyInput(formula: formula, heightCm: height, neckCm: neck, waistCm: waist, hipCm: hip)) {
        case .ok(let percent, _): return .success(percent)
        case .invalidGirths:
            return .failure(
                .prompt(
                    formula == .male
                        ? LocalizedStringResource("Le tour de taille doit dépasser le tour de cou.", table: "Outils")
                        : LocalizedStringResource("Tour de taille et tour de hanches réunis doivent dépasser le tour de cou.", table: "Outils")))
        case .outOfRange:
            return .failure(
                .prompt(LocalizedStringResource("Ces mesures sortent de ce que la formule sait calculer. Vérifie-les.", table: "Outils")))
        }
    }

    private func result(_ percent: Int) -> some View {
        let shown = "\(percent)\u{202F}%"
        return VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 4) {
                ResultLabel(text: "Ta masse grasse estimée")
                Figure(text: "\(percent)", value: Double(percent), unit: "%")
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: "\(String(localized: "Ta masse grasse estimée", table: "Outils")), \(shown)"))
            .accessibilityIdentifier("tool-figure-body-fat")
            Text("estimation ±4 points", tableName: "Outils").font(.subheadline).foregroundStyle(.muted)
            Text(
                "Elle surestime souvent les personnes minces et sous-estime les personnes à forte masse grasse.",
                tableName: "Outils"
            )
            .font(.subheadline).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 6)
    }

    /// Why no band shows outside 20 to 79 years; the formula's bias sits under the estimate.
    private func note(_ estimate: Result<Int, BodyLine>, age: Double?, set: Bool) -> Text? {
        guard case .success = estimate, age != nil, !set else { return nil }
        return Text(
            "Les repères publiés couvrent 20 à 79 ans\u{202F}: pour ton âge, seule l’estimation s’affiche.",
            tableName: "Outils")
    }

    /// « Pour la formule homme, de 20 à 39 ans (Gallagher 2000, tableau 4). »
    private func caption(_ formula: ProfileFormula, _ group: AgeGroup) -> Text {
        let word =
            formula == .female ? String(localized: "femme", table: "Outils") : String(localized: "homme", table: "Outils")
        let ages = group.rawValue.split(separator: "-").map(String.init)
        let (from, to) = (ages.first ?? "", ages.last ?? "")
        return reference == .asian
            ? Text(
                "Pour la formule \(word), de \(from) à \(to) ans, personnes d’origine asiatique (Gallagher 2000, tableau 5).",
                tableName: "Outils")
            : Text("Pour la formule \(word), de \(from) à \(to) ans (Gallagher 2000, tableau 4).", tableName: "Outils")
    }

    private static func bands(_ t: GallagherThresholds) -> [BandList.Row] {
        let pct = { (value: Int) in "\(value)\u{202F}%" }
        return [
            .init(
                band: .below, name: String(localized: "Correspondant à un IMC < 18,5", table: "Outils"),
                range: "< \(pct(t.at18_5))"),
            .init(
                band: .reference, name: String(localized: "Correspondant à un IMC de 18,5 à 25", table: "Outils"),
                range: "\(t.at18_5) – \(pct(t.at25 - 1))"),
            .init(
                band: .above, name: String(localized: "Correspondant à un IMC de 25 à 30", table: "Outils"),
                range: "\(t.at25) – \(pct(t.at30 - 1))"),
            .init(
                band: .wellAbove, name: String(localized: "Correspondant à un IMC de 30 et plus", table: "Outils"),
                range: String(localized: "\(pct(t.at30)) et plus", table: "Outils")),
        ]
    }
}

/// Published bands as rows: the range, the name under it, and « toi » on the person's. In ink and muted
/// only: a band is a place on a scale, never a fault.
struct BandList: View {
    struct Row {
        let band: Band
        let name: String
        let range: String
    }

    let title: LocalizedStringKey
    let rows: [Row]
    let current: Band
    var caption: Text? = nil

    var body: some View {
        Section {
            ForEach(rows, id: \.band) { row in
                let mine = row.band == current
                let you = String(localized: "toi", table: "Outils")
                HStack(spacing: 8) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: row.range).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
                        Text(verbatim: row.name).font(.subheadline).foregroundStyle(.muted)
                    }
                    Spacer(minLength: 8)
                    if mine {
                        Text(verbatim: you).font(.footnote.weight(.bold)).foregroundStyle(.surface)
                            .padding(.horizontal, 10).padding(.vertical, 3)
                            .background(Color.ink, in: .capsule)
                    }
                }
                .frame(minHeight: 52)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: mine ? "\(row.name), \(row.range), \(you)" : "\(row.name), \(row.range)"))
                .accessibilityIdentifier("band-\(row.band.rawValue)")
            }
        } header: {
            Text(title, tableName: "Outils").foregroundStyle(.ink).textCase(nil)
        } footer: {
            if let caption { caption.foregroundStyle(.muted) }
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
    }
}
