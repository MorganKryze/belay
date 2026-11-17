import BelayCore
import SwiftUI

/// Dépense énergétique: the formula, the age, the height and the weight, each opening on the
/// profile or the weigh-ins, then « Ton activité ». The day's expenditure large, its ±10 % range,
/// and the resting expenditure under a rule; Apports reads the level chosen here.
struct EnergyTool: View {
    @Bindable var outils: OutilsModel
    let corps: CorpsModel
    /// Read once, when the page opens: a weigh-in landing meanwhile never moves a field under the
    /// person's thumb.
    @State private var defaults: ToolDefaults
    @State private var picking = false

    private static let fields: [ToolField] = [.formula, .age, .height, .weight]

    init(outils: OutilsModel, corps: CorpsModel) {
        self.outils = outils
        self.corps = corps
        _defaults = State(initialValue: corps.toolDefaults)
    }

    var body: some View {
        let formula = outils.text(.energy, .formula, defaults)
        let age = outils.number(.energy, .age, defaults)
        let height = outils.number(.energy, .height, defaults)
        let weight = outils.number(.energy, .weight, defaults)
        ToolPage(
            tool: .energy,
            note: Text(
                "Une estimation à ±10\u{202F}%\u{202F}: environ 1 personne sur 5 est à plus de 10\u{202F}% de sa mesure réelle. C’est un point de départ, que tes pesées et tes apports affineront plus tard.",
                tableName: "Outils")
        ) {
            switch energy(ProfileFormula(rawValue: formula), age, height, weight) {
            case .success(let day): result(day)
            case .failure(let line): ResultWaiting(label: "Dépense du jour", line: line)
            }
        } fields: {
            Section {
                FormulaRow(formula: outils.binding(.energy, .formula, defaults), source: source(.formula))
                ProfileOffer(corps: corps, outils: outils, tool: .energy, field: .formula, defaults: defaults)
                KeypadField(
                    label: "Âge", text: outils.binding(.energy, .age, defaults), unit: "ans", prompt: "30",
                    source: source(.age), id: "tool-field-age")
                KeypadField(
                    label: "Taille", text: outils.binding(.energy, .height, defaults), unit: "cm", prompt: "170",
                    source: source(.height), id: "tool-field-height")
                ProfileOffer(corps: corps, outils: outils, tool: .energy, field: .height, defaults: defaults)
                KeypadField(
                    label: "Poids", text: outils.binding(.energy, .weight, defaults), prompt: "70",
                    source: source(.weight), id: "tool-field-weight")
                if outils.anyPrefilled(.energy, Self.fields, defaults) {
                    RestoreRow { outils.restore(.energy, Self.fields) }
                }
            }
            .listRowBackground(Color.surface)
            Section {
                PalRow(level: outils.pal) { picking = true }
            } footer: {
                Text("Corps › Apports compare tes calories à cette dépense.", tableName: "Outils").foregroundStyle(.muted)
            }
            .listRowBackground(Color.surface)
        }
        .wallUnderSheet(picking)
        .sheet(isPresented: $picking) {
            PalSheet(chosen: outils.pal) { outils.pal = $0 }
        }
    }

    private func source(_ field: ToolField) -> SourceLine? {
        outils.source(.energy, field, defaults).map { SourceLine(source: $0, timeZone: corps.timeZone) }
    }

    /// The day's expenditure at the level chosen, or in words what is missing or out of range.
    private func energy(_ formula: ProfileFormula, _ age: Double?, _ height: Double?, _ weight: Double?)
        -> Result<DailyEnergy, BodyLine>
    {
        let known = formula == .female || formula == .male
        guard known, let age, let height, let weight else {
            return .failure(
                .missing([
                    known ? nil : .formula, age == nil ? .age : nil, height == nil ? .height : nil,
                    weight == nil ? .weight : nil,
                ]))
        }
        let input = MifflinInput(formula: formula, ageYears: age, heightCm: height, weightKg: weight)
        do {
            return .success(try dailyEnergy(input, pal: outils.pal.pal))
        } catch {
            return .failure(.outside(error.message))
        }
    }

