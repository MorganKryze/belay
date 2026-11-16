import BelayCore
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

    /// The web's lead under the tool's name, for the tools this phone has.
    var lead: LocalizedStringKey? {
        switch self {
        case .oneRepMax: "Ton max à partir d’une série menée près de l’échec."
        case .plates: "Quoi mettre de chaque côté de la barre."
        case .warmup: "Tes séries d’échauffement, arrondies à ton matériel."
        case .energy, .protein, .projection, .bmi, .bodyFat: nil
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

/// Mon matériel: a preset, or the person's own bar and plates. The presets never change; « Modifier »
/// copies one into the custom set.
struct EquipmentChoice: Equatable {
    enum Preset: String, CaseIterable {
        case competition, gym, custom

        var name: LocalizedStringResource {
            switch self {
            case .competition: LocalizedStringResource("Compétition", table: "Outils")
            case .gym: LocalizedStringResource("Salle", table: "Outils")
            case .custom: LocalizedStringResource("Sur mesure", table: "Outils")
            }
        }
    }

    var preset = Preset.gym
    /// The custom set, the gym's until the person makes it theirs.
    var custom = Plates.gym

    /// What Disques and Montée en charge load with.
    var plates: Plates {
        switch preset {
        case .competition: .competition
        case .gym: .gym
        case .custom: custom
        }
    }

    var name: LocalizedStringResource { preset.name }
}

/// What the tools hold while the app runs: each tool's fields as typed, and Mon matériel. A page
/// that closes and opens again finds its values.
@MainActor @Observable
final class OutilsModel {
    var oneRepMaxLoad = ""
    var oneRepMaxReps = 5
    var platesTarget = ""
    /// A new working load follows its own count again, as on the web.
    var warmupWork = "" { didSet { if warmupWork != oldValue { warmupCount = nil } } }
    /// The count the person chose; nil follows the load.
    var warmupCount: Int?
    var equipment = EquipmentChoice()
    /// The prefilled fields the person has changed, by the tool's field key (« energy.weight »):
    /// their source lines go.
    var edited: Set<String> = []
    /// The values last typed on this phone, by the same keys, for « Reprendre mes dernières saisies ».
    var typed: [String: String] = [:]

    /// A field's source line: its default's source until the person changes it.
    func source(_ key: String, _ prefill: ToolSource?) -> ToolSource? {
        edited.contains(key) ? nil : prefill
    }

    /// What the person types in `key`: kept for « Reprendre », and the source line gone.
    func type(_ key: String, _ text: String) {
        edited.insert(key)
        typed[key] = text
    }
}
