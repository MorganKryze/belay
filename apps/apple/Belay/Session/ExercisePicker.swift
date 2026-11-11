import BelayCore
import SwiftUI

/// The bundled library by name, the search at the top; one tap picks and closes.
struct ExercisePicker: View {
    let title: Text
    let pick: (LibraryExercise) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                SheetTitle(title: title)
                Section {
                    ForEach(BundledLibrary.library.search(query)) { exercise in
                        Button {
                            pick(exercise)
                            dismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: exercise.name).foregroundStyle(.ink)
                                if exercise.measure == .seconds {
                                    Text("En secondes", tableName: "SessionTools").font(.subheadline).foregroundStyle(.muted)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("pick-\(exercise.id)")
                    }
                }
            }
            .listStyle(.insetGrouped)
            .searchable(
                text: $query, placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("Exercice", tableName: "SessionTools"))
            .sheetWithoutBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.accessibilityIdentifier("picker-close")
                }
            }
        }
        .presentationDetents([.large])
    }
}