    private func result(_ day: DailyEnergy) -> some View {
        let kcal = { (value: Double) in BodyText.whole(Int(value)) }
        return VStack(alignment: .leading, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                ResultLabel(text: "Dépense du jour")
                Figure(text: kcal(day.dayKcal), value: day.dayKcal, unit: "kcal")
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                Text(verbatim: "\(String(localized: "Dépense du jour", table: "Outils")), \(kcal(day.dayKcal))\u{202F}kcal"))
            .accessibilityIdentifier("tool-figure-energy")
            Text("entre \(kcal(day.lowKcal)) et \(kcal(day.highKcal)) environ", tableName: "Outils")
                .font(.subheadline).foregroundStyle(.muted)
            Divider().overlay(Color.line).padding(.vertical, 8)
            HStack(alignment: .firstTextBaseline) {
                Text("Dépense au repos", tableName: "Outils").font(.subheadline).foregroundStyle(.muted)
                Spacer(minLength: 8)
                Text(verbatim: "\(kcal(day.bmrKcal))\u{202F}kcal").font(.body.weight(.semibold)).monospacedDigit()
                    .foregroundStyle(.ink)
            }
            .frame(minHeight: 44)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(
                Text(verbatim: "\(String(localized: "Dépense au repos", table: "Outils")), \(kcal(day.bmrKcal))\u{202F}kcal"))
            .accessibilityIdentifier("tool-energy-bmr")
        }
        .padding(.vertical, 6)
    }
}

/// « Formule »: Femme | Homme. The segments sit beside the name, and under it at the accessibility
/// sizes; where the value comes from stays under the name.
struct FormulaRow: View {
    @Binding var formula: String
    let source: SourceLine?
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let stacked = typeSize.isAccessibilitySize
        let layout =
            stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            VStack(alignment: .leading, spacing: 1) {
                Text("Formule", tableName: "Outils").foregroundStyle(.ink)
                source
            }
            if !stacked { Spacer(minLength: 8) }
            Picker(selection: $formula) {
                Text("Femme", tableName: "Outils").tag("female")
                Text("Homme", tableName: "Outils").tag("male")
            } label: {
                Text("Formule", tableName: "Outils")
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: stacked ? .infinity : 190)
            .accessibilityIdentifier("tool-formula")
            .sensoryFeedback(.selection, trigger: formula)
        }
        .frame(minHeight: 52)
        .padding(.vertical, 4)
    }
}

/// « Ton activité »: the level's name and PAL; a tap opens the four levels.
struct PalRow: View {
    let level: PalLevel
    let open: () -> Void

    var body: some View {
        let line = "\(String(localized: level.name)) · \(level.palText)"
        Button(action: open) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Ton activité", tableName: "Outils").foregroundStyle(.ink)
                    Text(verbatim: line).font(.subheadline).monospacedDigit().foregroundStyle(.muted)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.muted)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 56)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: "\(String(localized: "Ton activité", table: "Outils")), \(line)"))
        .accessibilityIdentifier("tool-pal")
    }
}

extension PalLevel {
    /// The web's names and words for the four levels.
    var name: LocalizedStringResource {
        switch id {
        case "very-sedentary": LocalizedStringResource("Très sédentaire", table: "Outils")
        case "active": LocalizedStringResource("Actif", table: "Outils")
        case "very-active": LocalizedStringResource("Très actif", table: "Outils")
        default: LocalizedStringResource("Sédentaire / activité légère", table: "Outils")
        }
    }

    var words: LocalizedStringResource {
        switch id {
        case "very-sedentary": LocalizedStringResource("Assis presque toute la journée, peu de marche.", table: "Outils")
        case "active":
            LocalizedStringResource(
                "Sédentaire, plus environ une heure d’exercice modéré à soutenu par jour.", table: "Outils")
        case "very-active":
            LocalizedStringResource(
                "Travail physique ou exercice intense une bonne partie de la journée.", table: "Outils")
        default: LocalizedStringResource("Travail peu physique, sans exercice régulier.", table: "Outils")
        }
    }

