import BelayCore
import os
import SwiftUI

/// The eight tools, under the web's ids, which are also their science entries'.
enum ToolId: String, CaseIterable, Hashable {
    case oneRepMax = "one-rep-max", plates, warmup, energy, protein, projection, bmi
    case bodyFat = "body-fat"

    /// Force, Énergie and Corps, in the web's order.
    static let groups: [(title: LocalizedStringKey, tools: [ToolId])] = [
        ("Force", [.oneRepMax, .plates, .warmup]),
        ("Énergie", [.energy, .protein, .projection]),
        ("Corps", [.bmi, .bodyFat]),
    ]

    var name: LocalizedStringKey {
        switch self {
        case .oneRepMax: "1RM estimé"
        case .plates: "Disques"
        case .warmup: "Montée en charge"
        case .energy: "Dépense énergétique"
        case .protein: "Protéines"
        case .projection: "Projection"
        case .bmi: "IMC"
        case .bodyFat: "Masse grasse"
        }
    }

    var hint: LocalizedStringKey {
        switch self {
        case .oneRepMax: "Ton max à partir d’une série"
        case .plates: "Quoi charger sur la barre"
        case .warmup: "Tes séries d’échauffement"
        case .energy: "Métabolisme et dépense du jour"
        case .protein: "Ta fourchette par jour et par repas"
        case .projection: "Quand tu peux atteindre ton objectif"
        case .bmi: "Ta place sur les plages de l’OMS"
        case .bodyFat: "Une estimation au mètre ruban"
        }
    }

    /// The web's lead under the tool's name.
    var lead: LocalizedStringKey? {
        switch self {
        case .oneRepMax: "Ton max à partir d’une série menée près de l’échec."
        case .plates: "Quoi mettre de chaque côté de la barre."
        case .warmup: "Tes séries d’échauffement, arrondies à ton matériel."
        case .energy: "Ton métabolisme au repos et ce que tu dépenses dans la journée."
        case .protein: "Une fourchette par jour et par repas, selon ton objectif."
        case .projection: "Quand tu peux atteindre ton objectif, sous forme de fourchette de dates."
        case .bmi: "Ton indice de masse corporelle, placé sur les plages de l’OMS."
        case .bodyFat: "Une estimation au mètre ruban, avec des repères publiés."
        }
    }

    /// Each symbol says one thing across the app: no dumbbell, Séances' own, and no scale, Corps'.
    var symbol: String {
        switch self {
        case .oneRepMax: "arrow.up.to.line"
        case .plates: "circle.circle"
        case .warmup: "stairs"
        case .energy: "bolt.fill"
        case .protein: "fish.fill"
        case .projection: "calendar.badge.clock"
        case .bmi: "gauge.with.dots.needle.33percent"
        case .bodyFat: "percent"
        }
    }

    var domain: Domain {
        switch self {
        case .oneRepMax, .plates, .warmup: .session
        case .energy, .protein, .projection: .intake
        case .bmi, .bodyFat: .body
        }
    }
}

extension EquipmentChoice.Preset {
    var name: LocalizedStringResource {
        switch self {
        case .competition: LocalizedStringResource("Compétition", table: "Outils")
        case .gym: LocalizedStringResource("Salle", table: "Outils")
        case .custom: LocalizedStringResource("Sur mesure", table: "Outils")
        }
    }
}

extension EquipmentChoice {
    var name: LocalizedStringResource { preset.name }
}

/// What the tools hold: each tool's fields as last typed, Mon matériel, the activity level and the
/// protein goal, kept for the signed-in account on this phone (`ToolMemory`) and never sent. A
/// page that closes and opens again, or the app relaunched, finds its values.
@MainActor @Observable
final class OutilsModel {
    private(set) var memory: ToolMemory {
        didSet { save() }
    }
    /// The prefilled fields the person has changed, or brought back to their own values, by
    /// « tool.field » (« energy.weight »): their source lines go. For this run only, as on the web.
    private(set) var edited: Set<String> = []
    @ObservationIgnored private let file: URL?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "outils")

    /// `file` nil keeps the memory for this run only.
    init(memoryAt file: URL? = nil) {
        self.file = file
        memory = file.map(ToolMemoryFile.read) ?? ToolMemory()
    }

    private func save() {
        guard let file else { return }
        do {
            try ToolMemoryFile.write(memory, to: file)
        } catch {
            // The label only: the inputs are health data and never reach the log.
            Self.log.error("tool memory not written: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    /// The text last typed in a tool's field on this phone, empty if none.
    func input(_ tool: ToolId, _ field: String) -> String {
        memory.inputs[tool.rawValue]?[field] ?? ""
    }

    func setInput(_ tool: ToolId, _ field: String, _ text: String) {
        guard input(tool, field) != text else { return }
        memory.inputs[tool.rawValue, default: [:]][field] = text
    }

    var oneRepMaxLoad: String {
        get { input(.oneRepMax, "load") }
        set { setInput(.oneRepMax, "load", newValue) }
    }
    var oneRepMaxReps: Int {
        get { Int(input(.oneRepMax, "reps")) ?? 5 }
        set { setInput(.oneRepMax, "reps", String(newValue)) }
    }
    var platesTarget: String {
        get { input(.plates, "target") }
        set { setInput(.plates, "target", newValue) }
    }
    /// A new working load follows its own count again, as on the web.
    var warmupWork: String {
        get { input(.warmup, "work") }
        set {
            guard newValue != warmupWork else { return }
            setInput(.warmup, "work", newValue)
            warmupCount = nil
        }
    }
    /// The count the person chose; nil follows the load.
    var warmupCount: Int? {
        get { Int(input(.warmup, "count")) }
        set { setInput(.warmup, "count", newValue.map(String.init) ?? "") }
    }
    var equipment: EquipmentChoice {
        get { memory.equipment ?? EquipmentChoice() }
        set { memory.equipment = newValue }
    }
    /// « Ton activité », which Apports reads too.
    var pal: PalLevel {
        get { memory.pal }
        set { memory.palId = newValue.id }
    }
    /// What Apports reads of the two.
    var choices: IntakeChoices { IntakeChoices(pal: memory.pal.pal, goal: memory.goal) }
    /// The Protéines goal, which Apports reads too.
    var proteinGoal: ProteinGoal {
        get { memory.goal }
        set { memory.proteinGoal = newValue }
    }

    /// A field a value may prefill: the prefill until the person changes the field, then what
    /// they typed on this phone.
    func field(_ tool: ToolId, _ field: String, prefill: String?) -> String {
        if let prefill, !edited.contains("\(tool.rawValue).\(field)") { return prefill }
        return input(tool, field)
    }

    /// A field's source line: its default's source until the person changes it.
    func source(_ tool: ToolId, _ field: String, _ prefill: ToolSource?) -> ToolSource? {
        edited.contains("\(tool.rawValue).\(field)") ? nil : prefill
    }

    /// What the person types in a field: kept, and its source line gone.
    func type(_ tool: ToolId, _ field: String, _ text: String) {
        edited.insert("\(tool.rawValue).\(field)")
        setInput(tool, field, text)
    }

    /// « Reprendre mes dernières saisies »: the tool's fields go back to the values typed here.
    func restore(_ tool: ToolId, _ fields: [String]) {
        edited.formUnion(fields.map { "\(tool.rawValue).\($0)" })
    }

    /// Whether any of `fields` still shows a prefilled value, so « Reprendre » has work to do.
    func anyPrefilled(_ tool: ToolId, _ fields: [String: Bool]) -> Bool {
        fields.contains { field, prefilled in prefilled && !edited.contains("\(tool.rawValue).\(field)") }
    }
}
