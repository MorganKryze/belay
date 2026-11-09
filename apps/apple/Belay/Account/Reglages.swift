import BelayCore
import os
import SwiftUI

/// Réglages, reached from Accueil's avatar. Only the way out is native yet: signing out asks first,
/// as the system does for a destructive action, and says what still waits to be sent, since it
/// leaves with the next sign-in of this account only.
struct ReglagesView: View {
    let account: AccountModel
    let store: AccountStore
    @State private var asking = false
    /// What the queue holds when the person asks; nil when the store could not say.
    @State private var waiting: Int?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "settings")

    var body: some View {
        List {
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
