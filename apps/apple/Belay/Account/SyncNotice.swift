import BelayCore
import SwiftUI

/// What the screen says while the queue waits, once and quietly: offline, one line; a refused
/// session, one line and the way back in. Nothing while idle or syncing, nor after a failure the
/// next sync tries again; logging works the same in every case.
struct SyncNotice: View {
    let status: SyncStatus
    let reconnect: () -> Void

    var body: some View {
        switch status {
        case .offline:
            row(symbol: "wifi.slash") {
                Text("Hors ligne. Tout est gardé sur ce téléphone.", tableName: "Account")
            }
        case .expired:
            row(symbol: "person.crop.circle.badge.exclamationmark") {
                Text("Ta session a expiré.", tableName: "Account")
            } action: {
                Button(action: reconnect) {
                    Text("Se reconnecter", tableName: "Account")
                        .font(.subheadline.weight(.semibold))
                        .frame(minHeight: 44)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
                .tint(.muted)
                .foregroundStyle(.ink)
                .accessibilityIdentifier("sync-reconnect")
            }
        case .idle, .syncing, .failed:
            EmptyView()
        }
    }

    /// The prototype's offline row: a muted symbol, the sentence beside it, on a solid surface so
    /// it never sits on the wall. At large text sizes the action goes under the sentence.
    private func row(
        symbol: String, @ViewBuilder text: () -> some View,
        @ViewBuilder action: () -> some View = { EmptyView() }
    ) -> some View {
        let label = Label {
            text()
                .font(.subheadline)
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: symbol).foregroundStyle(.muted)
        }
        let action = action()
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) {
                label
                Spacer(minLength: 0)
                action
            }
            VStack(alignment: .leading, spacing: 8) {
                label
                action
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.surface, in: .rect(cornerRadius: 16))
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("sync-notice")
    }
}
