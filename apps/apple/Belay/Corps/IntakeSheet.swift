import BelayCore
import SwiftUI

/// Apports, in the weigh-in sheet's pattern (R3): the day, then its calories and protein, whole
/// numbers on the keypad. ✓ writes the day's total in one write; a day already logged opens on
/// its total, and a field left as it opened is not written.
struct IntakeSheet: View {
    let corps: CorpsModel
    @State private var date: Date
    @State private var kcal = ""
    @State private var protein = ""
    @State private var opened = (kcal: "", protein: "")
    @FocusState private var typing: Bool

    init(corps: CorpsModel) {
        self.corps = corps
        _date = State(initialValue: corps.now())
    }

    private var day: String { toISODate(date, timeZone: corps.timeZone) }

    /// The field as saved: as it opened, emptied, or a whole number within `valid`; nil when it
    /// does not read.
    private func edit(_ text: String, opened: String, _ valid: (Double) -> Bool) -> FieldEdit<Int>? {
        let text = text.trimmingCharacters(in: .whitespaces)
        if text == opened { return .keep }
        if text.isEmpty { return .clear }
        return Int(text).flatMap { valid(Double($0)) ? .set($0) : nil }
    }

    private var edits: (kcal: FieldEdit<Int>, protein: FieldEdit<Int>)? {
        guard let k = edit(kcal, opened: opened.kcal, isKcal), let p = edit(protein, opened: opened.protein, isProteinG)
        else { return nil }
        return (k, p)
    }

    var body: some View {
        EntrySheet(
            title: Text("Apports", tableName: "Entries"), symbol: "fork.knife", domain: .intake, date: $date,
            latest: corps.now(), canSave: edits != nil && !(kcal.isEmpty && protein.isEmpty), id: "intake",
            save: {
                guard let edits else { return }
                corps.logIntake(date: day, kcal: edits.kcal, protein: edits.protein)
            },
            footer: Text("Un total par jour, pas aliment par aliment.", tableName: "Entries")
        ) {
            EntryField(
                label: Text("Calories", tableName: "Entries"), unit: Text("kcal", tableName: "Entries"), text: $kcal,
                keyboard: .numberPad, id: "intake-kcal-field"
            )
            .focused($typing)
            EntryField(
                label: Text("Protéines", tableName: "Entries"), unit: Text("g", tableName: "Entries"), text: $protein,
                keyboard: .numberPad, id: "intake-protein-field")
        }
        .onChange(of: day, initial: true) { _, day in
            let held = corps.intake(on: day)
            kcal = held?.kcal.map(String.init) ?? ""
            protein = held?.proteinG.map(String.init) ?? ""
            opened = (kcal, protein)
        }
        .task {
            // The keypad rises with the sheet, as in Santé: focus once the sheet has landed.
            try? await Task.sleep(for: .milliseconds(500))
            typing = true
        }
    }
}
