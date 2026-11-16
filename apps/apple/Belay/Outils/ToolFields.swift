import BelayCore
import SwiftUI

/// A load, a weight, a height or a girth, typed on the decimal keypad as Santé enters a measure:
/// the name, the value aligned right, the unit. At the accessibility sizes the value goes under
/// the name, so it keeps the row's width.
struct KeypadField: View {
    let label: LocalizedStringKey
    @Binding var text: String
    var unit: LocalizedStringKey = "kg"
    /// The grey value while the field is empty.
    var prompt = ""
    let id: String
    @FocusState private var typing: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            Text(label, tableName: "Outils").foregroundStyle(.ink)
            HStack(spacing: 6) {
                Spacer(minLength: 0)
                TextField(text: $text, prompt: Text(verbatim: prompt)) { Text(label, tableName: "Outils") }
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                    .focused($typing)
                    .accessibilityIdentifier(id)
                Text(unit, tableName: "Outils").foregroundStyle(.muted).accessibilityHidden(true)
            }
        }
        .frame(minHeight: 52)
        .contentShape(.rect)
        // The whole row opens the keypad, not only the figure at its end.
        .onTapGesture { typing = true }
    }
}

/// A small whole count on − and +, 48 pt each: repetitions, warm-up sets. The name and the
/// value read as one element, the buttons each say what they add or take away.
struct CountStepper: View {
    let label: LocalizedStringKey
    /// The value as words: « 6 », « 2 séries ».
    let shown: Text
    @Binding var value: Int
    let range: ClosedRange<Int>
    /// Spoken after the verb: « Ajouter une répétition ».
    let what: String
    let id: String
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let words = VStack(alignment: .leading, spacing: 1) {
            Text(label, tableName: "Outils").foregroundStyle(.ink)
            shown.font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
        let buttons = Nudge(
            value: Binding(get: { Double(value) }, set: { value = Int($0.rounded()) }),
            range: Double(range.lowerBound)...Double(range.upperBound), step: 1, what: what)
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            words
            if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
            buttons
        }
        .frame(minHeight: 52)
    }
}

/// A typed load as kilos within the web's 1 to 500 kg, nil while empty, `.outside` past them.
enum TypedLoad: Equatable {
    case empty, outside
    case kg(Double)

    static let range = 1.0...500.0

    init(_ text: String) {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            self = .empty
            return
        }
        guard let kg = SetText.parseKg(text), kg.isFinite, Self.range.contains(kg) else {
            self = .outside
            return
        }
        self = .kg(kg)
    }
}
