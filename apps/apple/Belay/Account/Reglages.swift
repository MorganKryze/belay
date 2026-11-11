import BelayCore
import os
import SwiftUI

/// Réglages, reached from Accueil's avatar: the Santé switch, then the way out. Signing out asks
/// first, as the system does for a destructive action, and says what still waits to be sent, since
/// it leaves with the next sign-in of this account only.
struct ReglagesView: View {
    let account: AccountModel
    let store: AccountStore
    @State private var asking = false
    /// The switch as the store keeps it, read when the page opens.
    @State private var healthOn = false
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
                } header: {
                    Text("Sur cet iPhone", tableName: "Health")
                } footer: {
                    if refused {
                        Text(
                            "Santé n’autorise pas Belay à y écrire tes séances. Autorise-le dans l’app Santé, puis réessaie.",
                            tableName: "Health")
                    } else {
                        Text(
                            "Tes séances terminées vont dans Santé avec leur intensité, à partir du moment où tu actives. Désactiver laisse dans Santé ce qui y est déjà.",
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
            healthOn = try store.healthSettings().on
        } catch {
            Self.log.error("health switch not read: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }

    /// On asks iOS at that moment; it shows as on only once iOS lets Belay write workouts.
    private func switchHealth(_ on: Bool) {
        guard on else {
            if account.turnHealthOff() { healthOn = false }
            return
        }
        healthOn = true
        Task {
            let allowed = await account.turnHealthOn()
            healthOn = allowed
            refused = !allowed
        }
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
