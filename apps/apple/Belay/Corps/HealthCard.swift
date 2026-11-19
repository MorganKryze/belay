import SwiftUI

/// « Tes pesées de Santé »: the import offered once, on Corps's first opening on a phone with
/// Health. Either answer puts it away for good; Réglages keeps the switch. Santé refused, the card
/// stays and says where to allow it, so the button can try again.
struct HealthCard: View {
    let refused: Bool
    let accept: () -> Void
    let decline: () -> Void

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 12) {
                    // Health's own mark: its red heart on white words, the system app's sign.
                    Image(systemName: "heart.fill")
                        .font(.title2)
                        .foregroundStyle(.white)
                        .frame(width: 48, height: 48)
                        .background(Color(red: 1, green: 0.18, blue: 0.33), in: .rect(cornerRadius: 12))
                        .accessibilityHidden(true)
                    Text("Tes pesées de Santé", tableName: "Corps")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(.ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                }
                Text(
                    "Celles d’une balance connectée ou saisies dans Santé arrivent ici. Une pesée déjà dans Belay n’est jamais remplacée.",
                    tableName: "Corps"
                )
                .font(.subheadline)
                .foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
                if refused {
                    // Réglages's sentence for the weigh-in import's refusal: the card turns that import on.
                    Text(
                        "Pour importer tes pesées, Belay a besoin de l’accès à Santé. Autorise-le dans l’app Santé, puis réessaie.",
                        tableName: "Health"
                    )
                    .font(.subheadline)
                    .foregroundStyle(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                }
                PrimaryButton(title: "Importer les pesées", tableName: "Corps", action: accept)
                Button(action: decline) {
                    Text("Pas maintenant", tableName: "Corps")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.ink)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderless)
            }
            .padding(.vertical, 10)
        }
        .listRowBackground(Color.surface)
    }
}
