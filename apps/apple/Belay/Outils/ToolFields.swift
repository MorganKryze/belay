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
                TextField(text: $text, prompt: Text(verbatim: prompt)) { Text(label, tableName: "Outils") }
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                    .focused($typing)
                    .accessibilityLabel(Text(label, tableName: "Outils"))
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
