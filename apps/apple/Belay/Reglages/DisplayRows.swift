import BelayCore
import SwiftUI

/// Réglages' Général, Accueil, Séances, Corps and Outils sections: the language, the theme and the
/// rows that change what a screen shows. Each choice stays on this phone under the web's key name
/// and reaches its screen at once.
struct DisplayRows: View {
    @AppStorage(DevicePrefs.theme.key) private var theme = DevicePrefs.theme.initial
    @AppStorage(DevicePrefs.pauseStops.key) private var pauseStops = DevicePrefs.pauseStops.initial
    @AppStorage(DevicePrefs.homeTrend.key) private var homeTrend = DevicePrefs.homeTrend.initial
    @AppStorage(DevicePrefs.sessionVolume.key) private var sessionVolume = DevicePrefs.sessionVolume.initial
    @AppStorage(DevicePrefs.rangePill.key) private var rangePill = DevicePrefs.rangePill.initial
    @AppStorage(DevicePrefs.brzycki.key) private var brzycki = DevicePrefs.brzycki.initial
    @AppStorage(DevicePrefs.fieldSources.key) private var fieldSources = DevicePrefs.fieldSources.initial
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
                switchRow("Volume", "scalemass", $sessionVolume, id: "reglages-volume")
            } header: {
                Text("Séances", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            }
            Section {
                switchRow("Pastille", "checkmark.seal", $rangePill, id: "reglages-pill")
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
