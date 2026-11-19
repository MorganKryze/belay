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
    /// Where a prefilled value comes from, under the name.
    var source: SourceLine? = nil
    let id: String
    /// The page's focus, shared by its fields; the field's own outside a tool page.
    @Environment(\.toolFocus) private var pageFocus
    @FocusState private var typing: Bool
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let layout =
            typeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            VStack(alignment: .leading, spacing: 1) {
                Text(label, tableName: "Outils").foregroundStyle(.ink)
                source
            }
            HStack(spacing: 6) {
                Spacer(minLength: 0)
                withFocus(TextField(text: $text, prompt: Text(verbatim: prompt)) { Text(label, tableName: "Outils") })
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                    .accessibilityLabel(Text(label, tableName: "Outils"))
                    .accessibilityIdentifier(id)
                Text(unit, tableName: "Outils").foregroundStyle(.muted).accessibilityHidden(true)
            }
        }
        .frame(minHeight: 52)
        .contentShape(.rect)
        // The whole row opens the keypad, not only the figure at its end.
        .onTapGesture {
            if let pageFocus { pageFocus.wrappedValue = id } else { typing = true }
        }
    }

    @ViewBuilder private func withFocus(_ field: some View) -> some View {
        if let pageFocus { field.focused(pageFocus, equals: id) } else { field.focused($typing) }
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
    /// A muted line under the value: what the count follows.
    var hint: LocalizedStringKey? = nil
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        let words = VStack(alignment: .leading, spacing: 1) {
            Text(label, tableName: "Outils").foregroundStyle(.ink)
            shown.font(.title3.weight(.semibold)).monospacedDigit().foregroundStyle(.ink)
            if let hint {
                Text(hint, tableName: "Outils").font(.footnote).foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
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

/// A weight typed in the unit chosen in Réglages and kept in kilos: the keypad shows and takes
/// pounds while the unit is lb, and the model only ever holds kilos. A figure typed again as it
/// was shown gives back the kilos the field opened on, so 80 kg read as 176 lb stays 80, not the
/// 79,83 that 176 lb converts to.
struct WeightField: View {
    let label: LocalizedStringKey
    /// The kilos as the model keeps them: empty, a figure, or text that reads as none.
    @Binding var kg: String
    /// The web's kilo step for the field: its pounds set how finely a figure shows.
    let step: Double
    /// The kilos the grey placeholder shows.
    let prompt: Double
    let id: String
    @State private var text: String
    /// The kilos the field shows since it opened or the unit changed, which `readBack` keeps.
    @State private var shownKg: Double?
    /// What the field last handed back, so a change of its own does not reset what is typed.
    @State private var handed: String?

    init(label: LocalizedStringKey, kg: Binding<String>, step: Double, prompt: Double, id: String) {
        self.label = label
        _kg = kg
        self.step = step
        self.prompt = prompt
        self.id = id
        _text = State(initialValue: OutilsModel.shownText(kg.wrappedValue, step: step))
        _shownKg = State(initialValue: SetText.parseKg(kg.wrappedValue))
    }

    var body: some View {
        let unit = SetText.unit
        KeypadField(
            label: label, text: $text, unit: LocalizedStringKey(unit.rawValue),
            prompt: OutilsModel.weightText(prompt, step: step), id: id
        )
        .onChange(of: unit) { reset() }
        .onChange(of: kg) { if kg != handed { reset() } }
        .onChange(of: text) { handBack() }
    }

    /// Shows the model's kilos again, in the unit now chosen.
    private func reset() {
        shownKg = SetText.parseKg(kg)
        text = OutilsModel.shownText(kg, step: step)
    }

    private func handBack() {
        let typed = text.trimmingCharacters(in: .whitespaces)
        let next: String
        if typed.isEmpty {
            next = ""
        } else if let value = OutilsModel.kg(fromShown: typed, step: step, prefill: shownKg) {
            // The same kilos keep the model's text, so a working load does not lose its count.
            next = value == SetText.parseKg(kg) ? kg : String(value)
        } else {
            // Unreadable: kept as typed, which reads as outside the bounds.
            next = typed
        }
        handed = next
        if next != kg { kg = next }
    }
}

/// A typed load as kilos within the web's 1 to 500 kg, nil while empty, `.outside` past them. In
/// pounds the load must also fall within those bounds as `rangeIn` rounds them to the field's step,
/// and under `cap`, so the line that gives the bounds holds for every value it refuses.
enum TypedLoad: Equatable {
    case empty, outside
    case kg(Double)

    static let range = 1.0...500.0

    /// `text` holds kilos; `step` is the web's kilo step for the field.
    init(_ text: String, step: Double, cap: Double = .infinity, unit: WeightUnit = SetText.unit) {
        guard !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            self = .empty
            return
        }
        guard let kg = SetText.parseKg(text), kg.isFinite, Self.range.contains(kg),
            unit == .kg || Self.bounds(step: step, cap: cap, unit: unit).contains(loadFromKg(kg, unit))
        else {
            self = .outside
            return
        }
        self = .kg(kg)
    }

    /// The bounds in the unit shown: 1 to 500 kg, or 5 to 1 100 lb on a 2,5 kg step.
    static func bounds(step: Double, cap: Double = .infinity, unit: WeightUnit = SetText.unit) -> ClosedRange<Double> {
        let shown = rangeIn(range, unit, step: stepIn(step, unit))
        return shown.lowerBound...min(shown.upperBound, cap)
    }
}

/// Where a prefilled field's value comes from, under the field in muted words: « depuis ton
/// profil », « ta moyenne 7 jours ». Réglages › Outils › « Origine des champs » hides every one;
/// a field the person changes drops its own.
struct SourceLine: View {
    let source: ToolSource
    /// The zone the measures' day is read in.
    let timeZone: TimeZone
    @State private var shown = DevicePrefs.fieldSources.value == .shown

    var body: some View {
        if shown {
            text.font(.footnote).foregroundStyle(.muted).accessibilityIdentifier("tool-source")
        }
    }

    private var text: Text {
        switch source {
        case .profile: Text("depuis ton profil", tableName: "Outils")
        case .birthYear: Text("depuis ton année de naissance", tableName: "Outils")
        case .average: Text("ta moyenne 7 jours", tableName: "Outils")
        case .weighing: Text("ta dernière pesée", tableName: "Outils")
        case .measures(let day): Text("mensurations du \(Self.day(day, in: timeZone))", tableName: "Outils")
        }
    }

    /// « 14 nov. » for « 2026-11-14 », read in `zone`.
    private static func day(_ iso: String, in zone: TimeZone) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3,
            let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
        else { return iso }
        var style = Date.FormatStyle(date: .abbreviated, time: .omitted).day().month(.abbreviated)
        style.timeZone = zone
        return date.formatted(style)
    }
}

/// « Reprendre mes dernières saisies »: back to the values typed on this phone, over the
/// profile's and the weigh-ins'.
struct RestoreRow: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label {
                Text("Reprendre mes dernières saisies", tableName: "Outils").foregroundStyle(.ink)
            } icon: {
                Image(systemName: "arrow.uturn.backward").foregroundStyle(.muted)
            }
            .frame(minHeight: 44)
        }
        .accessibilityIdentifier("tool-restore")
    }
}

