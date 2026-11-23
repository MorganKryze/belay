import BelayCore
import SwiftUI

/// Montée en charge: the working load on the keypad and the warm-up sets on − and +, 0 to 3,
/// following the load until the person picks a count. Each set reads « 50 kg × 5 » with its plates
/// per side, rounded to Mon matériel by the session's own `warmupSets`. In pounds, as on the web,
/// the sets count in whole pounds on a pound gym's bar and plates, and the count follows the kilos,
/// so a load calls for the same count in either unit.
struct WarmupTool: View {
    @Bindable var outils: OutilsModel

    /// The web's load step, whose pounds round the bounds.
    private static let step = 2.5

    var body: some View {
        let unit = SetText.unit
        let typed = TypedLoad(outils.warmupWork, step: Self.step)
        let plates =
            unit == .kg ? outils.equipment.plates : Plates(barKg: poundPlates.barLb, platesKg: poundPlates.platesLb)
        let preset = String(localized: unit == .kg ? outils.equipment.name : PlateText.poundSet)
        ToolPage(
            tool: .warmup,
            note: Text(
                verbatim: String(
                    localized:
                        "Les charges sont arrondies à ton matériel («\u{202F}\(preset)\u{202F}»). Aucune étude ne fixe un schéma unique\u{202F}: c’est une progression courante, à ajuster comme tu veux.",
                    table: "Outils"))
        ) {
            if case .kg(let kg) = typed {
                if loadFromKg(kg, unit) <= plates.barKg {
                    Text(
                        "Ta charge de travail est la barre seule ou plus légère\u{202F}: il n’y a pas d’échauffement à calculer.",
                        tableName: "Outils"
                    )
                    .foregroundStyle(.ink)
                    .padding(.vertical, 6)
                } else {
                    sets(kg, plates: plates)
                }
            } else {
                ResultWaiting(label: "Ton échauffement", line: LoadLine.missing(typed, "Il manque la charge de travail.", step: Self.step))
            }
        } fields: {
            Section {
                WeightField(label: "Charge de travail", kg: $outils.warmupWork, step: Self.step, prompt: 100, id: "tool-field-work")
                if case .kg(let kg) = typed, loadFromKg(kg, unit) > plates.barKg {
                    CountStepper(
                        label: "Échauffement", shown: Self.countText(count(kg)),
                        value: Binding(get: { count(kg) }, set: { outils.warmupCount = $0 }), range: 0...3,
                        what: String(localized: "une série", table: "Outils"), id: "tool-count",
                        hint: "suit la charge tant que tu n’y touches pas")
                }
            }
            .listRowBackground(Color.surface)
        }
    }

    /// The count chosen, else the one the load calls for.
    private func count(_ kg: Double) -> Int { outils.warmupCount ?? defaultWarmupCount(workKg: kg) }

    private static func countText(_ n: Int) -> Text {
        n == 0 ? Text("aucune série", tableName: "Outils") : Text("\(n) séries", tableName: "Outils")
    }

    /// The sets of the working load `kg`, counted in the unit shown on `plates`, which are in it too.
    private func sets(_ kg: Double, plates: Plates) -> some View {
        let unit = SetText.unit
        let work = loadFromKg(kg, unit)
        let sets = warmupSets(workKg: work, count: count(kg), barKg: plates.barKg, platesKg: plates.platesKg)
        return VStack(alignment: .leading, spacing: 0) {
            ResultLabel(text: "Ton échauffement").padding(.bottom, 6)
            ForEach(Array(sets.enumerated()), id: \.offset) { index, set in
                line(
                    tile: Text(verbatim: "\(index + 1)").font(.subheadline.weight(.bold)).foregroundStyle(.sessionShade)
                        .frame(width: 30, height: 30).background(Color.sessionTint, in: .rect(cornerRadius: 8)),
                    load: set.loadKg.upToHundredths,
                    detail: set.perSideKg.isEmpty
                        ? String(localized: "barre seule", table: "Outils")
                        : String(localized: "\(PlateText.plates(set.perSideKg)) par côté", table: "Outils"),
                    end: "× \(set.reps)"
                )
                .accessibilityIdentifier("warmup-set-\(index)")
                Divider().overlay(Color.line)
            }
            line(
                tile: Image(systemName: "checkmark").font(.subheadline.weight(.bold)).foregroundStyle(.ink)
                    .frame(width: 30, height: 30).background(Color.track, in: .rect(cornerRadius: 8)),
                load: work.upToHundredths,
                detail: String(localized: "séries de travail", table: "Outils"),
                end: String(localized: "à toi", table: "Outils")
            )
            .accessibilityIdentifier("warmup-work")
        }
    }

    /// One set: its tile, the load in the unit shown with the plates under it, the reps on the
    /// right; read as one element with the unit as a word, « 50 kilos × 5, 10 + 5 par côté » or
    /// « 100 kilos, séries de travail, à toi ».
    private func line(tile: some View, load figure: String, detail: String, end: String) -> some View {
        let reps = end.hasPrefix("×")
        let load = "\(figure)\u{202F}\(SetText.symbol)"
        let spoken = "\(figure) \(SetText.unitWord)"
        return HStack(spacing: 12) {
            tile.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: load).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text(verbatim: detail).font(.subheadline).foregroundStyle(.muted)
            }
            Spacer(minLength: 8)
            Text(verbatim: end).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
        }
        .frame(minHeight: 56)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: reps ? "\(spoken) \(end), \(detail)" : "\(spoken), \(detail), \(end)"))
    }
}
