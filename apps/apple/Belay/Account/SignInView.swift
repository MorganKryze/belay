import BelayCore
import SwiftUI

/// The first screen while signed out: the instance's address, and Se connecter, which opens the
/// instance's sign-in in the system's private sheet. A failure is said in one sentence under the
/// field, and the screen stays.
struct SignInView: View {
    let account: AccountModel
    @State private var address = ""
    @FocusState private var typing: Bool
    @State private var problemHidden = false

    private var busy: Bool {
        if case .signingIn = account.state { true } else { false }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField(text: $address, prompt: Text("belay.exemple.fr", tableName: "Account")) {
                        Text("Adresse de l’instance", tableName: "Account")
                    }
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($typing)
                    .disabled(busy)
                    .frame(minHeight: 44)
                    .onSubmit(submit)
                    .accessibilityIdentifier("signin-address")
                } header: {
                    Text("Adresse de l’instance", tableName: "Account")
                        .accessibilityHidden(true)
                } footer: {
                    if let problem {
                        Label {
                            Text(problem, tableName: "Account").foregroundStyle(.ink)
                        } icon: {
                            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.danger)
                        }
                        .font(.subheadline)
                        .accessibilityIdentifier("signin-problem")
                    } else {
                        Text(
                            "Le serveur Belay que quelqu’un héberge pour toi, ou que tu héberges toi-même.",
                            tableName: "Account"
                        )
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                    }
                }
                .listRowBackground(Color.surface)
            }
            .belayList()
            .navigationTitle(Text("Connexion", tableName: "Account"))
            .safeAreaBar(edge: .bottom) {
                FootBar {
                    PrimaryButton(
                        title: busy ? "Vérification…" : "Se connecter", place: .foot, tableName: "Account",
                        action: submit
                    )
                    .disabled(busy || address.trimmingCharacters(in: .whitespaces).isEmpty)
                    .accessibilityIdentifier("signin-submit")
                }
            }
        }
        .onAppear {
            if address.isEmpty { address = account.lastAddress }
        }
        // A changed address takes the reproach away; it comes back at the next try if it still holds.
        .onChange(of: address) { problemHidden = true }
        .onChange(of: busy) { if !busy { problemHidden = false } }
    }

    /// The one sentence that says why the last try did not sign in.
    private var problem: LocalizedStringKey? {
        guard !problemHidden, !busy else { return nil }
        if let refused = account.addressProblem { return Self.sentence(refused) }
        if case .signedOut(let failure?) = account.state { return Self.sentence(failure) }
        return nil
    }

    private func submit() {
        guard !busy else { return }
        typing = false
        Task { await account.signIn(address: address) }
    }

    static func sentence(_ problem: InstanceError) -> LocalizedStringKey {
        switch problem {
        case .invalid: "Cette adresse n’est pas valide. Exemple\u{202F}: belay.exemple.fr"
        case .insecure: "L’adresse doit commencer par https://"
        case .offline: "Pas de connexion. Réessaie une fois en ligne."
        case .unreachable: "Impossible de joindre cette adresse. Vérifie-la, ou vérifie que l’instance est à jour."
        case .notBelay: "Aucune instance Belay ne répond à cette adresse. Vérifie-la."
        }
    }

    static func sentence(_ failure: SignInFailure) -> LocalizedStringKey {
        switch failure {
        case .cancelled: "Connexion annulée. Tu peux réessayer quand tu veux."
        case .unavailable: "La connexion est indisponible pour le moment. Réessaie dans un instant."
        case .expired: "La connexion a pris trop de temps. Réessaie."
        case .failed: "La connexion n’a pas abouti. Réessaie."
        case .denied: "Ton compte n’a pas accès à Belay. Demande l’accès à la personne qui gère cette instance."
        }
    }
}
