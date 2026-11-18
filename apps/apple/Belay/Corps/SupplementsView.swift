import BelayCore
import SwiftUI

/// Compléments: today's supplements, one tap each to tick or untick the day's box (R20). Creatine
/// counts the days of its course; Belay never advises a dose. « Gérer ma liste » leads to Mes
/// compléments, where the list itself is set, and so does the empty state.
struct SupplementsView: View {
    let corps: CorpsModel
    /// Pushes Mes compléments on this stack.
    let open: (Route) -> Void

    var body: some View {
        List {
            if corps.supplements.isEmpty {
                Section {
                    Text("Pas encore de complément", tableName: "Entries")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.ink)
                        .frame(maxWidth: .infinity, minHeight: 52, alignment: .leading)
                    manageRow
                }
                .listRowBackground(Color.surface)
            } else {
                Section {
                    ForEach(Array(corps.supplements.enumerated()), id: \.element.id) { index, supplement in
                        Button {
                            corps.take(supplementId: supplement.id, taken: !supplement.taken)
                        } label: {
                            SupplementRow(supplement: supplement)
                        }
                        .buttonStyle(.plain)
                        .sensoryFeedback(.success, trigger: supplement.taken) { _, taken in taken }
                        .accessibilityAddTraits(supplement.taken ? .isSelected : [])
                        .accessibilityIdentifier("supplement-\(index)")
                    }
                } header: {
                    Text("Aujourd’hui", tableName: "Entries").textCase(nil).foregroundStyle(.ink)
                } footer: {
                    Text("Belay note ce que tu prends, sans conseil de dose.", tableName: "Entries").foregroundStyle(.muted)
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
                Section { manageRow }.listRowBackground(Color.surface)
            }
        }
        .belayList()
        .navigationTitle(Text("Compléments", tableName: "Entries"))
        .largeTitleOnly()
    }

    private var manageRow: some View {
        Button { open(.manageSupplements) } label: {
            HStack {
                Text("Gérer ma liste", tableName: "Entries").foregroundStyle(.ink)
                Spacer(minLength: 8)
                Image(systemName: "chevron.forward")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.muted)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 52)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("supplements-manage")
    }
}

/// A supplement and its round: an empty ring until taken, then filled in the intake shade with
/// its check, and the words say it too.
private struct SupplementRow: View {
    let supplement: SupplementToday
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 30

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().strokeBorder(supplement.taken ? Color.clear : Color.muted, lineWidth: 2)
                if supplement.taken {
                    Circle().fill(Color.intakeShade)
                    Image(systemName: "checkmark")
                        .font(.body.weight(.bold))
                        .foregroundStyle(.surface)
                        .transition(.symbolEffect(.drawOn))
                }
            }
            .frame(width: side, height: side)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(supplement.name).font(.body.weight(.semibold)).foregroundStyle(.ink)
                Text(status).font(.subheadline).foregroundStyle(.muted)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
        .contentShape(.rect)
        .accessibilityElement(children: .combine)
    }

    private var status: String {
        guard supplement.taken else { return String(localized: "pas encore pris", table: "Entries") }
        guard let days = supplement.creatineDay else { return String(localized: "pris", table: "Entries") }
        return String(localized: "pris · depuis \(days) jours", table: "Entries")
    }
}
