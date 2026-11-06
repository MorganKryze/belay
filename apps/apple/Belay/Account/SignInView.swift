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
    @Environment(\.dynamicTypeSize) private var textSize

    private var busy: Bool {
        if case .signingIn = account.state { true } else { false }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    // The system's placeholder grey sits under 4.5:1 on the surface.
                    // At the accessibility sizes a line holds a few characters: the address wraps instead of
                    // scrolling out of sight.
                    TextField(
                        text: $address, prompt: Text("belay.exemple.fr", tableName: "Account").foregroundStyle(.muted),
                        axis: textSize.isAccessibilitySize ? .vertical : .horizontal
                    ) {
                        Text("Adresse de l’instance", tableName: "Account")
                    }
                    .textContentType(.URL)
                    .keyboardType(.URL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($typing)
                    .onSubmit(submit)
                    // The text field takes taps on its 22 pt line only; the whole 44 pt row starts typing.
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(.rect)
                    .onTapGesture { typing = true }
                    .disabled(busy)
                    // A list row's text field does not expose its label, so it is named here. No header
                    // repeats the name: a list header ignores accessibilityHidden, and VoiceOver read it twice.
                    .accessibilityLabel(Text("Adresse de l’instance", tableName: "Account"))
                    .accessibilityIdentifier("signin-address")
                } footer: {
                    if let problem {
                        Label {
                            Text(problem).foregroundStyle(.ink)
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
        .onChange(of: address) { _, typed in
            // A wrapping field takes Return as a new line: it means Go, as on one line.
            if typed.contains(where: \.isNewline) {
                address = typed.filter { !$0.isNewline }
                return submit()
            }
            problemHidden = true
        }
        // Focus stays on Se connecter after the tap, so VoiceOver would never reach the sentence.
        .onChange(of: problem) { _, sentence in
            guard let sentence else { return }
            var spoken = AttributedString(sentence)
            spoken.accessibilitySpeechAnnouncementPriority = .high
            AccessibilityNotification.Announcement(spoken).post()
        }
    }

    /// The one sentence that says why the last try did not sign in.
    private var problem: String? {
        guard !problemHidden, !busy else { return nil }
        let sentence: String.LocalizationValue
        if let refused = account.addressProblem {
            sentence = Self.sentence(refused)
        } else if case .signedOut(let failure?) = account.state {
            sentence = Self.sentence(failure)
        } else {
            return nil
        }
        return String(localized: sentence, table: "Account")
    }

    private func submit() {
        guard !busy else { return }
        typing = false
        // Shown again here rather than when the try ends: an address refused on the spot ends it
        // before the screen ever sees it busy.
        problemHidden = false
        Task { await account.signIn(address: address) }
    }

    static func sentence(_ problem: InstanceError) -> String.LocalizationValue {
        switch problem {
        case .invalid: "Cette adresse n’est pas valide. Exemple\u{202F}: belay.exemple.fr"
        case .insecure: "L’adresse doit commencer par https://"
        case .offline: "Pas de connexion. Réessaie une fois en ligne."
        case .unreachable: "Impossible de joindre cette adresse. Vérifie-la, ou vérifie que l’instance est à jour."
        case .notBelay: "Aucune instance Belay ne répond à cette adresse. Vérifie-la."
        }
    }

    static func sentence(_ failure: SignInFailure) -> String.LocalizationValue {
        switch failure {
        case .cancelled: "Connexion annulée. Tu peux réessayer quand tu veux."
        case .unavailable: "La connexion est indisponible pour le moment. Réessaie dans un instant."
        case .expired: "La connexion a pris trop de temps. Réessaie."
        case .failed: "La connexion n’a pas abouti. Réessaie."
        case .denied: "Ton compte n’a pas accès à Belay. Demande l’accès à la personne qui gère cette instance."
        }
    }
}
