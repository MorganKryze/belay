import BelayCore
import SwiftUI

/// Disques: the target load on the keypad, then the plates per side, heaviest first, one side
/// drawn to scale on the sleeve and the bar named. A load the plates cannot make says so and gives
/// the loads either side, as `loadBar` finds them on Mon matériel.
struct PlatesTool: View {
    @Bindable var outils: OutilsModel

    var body: some View {
        let typed = TypedLoad(outils.platesTarget)
        let plates = outils.equipment.plates
        ToolPage(tool: .plates) {
            if case .kg(let kg) = typed,
                let load = try? loadBar(kg, barKg: plates.barKg, platesKg: plates.platesKg)
            {
                VStack(alignment: .leading, spacing: 6) {
                    ResultLabel(text: "De chaque côté")
                    result(load, target: kg, bar: plates.barKg)
                }
                .padding(.vertical, 6)
            } else {
                ResultWaiting(label: "De chaque côté", line: LoadLine.missing(typed, "Il manque la charge visée."))
            }
        } fields: {
            Section {
                KeypadField(label: "Charge visée", text: $outils.platesTarget, prompt: "100", id: "tool-field-target")
            }
            .listRowBackground(Color.surface)
            Section {
                ToolLink(route: .equipment) {
                    HStack {
                        Text("Mon matériel", tableName: "Outils").foregroundStyle(.ink)
                        Spacer()
                        Text(outils.equipment.name).foregroundStyle(.muted)
                    }
                    .frame(minHeight: 44)
                    .accessibilityElement(children: .combine)
                }
                .accessibilityIdentifier("tool-equipment")
            }
            .listRowBackground(Color.surface)
        }
    }

    @ViewBuilder private func result(_ load: BarLoad, target: Double, bar: Double) -> some View {
        switch load {
        case .exact(let loading):
            BarbellSide(plates: loading.perSideKg)
            Text(verbatim: PlateText.perSide(loading.perSideKg))
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: String(localized: "Barre de \(bar.upToHundredths)\u{202F}kg", table: "Outils"))
                .font(.subheadline).foregroundStyle(.muted)
        case .unreachable(nil, _):
            Text(verbatim: String(localized: "La barre seule pèse déjà \(bar.upToHundredths)\u{202F}kg.", table: "Outils"))
                .font(.headline).foregroundStyle(.ink)
        case .unreachable(let below, let above):
            Text(
                verbatim: String(
                    localized: "\(target.upToHundredths)\u{202F}kg n’est pas faisable avec ton matériel.", table: "Outils")
            )
            .font(.headline).foregroundStyle(.ink)
            if let below {
                nearest(String(localized: "Juste en dessous · \(below.totalKg.upToHundredths)\u{202F}kg", table: "Outils"), below)
            }
            if let above {
                nearest(String(localized: "Juste au-dessus · \(above.totalKg.upToHundredths)\u{202F}kg", table: "Outils"), above)
            }
        }
    }

    private func nearest(_ title: String, _ loading: Loading) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Divider().overlay(Color.line)
            Text(verbatim: title).font(.body.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
            Text(verbatim: PlateText.perSide(loading.perSideKg)).font(.subheadline).monospacedDigit().foregroundStyle(.muted)
        }
        .padding(.top, 4)
    }
}

/// How plates read: « 20 + 10 + 5 + 2,5 », with the unit or bare.
enum PlateText {
    static func plates(_ side: [Double]) -> String { side.map(\.upToHundredths).joined(separator: " + ") }

    /// « 20 + 5 kg par côté », or « Barre seule ».
    static func perSide(_ side: [Double]) -> String {
        side.isEmpty
            ? String(localized: "Barre seule", table: "Outils")
            : String(localized: "\(plates(side))\u{202F}kg par côté", table: "Outils")
    }
}

/// The plates of one side, drawn to scale on the sleeve in ink: heavy ones tall, small ones short.
struct BarbellSide: View {
    let plates: [Double]

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(Color.line).frame(height: 8)
            HStack(spacing: 3) {
                RoundedRectangle(cornerRadius: 2).fill(Color.muted).frame(width: 8, height: 30)
                ForEach(Array(plates.enumerated()), id: \.offset) { _, kg in
                    RoundedRectangle(cornerRadius: 4)
                        .fill(Color.ink)
                        .frame(width: kg >= 10 ? 16 : 11, height: Self.height(kg))
                }
            }
            .padding(.leading, 36)
        }
        .frame(height: 96)
        .accessibilityHidden(true)
    }

    /// A heavier plate stands taller, as its larger diameter does on a bar.
    private static func height(_ kg: Double) -> CGFloat {
        switch kg {
        case 25...: 92
        case 20..<25: 86
        case 15..<20: 78
        case 10..<15: 66
        case 5..<10: 50
        case 2.5..<5: 38
        default: 30
        }
    }
}
