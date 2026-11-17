import BelayCore
import os
import SwiftUI

/// Réglages, reached from Accueil's avatar: the refused entries while there are any, the profile
/// cell, the display rows, Suivi, the Santé switches, then the account and the way out.
struct ReglagesView: View {
    let account: AccountModel
    let store: AccountStore
    let corps: CorpsModel
    /// Pushes Profil or Mes compléments on the stack Réglages sits in.
    let open: (Route) -> Void
    /// The switch as the store keeps it, read when the page opens.
    @State private var healthOn = false
    /// The imports' switches, which go on only with Santé's, and turn it on first.
    @State private var importOn = false
    @State private var stepsOn = false
    /// The switch whose last turn-on iOS refused, Santé's own or one turning it on; it can try again.
    @State private var refused: HealthSwitch?
    /// The server's refusals, read again at each sync that records one.
    @State private var refusals: [RejectedEntry] = []

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "settings")

    var body: some View {
        List {
            RefusedSection(store: store, corps: corps, entries: refusals)
            profileCell
            DisplayRows()
            suivi
            if HealthKitWriter.available {
                Section {
                    Toggle(isOn: Binding(get: { healthOn }, set: switchHealth)) {
                        Text("Apple Santé", tableName: "Health")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("health-switch")
                    Toggle(isOn: Binding(get: { importOn }, set: switchImport)) {
                        Text("Importer les pesées de Santé", tableName: "Health")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("health-import-switch")
                    Toggle(isOn: Binding(get: { stepsOn }, set: switchSteps)) {
                        Text("Importer les pas de Santé", tableName: "Health")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("health-steps-switch")
                } header: {
                    Text("Sur cet iPhone", tableName: "Health")
                } footer: {
                    Group {
                        if let refused {
                            refused.refusal
                        } else {
                            Text(
                                "Tes séances terminées, avec leur intensité, et tes pesées vont dans Santé à partir du moment où tu actives. Importer les pesées ajoute à Belay celles d’une balance connectée ou saisies dans Santé ; une pesée déjà dans Belay n’est jamais remplacée. Importer les pas ajoute tes pas de Santé des 7 derniers jours ; des pas saisis ailleurs ne sont jamais remplacés. Si rien n’arrive, vérifie que Belay peut lire le poids et les pas dans l’app Santé › ta photo › Confidentialité › Apps › Belay. Désactiver laisse dans Santé ce qui y est déjà.",
                                tableName: "Health")
                        }
                    }
                    .accessibilityIdentifier("health-footer")
                }
                .listRowBackground(Color.surface)
            }
            AccountSection(account: account, pending: pending)
        }
        .belayList()
        .background { Wall() }
        .navigationTitle("Réglages")
        .largeTitleOnly()
        .onAppear(perform: readHealth)
        .task(followRefusals)
    }

    private func followRefusals() async {
        do {
            for try await entries in store.observe({ try AccountStore.rejected($0) }) { refusals = entries }
        } catch {
            Self.log.error("refusals not followed: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    /// The initial in its disc, the name, and what Profil holds.
    private var profileCell: some View {
        Section {
            Button { open(.profile) } label: {
                ProfileCellLayout {
                    Avatar(letter: account.displayName?.first.map { String($0).localizedUppercase }, size: 52)
                        .font(.title2)
                        .accessibilityHidden(true)
                } words: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: account.displayName ?? String(localized: "Profil", table: "Reglages"))
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(.ink)
                        Text("Profil · taille, âge, fourchette de perte", tableName: "Reglages")
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                    }
                }
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("reglages-profile")
        }
        .listRowBackground(Color.surface)
    }

    /// Suivi: Mes compléments, with how many the list holds.
    private var suivi: some View {
        Section {
            Button { open(.manageSupplements) } label: {
                ValueRowLayout {
                    RowName(title: "Compléments", symbol: "pills")
                } value: {
                    HStack(spacing: 5) {
                        Text(supplementsCount).foregroundStyle(.muted)
                        Image(systemName: "chevron.forward")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.muted)
                            .accessibilityHidden(true)
                    }
                }
                .frame(minHeight: 52)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("reglages-supplements")
        } header: {
            Text("Suivi", tableName: "Reglages")
        }
        .listRowBackground(Color.surface)
    }

    private var supplementsCount: String {
        let count = corps.supplementList.count
        return count == 0
            ? String(localized: "aucun", table: "Reglages") : String(localized: "\(count) dans ta liste", table: "Reglages")
    }

    /// What waits to be sent; in a debug build the UI tests can make it unreadable.
    private func pending() throws -> Int {
        #if DEBUG
            if Fixture.queueUnreadable { throw CocoaError(.fileReadUnknown) }
        #endif
        return try store.outbox(limit: nil).count
    }

    private func readHealth() {
        do {
            let settings = try store.healthSettings()
            healthOn = settings.on
            importOn = settings.importOn
            stepsOn = settings.stepsOn
        } catch {
            Self.log.error("health switch not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    /// On asks iOS at that moment; it shows as on only once iOS lets Belay write workouts.
    private func switchHealth(_ on: Bool) {
        guard on else {
            if account.turnHealthOff() { (healthOn, importOn, stepsOn) = (false, false, false) }
            return
        }
        healthOn = true
        Task {
            let allowed = await account.turnHealthOn()
            healthOn = allowed
            refused = allowed ? nil : .sante
        }
    }

    /// On asks iOS to let Belay read body mass; iOS never says whether it did, so the switch stays
    /// on and the footer says where to allow it.
    private func switchImport(_ on: Bool) {
        guard on else {
            if account.turnHealthImportOff() { importOn = false }
            return
        }
        importOn = true
        Task { importOn = await turnedOn(.weighIns, account.turnHealthImportOn) }
    }

    /// As the weigh-in import's, for the step count.
    private func switchSteps(_ on: Bool) {
        guard on else {
            if account.turnHealthStepsOff() { stepsOn = false }
            return
        }
        stepsOn = true
        Task { stepsOn = await turnedOn(.steps, account.turnHealthStepsOn) }
    }

    /// An import's turn-on, which turns Santé on first: Santé's switch follows, and a refusal is
    /// said in that import's words.
    private func turnedOn(_ which: HealthSwitch, _ turnOn: () async -> Bool) async -> Bool {
        let on = await turnOn()
        do {
            healthOn = try store.healthSettings().on
        } catch {
            Self.log.error("health switch not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
        refused = healthOn ? nil : which
        return on
    }
}

/// The switches of « Sur cet iPhone », each saying in its own words what iOS refused (R18).
private enum HealthSwitch {
    case sante, weighIns, steps

    var refusal: Text {
        switch self {
        case .sante:
            Text(
                "Santé n’autorise pas Belay à y écrire tes séances. Autorise-le dans l’app Santé, puis réessaie.",
                tableName: "Health")
        case .weighIns:
            Text(
                "Pour importer tes pesées, Belay a besoin de l’accès à Santé. Autorise-le dans l’app Santé, puis réessaie.",
                tableName: "Health")
        case .steps:
            Text(
                "Pour importer tes pas, Belay a besoin de l’accès à Santé. Autorise-le dans l’app Santé, puis réessaie.",
                tableName: "Health")
        }
    }
}

/// The profile cell's disc beside its words; at the accessibility sizes, above them.
private struct ProfileCellLayout<Disc: View, Words: View>: View {
    @ViewBuilder let disc: Disc
    @ViewBuilder let words: Words
    @Environment(\.dynamicTypeSize) private var type

    var body: some View {
        if type.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) { disc; words }
        } else {
            HStack(spacing: 14) { disc; words }
        }
    }
}
