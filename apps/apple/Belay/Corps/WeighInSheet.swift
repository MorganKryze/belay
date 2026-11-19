import BelayCore
import SwiftUI

/// Pesée: the day and its weight in the unit chosen, typed on the decimal keypad open at once. ✓
/// turns blue once the weight, stored on the 0,1 kg grid, sits within the bounds, which are said in
/// the unit when the weight falls outside them; a day already weighed opens on its value. No
/// « Heure » row: the contract keeps one weigh-in a day.
struct WeighInSheet: View {
    let corps: CorpsModel
    @State private var date: Date
    @State private var text = ""
    /// Kept while the sheet is open, as the web does: a number already typed keeps its unit.
    @State private var unit = SetText.unit
    @FocusState private var typing: Bool

    init(corps: CorpsModel) {
        self.corps = corps
        _date = State(initialValue: corps.now())
    }

    private var day: String { toISODate(date, timeZone: corps.timeZone) }

    /// The kilos to store, nil outside the bounds the sheet states. The day's value left as shown
    /// gives back its own kilos, never a round trip through the quarter pound.
    private var value: Double? {
        guard !outside, let typed = SetText.parseKg(text), let kg = weighingKgFrom(typed, unit) else { return nil }
        let stored = corps.weighIn(on: day).map { ($0, kgFromWeighing(weighingFromKg($0, unit), unit)) }
        return readBack(kg, prefill: stored)
    }

    /// The bounds in the unit, rounded inward to its step, as the web states and enforces them.
    private var bounds: ClosedRange<Double> {
        rangeIn(Bounds.weighInKgMin...Bounds.weighInKgMax, unit, step: stepIn(0.1, unit))
    }

    /// A number typed outside the stated bounds, said with them; off the grid stays silent.
    private var outside: Bool {
        guard let typed = SetText.parseKg(text) else { return false }
        return !bounds.contains(typed)
    }

    private var footer: Text? {
        if outside {
            let format = { (v: Double) in BodyText.figure(kgFromWeighing(v, unit), unit) }
            let low = format(bounds.lowerBound), high = format(bounds.upperBound), symbol = unit.rawValue
            return Text("Saisis un poids entre \(low) et \(high)\u{202F}\(symbol).", tableName: "Corps")
        }
        return corps.lastWeighIn == nil ? nil : Text("En gris, ta dernière pesée.", tableName: "Corps")
    }

    var body: some View {
        EntrySheet(
            title: Text("Pesée", tableName: "Corps"), symbol: "scalemass.fill", date: $date, latest: corps.now(), canSave: value != nil,
            id: "weighin",
            save: { if let value { corps.weigh(date: day, kg: value) } },
            deletion: corps.weighIn(on: day) == nil
                ? nil : (Text("Supprimer la pesée", tableName: "Corps"), { corps.deleteWeighIn(date: day) }),
            footer: footer
        ) {
            HStack {
                Text(verbatim: unit.rawValue).foregroundStyle(.muted)
                TextField(
                    unit == .kg
                        ? String(localized: "Poids en kilos", table: "Corps") : String(localized: "Poids en livres", table: "Corps"),
                    text: $text,
                    prompt: corps.lastWeighIn.map { Text(BodyText.figure($0, unit)) })
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .font(.title2.weight(.semibold))
                    .monospacedDigit()
                    .focused($typing)
                    .accessibilityIdentifier("weighin-kg")
            }
            .frame(minHeight: 52)
        }
        .onChange(of: day, initial: true) { _, day in
            text = corps.weighIn(on: day).map { BodyText.figure($0, unit) } ?? ""
        }
        .task {
            // The keypad rises with the sheet, as in Santé: focus once the sheet has landed.
            try? await Task.sleep(for: .milliseconds(500))
            typing = true
        }
    }
}
