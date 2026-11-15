import BelayCore
import os
import SwiftUI

/// Réglages, reached from Accueil's avatar: the Santé switches, then the way out. Signing out asks
/// first, as the system does for a destructive action, and says what still waits to be sent, since
/// it leaves with the next sign-in of this account only.
struct ReglagesView: View {
    let account: AccountModel
    let store: AccountStore
    @State private var asking = false
    /// The switch as the store keeps it, read when the page opens.
    @State private var healthOn = false
    /// The import's switch, which goes on only with Santé's.
    @State private var importOn = false
    /// iOS did not let Belay write workouts at the last turn-on; the switch can try again.
    @State private var refused = false
    /// What the queue holds when the person asks; nil when the store could not say.
    @State private var waiting: Int?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "settings")

    var body: some View {
        List {
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
            Section {
                Button(role: .destructive, action: ask) {
                    Text("Se déconnecter", tableName: "Account")
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .accessibilityIdentifier("signout")
            }
            .listRowBackground(Color.surface)
        }
        .belayList()
        .background { Wall() }
        .navigationTitle("Réglages")
        .largeTitleOnly()
        .onAppear(perform: readHealth)
        .confirmationDialog(
            Text("Se déconnecter\u{202F}?", tableName: "Account"), isPresented: $asking, titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                Task { await account.signOut() }
            } label: {
                Text("Se déconnecter", tableName: "Account")
            }
            .accessibilityIdentifier("signout-confirm")
            Button(role: .cancel) {} label: {
                Text("Annuler", tableName: "Account")
            }
        } message: {
            message
        }
    }

    private var message: Text {
        switch waiting {
        case 0: Text("Rien n’attend d’être envoyé.", tableName: "Account")
        case let count?: Text("\(count) saisies partiront à ta prochaine connexion.", tableName: "Account")
        case nil: Text("Ce qui attend d’être envoyé partira à ta prochaine connexion.", tableName: "Account")
        }
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

    private func ask() {
        do {
            waiting = try store.outbox(limit: nil).count
        } catch {
            Self.log.error("queue not read: \(AccountStore.logLabel(error), privacy: .public)")
            waiting = nil
        }
        asking = true
    }
}
