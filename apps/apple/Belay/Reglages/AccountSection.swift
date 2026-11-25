import BelayCore
import os
import SwiftUI

/// Réglages' Compte: the name the instance gives and its address, with no participle that would
/// guess a gender, « Se déconnecter » in red, and the installed version opening its release notes.
/// Signing out asks first in a centred alert, in the web's words for what still waits to be sent,
/// since it leaves with the next sign-in of this account only (A30, A31).
struct AccountSection: View {
    let account: AccountModel
    /// What the queue holds now; throws when the store cannot say.
    let pending: () throws -> Int
    @State private var asking = false
    /// What waits to be sent when the person asked; nil when the store could not say.
    @State private var waiting: Int?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "settings")

    var body: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "server.rack").foregroundStyle(.muted).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Text(verbatim: account.displayName ?? account.lastAddress).foregroundStyle(.ink)
                    Text(verbatim: account.lastAddress).font(.subheadline).foregroundStyle(.muted)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("account-line")
            Button(role: .destructive, action: ask) {
                Text("Se déconnecter", tableName: "Account").frame(maxWidth: .infinity, minHeight: 44)
            }
            .foregroundStyle(.danger)
            .accessibilityIdentifier("signout")
        } header: {
            Text("Compte", tableName: "Account").textCase(nil).foregroundStyle(.ink)
        } footer: {
            versionLine
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
        .alert(Text("Se déconnecter\u{202F}?", tableName: "Account"), isPresented: $asking) {
            Button(role: .cancel) {} label: { Text("Annuler", tableName: "Account") }
            Button(role: .destructive) {
                Task { await account.signOut() }
            } label: {
                if waiting == 0 {
                    Text("Se déconnecter", tableName: "Account")
                } else {
                    Text("Se déconnecter quand même", tableName: "Account")
                }
            }
            .accessibilityIdentifier("signout-confirm")
        } message: {
            message
        }
    }

    /// « Belay 0.1 · notes de version », the installed app's, opening its release notes as the
    /// web's `releaseUrl` builds them.
    private var versionLine: some View {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let words = Text("Belay \(version) · notes de version", tableName: "Account")
            .font(.footnote)
            .foregroundStyle(.muted)
            .frame(maxWidth: .infinity, minHeight: 44)
        return Group {
            if let notes = URL(string: "https://github.com/MorganKryze/belay/releases/tag/v\(version)") {
                Link(destination: notes) { words }
            } else {
                words
            }
        }
        .accessibilityIdentifier("version-line")
    }

    private var message: Text {
        switch waiting {
        case 0: Text("Rien n’attend d’être envoyé.", tableName: "Account")
        case let count?:
            Text(
                "\(count) saisies pas encore envoyées\u{202F}: elles partiront à ta prochaine connexion sur cet appareil.",
                tableName: "Account")
        case nil:
            Text(
                "Des saisies n’ont peut-être pas encore été envoyées\u{202F}: elles partiront à ta prochaine connexion sur cet appareil.",
                tableName: "Account")
        }
    }

    private func ask() {
        do {
            waiting = try pending()
        } catch {
            Self.log.error("queue not read: \(AccountStore.logLabel(error), privacy: .public)")
            waiting = nil
        }
        asking = true
    }
}
