import BelayCore
import SwiftUI

/// The note on an exercise of the session: one field, ✕ and ✓, and how much room is left.
struct NoteSheet: View {
    let slotIndex: Int
    let exerciseId: String
    let note: String?
    let actions: CoverActions
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            List {
                SheetTitle(title: Text(verbatim: actions.training.exerciseName(exerciseId)))
                Section {
                    TextField(text: $text, axis: .vertical) { Text("Une note sur cet exercice", tableName: "SessionTools") }
                        .lineLimit(3...8)
                        .foregroundStyle(.ink)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("note-field")
                } footer: {
                    Text("\(text.utf16.count) sur \(Bounds.noteMax) · gardée avec cette séance", tableName: "SessionTools")
                        .foregroundStyle(.muted)
                        .accessibilityIdentifier("note-count")
                }
            }
            .listStyle(.insetGrouped)
            .sheetWithoutBar()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.accessibilityIdentifier("note-close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(role: .confirm) {
                        if actions.run({ try $0.noteExercise(slotIndex: slotIndex, text: text) }) { dismiss() }
                    }
                    .tint(.mark)
                    .accessibilityIdentifier("note-save")
                }
            }
        }
        .presentationDetents([.medium, .large])
        .onAppear { text = note ?? "" }
        // The contract keeps 500 characters; the field stops there instead of cutting on save.
        .onChange(of: text) { if text.utf16.count > Bounds.noteMax { text = fitNote(text) } }
    }
}
