import BelayCore
import SwiftUI

/// Réglages' Général, Unités, Accueil, Séances, Corps and Outils sections: the language, the theme,
/// the weight unit and the rows that change what a screen shows. Each choice stays on this phone under the web's key name
/// and reaches its screen at once.
struct DisplayRows: View {
    @AppStorage(DevicePrefs.theme.key) private var theme = DevicePrefs.theme.initial
    @AppStorage(DevicePrefs.pauseStops.key) private var pauseStops = DevicePrefs.pauseStops.initial
    @AppStorage(DevicePrefs.restSound.key) private var restSound = DevicePrefs.restSound.initial
    @AppStorage(DevicePrefs.historyActivities.key) private var historyActivities = DevicePrefs.historyActivities.initial
    @AppStorage(DevicePrefs.homeTrend.key) private var homeTrend = DevicePrefs.homeTrend.initial
    @AppStorage(DevicePrefs.sessionVolume.key) private var sessionVolume = DevicePrefs.sessionVolume.initial
    @AppStorage(DevicePrefs.rangePill.key) private var rangePill = DevicePrefs.rangePill.initial
    @AppStorage(DevicePrefs.weekIntake.key) private var weekIntake = DevicePrefs.weekIntake.initial
    @AppStorage(DevicePrefs.brzycki.key) private var brzycki = DevicePrefs.brzycki.initial
    @AppStorage(DevicePrefs.fieldSources.key) private var fieldSources = DevicePrefs.fieldSources.initial
    @Bindable private var units = WeightUnitChoice.shared
    @Environment(\.openURL) private var openURL

