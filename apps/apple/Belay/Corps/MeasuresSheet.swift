import BelayCore
import SwiftUI

/// Mensurations, in the weigh-in sheet's pattern: the day, then the waist, the neck and the hips
/// in cm on the decimal keypad. ✓ turns blue once a field is typed and each typed one sits within
/// its bounds. A day already measured opens on its values; a field left as it opened is not
/// written, so a value another device wrote since stays.
struct MeasuresSheet: View {
    let corps: CorpsModel
    @State private var date: Date
    @State private var texts: [MeasureField: String] = [:]
    @State private var opened: [MeasureField: String] = [:]
    @FocusState private var typing: MeasureField?

    init(corps: CorpsModel) {
        self.corps = corps
        _date = State(initialValue: corps.now())
    }

    private var day: String { toISODate(date, timeZone: corps.timeZone) }

    private static let fields: [MeasureField] = [.waist, .neck, .hip]

    /// The field as saved: as it opened, emptied, or typed within its bounds; nil when it does
    /// not read.
    private func edit(_ field: MeasureField) -> FieldEdit<Double>? {
        let text = texts[field, default: ""].trimmingCharacters(in: .whitespaces)
        if text == opened[field, default: ""] { return .keep }
        if text.isEmpty { return .clear }
        return SetText.parseKg(text).flatMap { isMeasureCm(field, $0) ? .set($0) : nil }
    }

    private var canSave: Bool {
        Self.fields.allSatisfy { edit($0) != nil } && Self.fields.contains { !texts[$0, default: ""].isEmpty }
    }

    var body: some View {
        EntrySheet(
            title: Text("Mensurations", tableName: "Entries"), symbol: "ruler.fill", date: $date, latest: corps.now(),
            canSave: canSave, id: "measures",
            save: {
                guard let waist = edit(.waist), let neck = edit(.neck), let hip = edit(.hip) else { return }
                corps.measure(date: day, waist: waist, neck: neck, hip: hip)
            },
            footer: Text("Taille au nombril pour la formule homme, au plus fin pour la formule femme.", tableName: "Entries")
        ) {
            ForEach(Self.fields, id: \.self) { field in
                EntryField(
                    label: label(field), unit: Text("cm", tableName: "Entries"), text: binding(field),
                    keyboard: .decimalPad, id: "measures-\(field.rawValue)",
                    prompt: corps.lastMeasure(field).map(BodyText.number) ?? ""
                )
                .focused($typing, equals: field)
            }
        }
        .onChange(of: day, initial: true) { _, day in
            let held = corps.measure(on: day)
            var values: [MeasureField: String] = [:]
            let cm: [MeasureField: Double?] = [.waist: held?.waistCm, .neck: held?.neckCm, .hip: held?.hipCm]
            for field in Self.fields { values[field] = (cm[field] ?? nil).map(BodyText.number) ?? "" }
            texts = values
            opened = values
        }
        .task {
            // The keypad rises with the sheet, as in Santé: focus once the sheet has landed.
            try? await Task.sleep(for: .milliseconds(500))
            typing = .waist
        }
    }

    private func label(_ field: MeasureField) -> Text {
        switch field {
        case .waist: Text("Tour de taille", tableName: "Entries")
        case .neck: Text("Cou (option)", tableName: "Entries")
        case .hip: Text("Hanches (option)", tableName: "Entries")
        }
    }

    private func binding(_ field: MeasureField) -> Binding<String> {
        Binding(get: { texts[field, default: ""] }, set: { texts[field] = $0 })
    }
}

/// A sheet's typed row: its name, the value aligned right on the keypad, the unit. At the largest
/// sizes the name goes above the value, so the value keeps the row's width.
struct EntryField: View {
    let label: Text
    let unit: Text
    @Binding var text: String
    let keyboard: UIKeyboardType
    let id: String
    /// The grey value while the field is empty, as the weigh-in shows the last one; nil shows the
    /// field's name.
    var prompt: String? = nil
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout = typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            label.foregroundStyle(.ink)
            HStack(spacing: 6) {
                Spacer(minLength: 0)
                TextField(text: $text, prompt: prompt.map { Text(verbatim: $0) }) { label }
                    .keyboardType(keyboard)
                    .multilineTextAlignment(.trailing)
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .accessibilityIdentifier(id)
                unit.foregroundStyle(.muted)
            }
        }
        .frame(minHeight: 52)
    }
}
