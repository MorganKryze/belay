import BelayCore
import SwiftUI

/// Pesée: the day and its weight in kg, typed on the decimal keypad open at once. ✓ turns blue
/// once the weight sits within the bounds on the 0,1 grid; a day already weighed opens on its value.
/// No « Heure » row: the contract keeps one weigh-in a day (R2).
struct WeighInSheet: View {
    let corps: CorpsModel
    @State private var date: Date
    @State private var text = ""
    @FocusState private var typing: Bool

    init(corps: CorpsModel) {
        self.corps = corps
        _date = State(initialValue: corps.now())
    }

    private var day: String { toISODate(date, timeZone: corps.timeZone) }

    private var value: Double? {
        SetText.parseKg(text).flatMap { isWeighingKg($0) ? $0 : nil }
    }

    var body: some View {
        EntrySheet(
            title: Text("Pesée", tableName: "Corps"), symbol: "scalemass.fill", date: $date, latest: corps.now(), canSave: value != nil,
            id: "weighin",
            save: { if let value { corps.weigh(date: day, kg: value) } },
            deletion: corps.weighIn(on: day) == nil
                ? nil : (Text("Supprimer la pesée", tableName: "Corps"), { corps.deleteWeighIn(date: day) }),
            footer: corps.lastWeighIn == nil ? nil : Text("En gris, ta dernière pesée.", tableName: "Corps")
        ) {
            HStack {
                Text("kg", tableName: "Corps").foregroundStyle(.muted)
                TextField(
                    String(localized: "Poids en kilos", table: "Corps"), text: $text,
                    prompt: corps.lastWeighIn.map { Text(BodyText.number($0)) })
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
            text = corps.weighIn(on: day).map(BodyText.number) ?? ""
        }
        .task {
            // The keypad rises with the sheet, as in Santé: focus once the sheet has landed.
            try? await Task.sleep(for: .milliseconds(500))
            typing = true
        }
    }
}
