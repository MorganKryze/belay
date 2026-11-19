import BelayCore
import SwiftUI

/// Disques: the target load on the keypad, then the plates per side, heaviest first, one side
/// drawn to scale on the sleeve and the bar named. A load the plates cannot make says so and gives
/// the loads either side, as `loadBar` finds them on Mon matériel. In pounds it counts in pounds on
/// a pound gym's 45 lb bar and plates, as the web does: Mon matériel holds kilo plates.
struct PlatesTool: View {
    @Bindable var outils: OutilsModel

    /// The web's target step, whose pounds round the bounds.
    private static let step = 0.5

    var body: some View {
        let unit = SetText.unit
        // `loadBar` counts without a unit, so a target past its table is refused in pounds too.
        let typed = TypedLoad(outils.platesTarget, step: Self.step, cap: maxTargetKg)
        let plates =
            unit == .kg ? outils.equipment.plates : Plates(barKg: poundPlates.barLb, platesKg: poundPlates.platesLb)
        ToolPage(
            tool: .plates,
            note: unit == .lb
                ? Text("En livres, Belay prend la barre de 45\u{202F}lb et les disques standard.", tableName: "Outils") : nil
        ) {
            if plates.platesKg.isEmpty {
                ResultWaiting(
                    label: "De chaque côté",
                    line: Text("Ton matériel n’a aucun disque\u{202F}: ajoute-en dans Mon matériel.", tableName: "Outils"))
            } else if case .kg(let kg) = typed,
                let load = try? loadBar(loadFromKg(kg, unit), barKg: plates.barKg, platesKg: plates.platesKg)
            {
                VStack(alignment: .leading, spacing: 6) {
                    ResultLabel(text: "De chaque côté")
                    result(load, target: loadFromKg(kg, unit), bar: plates.barKg)
                }
                .padding(.vertical, 6)
            } else {
                ResultWaiting(
                    label: "De chaque côté",
                    line: LoadLine.missing(typed, "Il manque la charge visée.", step: Self.step, cap: maxTargetKg))
            }
        } fields: {
            Section {
                WeightField(label: "Charge visée", kg: $outils.platesTarget, step: Self.step, prompt: 100, id: "tool-field-target")
            }
            .listRowBackground(Color.surface)
            Section {
                ToolLink(route: .equipment) {
                    HStack {
                        Text("Mon matériel", tableName: "Outils").foregroundStyle(.ink)
                        Spacer()
                        Text(unit == .lb ? PlateText.poundSet : outils.equipment.name).foregroundStyle(.muted)
                    }
                    .frame(minHeight: 44)
                    .accessibilityElement(children: .combine)
                }
                .accessibilityIdentifier("tool-equipment")
            }
            .listRowBackground(Color.surface)
        }
    }

    /// `target` and `bar` in the unit shown, as `loadBar` counted them.
    @ViewBuilder private func result(_ load: BarLoad, target: Double, bar: Double) -> some View {
        let unit = SetText.symbol
        switch load {
        case .exact(let loading):
            BarbellSide(plates: loading.perSideKg)
            Text(verbatim: PlateText.perSide(loading.perSideKg))
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            Text(verbatim: String(localized: "Barre de \(bar.upToHundredths)\u{202F}\(unit)", table: "Outils"))
                .font(.subheadline).foregroundStyle(.muted)
        case .unreachable(nil, _):
            Text(verbatim: String(localized: "La barre seule pèse déjà \(bar.upToHundredths)\u{202F}\(unit).", table: "Outils"))
                .font(.headline).foregroundStyle(.ink)
        case .unreachable(let below, let above):
            Text(
                verbatim: String(
                    localized: "\(target.upToHundredths)\u{202F}\(unit) n’est pas faisable avec ton matériel.", table: "Outils")
            )
            .font(.headline).foregroundStyle(.ink)
            if let below {
                nearest(String(localized: "Juste en dessous · \(below.totalKg.upToHundredths)\u{202F}\(unit)", table: "Outils"), below)
            }
            if let above {
                nearest(String(localized: "Juste au-dessus · \(above.totalKg.upToHundredths)\u{202F}\(unit)", table: "Outils"), above)
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
    /// Mon matériel's name while the tools count in pounds.
    static var poundSet: LocalizedStringResource { LocalizedStringResource("Standard (lb)", table: "Outils") }

    static func plates(_ side: [Double]) -> String { side.map(\.upToHundredths).joined(separator: " + ") }

    /// « 20 + 5 kg par côté », « 45 + 45 lb par côté », or « Barre seule ».
    static func perSide(_ side: [Double]) -> String {
        side.isEmpty
            ? String(localized: "Barre seule", table: "Outils")
            : String(localized: "\(plates(side))\u{202F}\(SetText.symbol) par côté", table: "Outils")
    }
}

/// The plates of one side, drawn to scale on the sleeve in ink: heavy ones tall, small ones short.
/// The plates are in the unit shown; a pound plate is drawn as heavy as its kilos.
struct BarbellSide: View {
    let plates: [Double]

    var body: some View {
        ZStack(alignment: .leading) {
            Capsule().fill(Color.line).frame(height: 8)
            HStack(spacing: 3) {
                RoundedRectangle(cornerRadius: 2).fill(Color.muted).frame(width: 8, height: 30)
                ForEach(Array(plates.map(Self.kg).enumerated()), id: \.offset) { _, kg in
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

    private static func kg(_ plate: Double) -> Double { SetText.unit == .kg ? plate : lbToKg(plate) }

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