/// The web's proposal when a value typed differs from the profile's: « Mettre à jour » writes the
/// profile fact, « Non, juste ici » keeps the value to this tool.
struct ProfileProposal: View {
    /// The profile's value and the one typed, as they read: « 180 cm », « 182 cm ».
    let profile: String
    let value: String
    let update: () -> Void
    let justHere: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Ton profil indique **\(profile)**. Mettre à jour ton profil avec **\(value)**\u{202F}?", tableName: "Outils")
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
            ViewThatFits {
                HStack(spacing: 10) { buttons }
                VStack(alignment: .leading, spacing: 8) { buttons }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Mise à jour du profil", tableName: "Outils"))
        .accessibilityIdentifier("tool-proposal")
    }

    @ViewBuilder private var buttons: some View {
        Button(action: update) {
            Text("Mettre à jour", tableName: "Outils").font(.subheadline.weight(.semibold))
                .foregroundStyle(.surface).padding(.horizontal, 16).frame(minHeight: 44)
                .background(Color.ink, in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("tool-proposal-update")
        Button(action: justHere) {
            Text("Non, juste ici", tableName: "Outils").font(.subheadline.weight(.semibold))
                .foregroundStyle(.ink).padding(.horizontal, 16).frame(minHeight: 44)
                .background(Color.track, in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("tool-proposal-here")
    }
}