    var body: some View {
        Group {
            Section {
                languageRow
                MenuRow(title: "Thème", symbol: "circle.lefthalf.filled", value: themeName(theme), id: "reglages-theme") {
                    Picker(selection: $theme) {
                        ForEach([DevicePrefs.Theme.light, .dark, .system], id: \.self) { Text(themeName($0)).tag($0) }
                    } label: {
                        Text("Thème", tableName: "Reglages")
                    }
                }
            } header: {
                Text("Général", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            } footer: {
                Text("La langue se choisit dans les Réglages de l’iPhone, comme pour toute app.", tableName: "Reglages")
            }
            Section {
                weightUnitRow
            } header: {
                Text("Unités", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            } footer: {
                Text("Belay garde tout en kilos\u{202F}: changer d’unité ne touche à aucune saisie.", tableName: "Reglages")
            }
            Section {
                switchRow("Tendance", "chart.line.downtrend.xyaxis", $homeTrend, id: "reglages-trend")
            } header: {
                Text("Accueil", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            }
            Section {
                MenuRow(title: "En pause", symbol: "pause.circle", value: pauseName(pauseStops), id: "reglages-pause") {
                    Picker(selection: $pauseStops) {
                        ForEach([PauseStops.all, .session], id: \.self) { Text(pauseName($0)).tag($0) }
                    } label: {
                        Text("En pause", tableName: "Reglages")
                    }
                }
                MenuRow(
                    title: "Historique", symbol: "calendar", value: historyName(historyActivities), id: "reglages-history"
                ) {
                    Picker(selection: $historyActivities) {
                        ForEach([DevicePrefs.Shown.shown, .hidden], id: \.self) { Text(historyName($0)).tag($0) }
                    } label: {
                        Text("Historique", tableName: "Reglages")
                    }
                }
                switchRow("Volume", "dumbbell", $sessionVolume, id: "reglages-volume")
                // Last in the group, so the silent-mode footer reads under the row it explains.
                MenuRow(title: "Son de fin de repos", symbol: "bell", value: soundName(restSound), id: "reglages-rest-sound") {
                    Picker(selection: $restSound) {
                        ForEach([DevicePrefs.RestSound.off, .on, .over], id: \.self) { Text(soundName($0)).tag($0) }
                    } label: {
                        Text("Son de fin de repos", tableName: "Reglages")
                    }
                }
                // The tone once, as it will ring: the choice is heard as it is made.
                .onChange(of: restSound) { _, choice in RestTone.play(choice) }
                #if DEBUG
                .overlay(alignment: .topTrailing) { Fixture.RestProbe() }
                #endif
            } header: {
                Text("Séances", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            } footer: {
                Text("En mode silencieux, iOS coupe le son de l’alerte quand Belay n’est pas à l’écran.", tableName: "Reglages")
            }
            Section {
                switchRow("Pastille", "checkmark.seal", $rangePill, id: "reglages-pill")
                switchRow("Apports", "fork.knife", $weekIntake, id: "reglages-intake")
            } header: {
                Text("Corps", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            }
            Section {
                MenuRow(title: "1RM", symbol: "function", value: formulasName(brzycki), id: "reglages-one-rep-max") {
                    Picker(selection: $brzycki) {
                        ForEach([DevicePrefs.Shown.shown, .hidden], id: \.self) { Text(formulasName($0)).tag($0) }
                    } label: {
                        Text("1RM", tableName: "Reglages")
                    }
                }
                switchRow("Origine des champs", "info.circle", $fieldSources, id: "reglages-sources")
            } header: {
                Text("Outils", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            }
        }
        .listRowBackground(Color.surface)
    }

    /// The app's language in its own words; a tap opens Belay's page of the iPhone's Réglages,
    /// where iOS lets each app have its own language.
    private var languageRow: some View {
        Button {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
            ValueRowLayout {
                RowName(title: "Langue", symbol: "globe")
            } value: {
                HStack(spacing: 5) {
                    Text(verbatim: Self.language).foregroundStyle(.muted)
                    Image(systemName: "arrow.up.forward.app")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.muted)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .frame(minHeight: 52)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Ouvre les Réglages de l’iPhone", tableName: "Reglages"))
        .accessibilityIdentifier("reglages-language")
    }

    /// « Poids » with kg | lb in the row; VoiceOver says each unit as a word.
    private var weightUnitRow: some View {
        HStack(spacing: 5) {
            RowName(title: "Poids", symbol: "scalemass").accessibilityHidden(true)
            Spacer(minLength: 12)
            Picker(selection: $units.unit) {
                ForEach(WeightUnit.allCases, id: \.self) { unit in
                    Text(verbatim: unit.rawValue).accessibilityLabel(unitWord(unit)).tag(unit)
                }
            } label: {
                Text("Poids", tableName: "Reglages")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            // Each half a full 44 pt target, as wide as the prototype draws the control.
            .controlSize(.large)
            .frame(width: 112)
            .accessibilityLabel(Text("Poids", tableName: "Reglages"))
            .sensoryFeedback(.selection, trigger: units.unit)
        }
        .frame(minHeight: 52)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("reglages-weight-unit")
    }

    private func unitWord(_ unit: WeightUnit) -> Text {
        switch unit {
        case .kg: Text("kilos", tableName: "Reglages")
        case .lb: Text("livres", tableName: "Reglages")
        }
    }

    /// « Français » or « English », as the app runs now.
    private static var language: String {
        let code = Bundle.main.preferredLocalizations.first ?? "fr"
        let own = Locale(identifier: code)
        return own.localizedString(forLanguageCode: code)?.capitalized(with: own) ?? code
    }

    private func switchRow(
        _ title: String, _ symbol: String, _ choice: Binding<DevicePrefs.Shown>, id: String
    ) -> some View {
        Toggle(isOn: Binding(get: { choice.wrappedValue == .shown }, set: { choice.wrappedValue = $0 ? .shown : .hidden })) {
            RowName(title: title, symbol: symbol)
        }
        .frame(minHeight: 52)
        .accessibilityIdentifier(id)
    }

    private func themeName(_ theme: DevicePrefs.Theme) -> String {
        switch theme {
        case .light: String(localized: "Clair", table: "Reglages")
        case .dark: String(localized: "Sombre", table: "Reglages")
        case .system: String(localized: "Système", table: "Reglages")
        }
    }

    private func pauseName(_ stops: PauseStops) -> String {
        switch stops {
        case .all: String(localized: "Tout s’arrête", table: "Reglages")
        case .session: String(localized: "Le repos continue", table: "Reglages")
        }
    }

    private func soundName(_ sound: DevicePrefs.RestSound) -> String {
        switch sound {
        case .off: String(localized: "Coupé", table: "Reglages")
        case .on: String(localized: "Discret", table: "Reglages")
        case .over: String(localized: "Toujours", table: "Reglages")
        }
    }

    private func historyName(_ activities: DevicePrefs.Shown) -> String {
        switch activities {
        case .shown: String(localized: "Avec activités", table: "Reglages")
        case .hidden: String(localized: "Séances seules", table: "Reglages")
        }
    }

    private func formulasName(_ brzycki: DevicePrefs.Shown) -> String {
        switch brzycki {
        case .shown: String(localized: "Deux formules", table: "Reglages")
        case .hidden: String(localized: "Epley seule", table: "Reglages")
        }
    }
}

/// A row's name with its symbol.
struct RowName: View {
    /// The key in the Reglages table.
    let title: String
    let symbol: String

    var body: some View {
        Label {
            Text(LocalizedStringKey(title), tableName: "Reglages").foregroundStyle(.ink)
        } icon: {
            Image(systemName: symbol).foregroundStyle(.muted)
        }
    }
}

/// The name, then its value at the trailing edge; at the accessibility sizes the value goes under
/// the name, so no word breaks.
struct ValueRowLayout<Name: View, Value: View>: View {
    @ViewBuilder let name: Name
    @ViewBuilder let value: Value
    @Environment(\.dynamicTypeSize) private var type

    var body: some View {
        if type.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) { name; value }
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            HStack(spacing: 5) { name; Spacer(minLength: 12); value }
        }
    }
}

/// A choice among a few, as a menu on its row: the name, the value chosen, the menu's chevrons.
private struct MenuRow<Options: View>: View {
    /// The key in the Reglages table.
    let title: String
    let symbol: String
    let value: String
    let id: String
    @ViewBuilder let options: Options

    var body: some View {
        Menu {
            options
        } label: {
            ValueRowLayout {
                RowName(title: title, symbol: symbol)
            } value: {
                HStack(spacing: 5) {
                    Text(verbatim: value).foregroundStyle(.muted)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.muted)
                        .accessibilityHidden(true)
                }
            }
            .contentShape(.rect)
        }
        .frame(minHeight: 52)
        .accessibilityLabel(Text(verbatim: "\(String(localized: String.LocalizationValue(title), table: "Reglages")), \(value)"))
        .accessibilityIdentifier(id)
    }
}