    /// « 1,55 », two decimals as the web shows it.
    var palText: String { pal.formatted(.number.precision(.fractionLength(2))) }
}

/// What a body tool says in place of its figure: the fields still empty, or the one outside the
/// tool's range.
enum BodyLine: Error {
    enum Field {
        case formula, age, height, weight, neck, waist, hip, target

        var words: String {
            switch self {
            case .formula: String(localized: "la formule", table: "Outils")
            case .age: String(localized: "l’âge", table: "Outils")
            case .height: String(localized: "la taille", table: "Outils")
            case .weight: String(localized: "le poids", table: "Outils")
            case .neck: String(localized: "le tour de cou", table: "Outils")
            case .waist: String(localized: "le tour de taille", table: "Outils")
            case .hip: String(localized: "le tour de hanches", table: "Outils")
            case .target: String(localized: "l’objectif", table: "Outils")
            }
        }
    }

    case missing([Field?])
    /// The rules' name for the value out of range: « age », « height », « weight ».
    case outside(String)
    /// Projection's goal at or above the weight.
    case notBelow
    /// The tool's own words.
    case prompt(LocalizedStringResource)

    /// « Il manque la formule, l’âge, la taille et le poids. », « Un âge va de 15 à 100 ans. »
    var text: Text {
        switch self {
        case .missing(let fields):
            let list = fields.compactMap { $0?.words }.formatted(.list(type: .and))
            return Text("Il manque \(list).", tableName: "Outils")
        case .prompt(let words):
            return Text(words)
        case .notBelow:
            return Text(
                "La projection calcule une perte de poids\u{202F}; ton objectif est déjà atteint ou au-dessus.",
                tableName: "Outils")
        case .outside(let field):
            switch field {
            case "age": return Text("Un âge va de 15 à 100 ans.", tableName: "Outils")
            case "height": return Text("Une taille va de 120 à 230 cm.", tableName: "Outils")
            case "body fat": return Text("Une masse grasse va de 2 à 75 %.", tableName: "Outils")
            default: return Text("Un poids va de 30 à 300 kg.", tableName: "Outils")
            }
        }
    }
}

extension ResultWaiting {
    init(label: LocalizedStringKey, line: BodyLine) {
        self.init(label: label, line: line.text)
    }
}

/// The web's proposal under the formula or the height once the person typed one the profile does
/// not hold: « Mettre à jour » writes the profile, « Non, juste ici » keeps the value to this tool.
struct ProfileOffer: View {
    let corps: CorpsModel
    let outils: OutilsModel
    let tool: ToolId
    let field: ToolField
    let defaults: ToolDefaults
    /// The value the person kept to this tool; another one typed asks again.
    @State private var declined: String?

    var body: some View {
        let value = outils.text(tool, field, defaults)
        if outils.changed(tool, field), value != declined, let offer = offer(value) {
            ProfileProposal(profile: offer.profile, value: offer.value, update: offer.update) { declined = value }
        }
    }

    private func offer(_ value: String) -> (profile: String, value: String, update: () -> Void)? {
        switch field {
        case .formula:
            let typed = ProfileFormula(rawValue: value)
            guard let held = corps.profile?.formula, held != typed, let shown = typed.shown, let was = held.shown
            else { return nil }
            return (was, shown, { corps.setFormula(typed) })
        case .height:
            guard let cm = ToolNumber.value(value), cm.rounded() == cm, isProfileHeight(Int(cm)),
                let held = corps.profile?.heightCm, held != Int(cm)
            else { return nil }
            return ("\(held)\u{202F}cm", "\(Int(cm))\u{202F}cm", { corps.setHeight(Int(cm)) })
        default:
            return nil
        }
    }
}

extension ProfileFormula {
    /// « Femme », « Homme »; nil for one this version does not know.
    var shown: String? {
        switch self {
        case .female: String(localized: "Femme", table: "Outils")
        case .male: String(localized: "Homme", table: "Outils")
        case .unknown: nil
        }
    }
}
