import BelayCore
import SwiftUI

/// Montée en charge: the working load on the keypad and the warm-up sets on − and +, 0 to 3,
/// following the load until the person picks a count. Each set reads « 50 kg × 5 » with its plates
/// per side, rounded to Mon matériel by the session's own `warmupSets`.
struct WarmupTool: View {
    @Bindable var outils: OutilsModel

    var body: some View {
        let typed = TypedLoad(outils.warmupWork)
        let plates = outils.equipment.plates
        let preset = String(localized: outils.equipment.name)
        ToolPage(
            tool: .warmup,
            note: Text(
                verbatim: String(
                    localized:
                        "Les charges sont arrondies à ton matériel («\u{202F}\(preset)\u{202F}»). Aucune étude ne fixe un schéma unique\u{202F}: c’est une progression courante, à ajuster comme tu veux.",
                    table: "Outils"))
        ) {
            if case .kg(let kg) = typed {
                if kg <= plates.barKg {
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
                ResultWaiting(label: "Ton échauffement", line: LoadLine.missing(typed, "Il manque la charge de travail."))
            }
        } fields: {
            Section {
                KeypadField(label: "Charge de travail", text: $outils.warmupWork, prompt: "100", id: "tool-field-work")
                if case .kg(let kg) = typed, kg > plates.barKg {
                    CountStepper(
                        label: "Échauffement", shown: Self.countText(count(kg)),
                        value: Binding(get: { count(kg) }, set: { outils.warmupCount = $0 }), range: 0...3,
                        what: String(localized: "une série", table: "Outils"), id: "tool-count")
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

    private func sets(_ kg: Double, plates: Plates) -> some View {
        let sets = warmupSets(workKg: kg, count: count(kg), barKg: plates.barKg, platesKg: plates.platesKg)
        return VStack(alignment: .leading, spacing: 0) {
            ResultLabel(text: "Ton échauffement").padding(.bottom, 6)
            ForEach(Array(sets.enumerated()), id: \.offset) { index, set in
                line(
                    tile: Text(verbatim: "\(index + 1)").font(.subheadline.weight(.bold)).foregroundStyle(.sessionShade)
                        .frame(width: 30, height: 30).background(Color.sessionTint, in: .rect(cornerRadius: 8)),
                    load: "\(set.loadKg.upToHundredths)\u{202F}kg × \(set.reps)",
                    detail: set.perSideKg.isEmpty
                        ? String(localized: "barre seule", table: "Outils")
                        : String(localized: "\(PlateText.plates(set.perSideKg)) par côté", table: "Outils")
                )
                .accessibilityIdentifier("warmup-set-\(index)")
                Divider().overlay(Color.line)
            }
            line(
                tile: Image(systemName: "checkmark").font(.subheadline.weight(.bold)).foregroundStyle(.ink)
                    .frame(width: 30, height: 30).background(Color.track, in: .rect(cornerRadius: 8)),
                load: "\(kg.upToHundredths)\u{202F}kg",
                detail: String(localized: "séries de travail, à toi", table: "Outils"))
        }
    }

    /// One set: its tile, the load and reps, the plates under them; read as one element.
    private func line(tile: some View, load: String, detail: String) -> some View {
        HStack(spacing: 12) {
            tile.accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: load).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
                    .lineLimit(1).minimumScaleFactor(0.6)
                Text(verbatim: detail).font(.subheadline).foregroundStyle(.muted)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 56)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(load), \(detail)"))
    }
}
