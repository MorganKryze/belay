import BelayCore
import SwiftUI

/// 1RM estimé: « Charge » on the keypad, « Répétitions » on − and +; Epley large with Brzycki beside
/// it, unless Réglages keeps Epley alone. Past `reliableMaxReps` a line says the estimate is less
/// reliable.
struct OneRepMaxTool: View {
    @Bindable var outils: OutilsModel
    /// Read once: Réglages is another page, so the choice cannot change while this one is open.
    @State private var brzycki = DevicePrefs.brzycki.value == .shown

    var body: some View {
        let typed = TypedLoad(outils.oneRepMaxLoad)
        let reps = outils.oneRepMaxReps
        ToolPage(tool: .oneRepMax) {
            if case .kg(let kg) = typed, let max = try? oneRepMax(weightKg: kg, reps: reps) {
                VStack(alignment: .leading, spacing: 8) {
                    ResultLabel(text: "Ton 1RM estimé")
                    HStack(alignment: .top, spacing: 16) {
                        pair("Epley", max.epleyKg, id: "epley")
                        if brzycki { pair("Brzycki", max.brzyckiKg, id: "brzycki") }
                    }
                    if reps == 1 {
                        Text("Avec 1 répétition, ton 1RM est la charge soulevée.", tableName: "Outils")
                            .font(.subheadline).foregroundStyle(.muted)
                    }
                    if max.lessReliable {
                        Text("Au-delà de 10 répétitions, l’estimation est moins fiable.", tableName: "Outils")
                            .font(.subheadline).foregroundStyle(.ink)
                    }
                }
                .padding(.vertical, 6)
            } else {
                ResultWaiting(label: "Ton 1RM estimé", line: LoadLine.missing(typed, "Il manque la charge."))
            }
        } fields: {
            Section {
                KeypadField(label: "Charge", text: $outils.oneRepMaxLoad, prompt: "60", id: "tool-field-load")
                CountStepper(
                    label: "Répétitions", shown: Text(verbatim: "\(reps)"), value: $outils.oneRepMaxReps,
                    range: 1...maxReps, what: String(localized: "une répétition", table: "Outils"), id: "tool-reps")
            }
            .listRowBackground(Color.surface)
        }
    }

    /// One estimate, to the half kilo: its name over the figure, read as « Epley, 96 kg ».
    private func pair(_ name: String, _ kg: Double, id: String) -> some View {
        let figure = roundTo(kg, step: 0.5).upToHundredths
        return VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: name).font(.subheadline).foregroundStyle(.muted)
            Figure(text: figure, value: kg, unit: "kg", font: brzycki ? .displayLoad : .displayFigure, unitFont: .headline)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(name), \(figure) kg"))
        .accessibilityIdentifier("tool-figure-\(id)")
    }
}
