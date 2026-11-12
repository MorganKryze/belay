import SwiftUI

/// « Programme actif »: the live programs in the shared order, the active one ticked. A tap
/// activates one; creating, renaming and deleting stay on the computer.
struct ProgramChoiceSheet: View {
    let programs: [ProgramChoice]
    let activeId: String?
    let choose: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    init(programs: [ProgramChoice], activeId: String?, choose: @escaping (String) -> Void) {
        self.programs = programs
        self.activeId = activeId
        self.choose = choose
    }

    var body: some View {
        NavigationStack {
            List {
                SheetTitle(title: Text("Programme actif", tableName: "Accueil"))
                Section {
                    ForEach(programs) { program in
                        row(program)
                    }
                } footer: {
                    Text(
                        "Un toucher l’active et ferme. Créer, renommer ou supprimer un programme se fait sur ordinateur.",
                        tableName: "Accueil"
                    )
                    .foregroundStyle(.muted)
                }
                .listRowBackground(Color.surface)
            }
            .belayList()
            // Its title is the list's first row, as the session sheets have it: no bar above.
            .sheetWithoutBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func row(_ program: ProgramChoice) -> some View {
        let active = program.id == activeId
        let name = program.title
        let count = String(localized: "\(program.sessions) séances", table: "Accueil")
        return Button {
            // The one already active is left as it is: a new time would move where its rotation
            // counts from.
            if active { dismiss() } else { choose(program.id) }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.body.weight(.medium))
                        .foregroundStyle(.ink)
                    Text(count)
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                }
                Spacer(minLength: 8)
                if active {
                    Image(systemName: "checkmark")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.ink)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 52)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(name), \(count)")
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("program.\(program.id)")
    }

}

extension ProgramChoice {
    /// The program's name, « Programme de départ » for the starting one, or « Programme sans nom ».
    var title: String {
        if let name, !name.isEmpty { return name }
        return starter
            ? String(localized: "Programme de départ", table: "Accueil")
            : String(localized: "Programme sans nom", table: "Accueil")
    }
}
