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
    /// The import's switch, which goes on only with Santé's.
    @State private var importOn = false
    /// iOS did not let Belay write workouts at the last turn-on; the switch can try again.
    @State private var refused = false

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "settings")

    var body: some View {
        List {
            RefusedSection(store: store, corps: corps)
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
                    .disabled(!healthOn)
                    .accessibilityIdentifier("health-import-switch")
                } header: {
                    Text("Sur cet iPhone", tableName: "Health")
                } footer: {
                    if refused {
                        Text(
                            "Santé n’autorise pas Belay à y écrire tes séances. Autorise-le dans l’app Santé, puis réessaie.",
                            tableName: "Health")
                    } else {
                        Text(
                            "Tes séances terminées, avec leur intensité, et tes pesées vont dans Santé à partir du moment où tu actives. Importer ajoute à Belay les pesées d’une balance connectée ou saisies dans Santé ; une pesée déjà dans Belay n’est jamais remplacée. Si aucune n’arrive, vérifie que Belay peut lire le poids dans l’app Santé › ta photo › Confidentialité › Apps › Belay. Désactiver laisse dans Santé ce qui y est déjà.",
                            tableName: "Health")
                    }
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
        } catch {
            Self.log.error("health switch not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    /// On asks iOS at that moment; it shows as on only once iOS lets Belay write workouts.
    private func switchHealth(_ on: Bool) {
        guard on else {
            if account.turnHealthOff() { (healthOn, importOn) = (false, false) }
            return
        }
        healthOn = true
        Task {
            let allowed = await account.turnHealthOn()
            healthOn = allowed
            refused = !allowed
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
        Task { importOn = await account.turnHealthImportOn() }
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
