import BelayCore
import SwiftUI

/// The watch's one screen: where its connection with the iPhone stands, and the one thing to do.
struct ShellView: View {
    let account: WristAccount
    @State private var confirming = false

    private let markSide: CGFloat = 32

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                ZStack {
                    BelayMark(.ring).stroke(.primary, style: BelayMark.strokeStyle(side: markSide))
                    BelayMark(.mountain).stroke(.blue, style: BelayMark.strokeStyle(side: markSide))
                }
                .frame(width: markSide, height: markSide)
                .accessibilityIdentifier("belay-mark")
                .accessibilityHidden(true)

                content
            }
            .frame(maxWidth: .infinity)
        }
        .background(.black)
        .confirmationDialog(
            Text("Déconnecter cette montre\u{202F}?", tableName: "Watch"), isPresented: $confirming,
            titleVisibility: .visible
        ) {
            Button(role: .destructive) {
                account.signOutHere()
            } label: {
                Text("Déconnecter cette montre", tableName: "Watch")
            }
            .accessibilityIdentifier("watch-signout-confirm")
        } message: {
            Text("Ton iPhone reste connecté.", tableName: "Watch")
        }
        .task { await account.start() }
    }

    @ViewBuilder private var content: some View {
        switch account.state {
        case .asking:
            status {
                ProgressView()
                Text("Connexion à ton iPhone…", tableName: "Watch").font(.headline)
            }
        case .phoneOut:
            status {
                Text("Ouvre Belay sur ton iPhone", tableName: "Watch").font(.headline)
                Text("Ta montre utilise la connexion de ton iPhone.", tableName: "Watch").font(.footnote)
                    .foregroundStyle(.secondary)
            }
            retry
        case .phoneSignedOut:
            status {
                Text("Connecte-toi dans Belay sur ton iPhone", tableName: "Watch").font(.headline)
                Text("Ta montre utilise la connexion de ton iPhone.", tableName: "Watch").font(.footnote)
                    .foregroundStyle(.secondary)
            }
            retry
        case .connected(let name, let host, let reached):
            status {
                Text("Montre connectée", tableName: "Watch").font(.headline)
                Text(verbatim: name).font(.body)
                Text(verbatim: host).font(.footnote).foregroundStyle(.secondary)
                if let reached {
                    Group {
                        if reached {
                            Text("Instance jointe", tableName: "Watch")
                        } else {
                            Text("Instance injoignable pour l’instant", tableName: "Watch")
                        }
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                }
            }
            Button(role: .destructive) {
                confirming = true
            } label: {
                Text("Déconnecter cette montre", tableName: "Watch").frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("watch-signout")
        case .signedOutHere:
            status {
                Text("Montre déconnectée", tableName: "Watch").font(.headline)
                Text("Ta montre utilise la connexion de ton iPhone.", tableName: "Watch").font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Button {
                Task { await account.connectAgain() }
            } label: {
                Text("Connecter avec l’iPhone", tableName: "Watch").frame(maxWidth: .infinity)
            }
            .accessibilityIdentifier("watch-connect")
        }
    }

    /// The state's words, read by VoiceOver as one element.
    private func status(@ViewBuilder _ lines: () -> some View) -> some View {
        VStack(spacing: 4) { lines() }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("watch-status")
    }

    private var retry: some View {
        Button {
            Task { await account.retry() }
        } label: {
            Text("Réessayer", tableName: "Watch").frame(maxWidth: .infinity)
        }
        .accessibilityIdentifier("watch-retry")
    }
}
