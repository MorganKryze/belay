import BelayCore
import SwiftUI

/// « Ton activité »: the four levels of the report, each with its PAL and what it means. One tap
/// picks a level and closes, as a menu does; the level in use carries the tick.
struct PalSheet: View {
    let chosen: PalLevel
    let pick: (PalLevel) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                SheetTitle(title: Text("Ton activité", tableName: "Outils"))
                Section {
                    ForEach(palLevels, id: \.id) { level in row(level) }
                } footer: {
                    Text("Un toucher choisit et ferme.", tableName: "Outils").foregroundStyle(.muted)
                }
                .listRowBackground(Color.surface)
            }
            .belayList()
            // Its title is the list's first row, as the other sheets have it: no bar above.
            .sheetWithoutBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.accessibilityIdentifier("pal-close")
                }
            }
        }
        .presentationDetents([.large])
        .tint(.ink)
    }

    private func row(_ level: PalLevel) -> some View {
        let selected = level.id == chosen.id
        let name = String(localized: level.name)
        let words = String(localized: level.words)
        return Button {
            pick(level)
            dismiss()
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(verbatim: name).font(.body.weight(.semibold)).foregroundStyle(.ink)
                        Spacer(minLength: 8)
                        Text(verbatim: level.palText).font(.subheadline).monospacedDigit().foregroundStyle(.muted)
                    }
                    Text(verbatim: words).font(.subheadline).foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Image(systemName: "checkmark").font(.body.weight(.bold)).foregroundStyle(.ink)
                    .opacity(selected ? 1 : 0)
                    .frame(width: 22)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 60)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(name), \(level.palText), \(words)"))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
        .accessibilityIdentifier("pal-\(level.id)")
    }
}
