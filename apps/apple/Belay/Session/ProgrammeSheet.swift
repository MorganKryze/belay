import BelayCore
import SwiftUI

/// The whole session, opened from the card's header: each exercise with its sets (done, the next
/// on a grey ground, to come) and four icons to replace it, leave it out or put it back, note it
/// and add a set; « + Exercice » closes the list.
struct ProgrammeSheet: View {
    let state: SessionState
    let actions: CoverActions
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var type
    @Environment(\.accessibilityReduceMotion) private var systemReduce
    @State private var replacing: ProgrammeExercise?
    @State private var noting: ProgrammeExercise?
    @State private var adding = false
    @State private var full = false

    private var training: TrainingModel { actions.training }
    private var motion: Animation { Motion.change(reduce: Motion.reduced(systemReduce)) }

    var body: some View {
        NavigationStack {
            List {
                ForEach(training.programme) { exercise in
                    Section {
                        if exercise.skipped {
                            Text("Retiré de cette séance", tableName: "SessionTools")
                                .font(.subheadline)
                                .foregroundStyle(.muted)
                                .frame(minHeight: 44)
                        } else {
                            ForEach(exercise.rows) { row($0, timed: exercise.timed) }
                        }
                        icons(exercise)
                    } header: {
                        header(exercise)
                    }
                }
                Section {
                    Button {
                        if training.programme.count >= Bounds.maxSlots { full = true } else { adding = true }
                    } label: {
                        Label { Text("Exercice", tableName: "SessionTools") } icon: { Image(systemName: "plus.circle.fill") }
                            .font(.headline)
                            .foregroundStyle(.ink)
                            .frame(minHeight: 44)
                    }
                    .accessibilityLabel(Text("Ajouter un exercice", tableName: "SessionTools"))
                    .accessibilityIdentifier("add-exercise")
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color.paper)
            .navigationTitle(Text(verbatim: state.title))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(role: .close) { dismiss() }.accessibilityIdentifier("programme-close")
                }
            }
            .sheet(item: $replacing) { exercise in
                ExercisePicker(
                    title: Text("Remplacer \(training.exerciseName(exercise.exerciseId))", tableName: "SessionTools")
                ) { picked in
                    withAnimation(motion) { _ = actions.run { try $0.replace(slotIndex: exercise.slotIndex, with: picked.id) } }
                }
            }
            .sheet(item: $noting) { exercise in
                NoteSheet(slotIndex: exercise.slotIndex, exerciseId: exercise.exerciseId, note: exercise.note, actions: actions)
            }
            .sheet(isPresented: $adding) {
                ExercisePicker(title: Text("Ajouter un exercice", tableName: "SessionTools")) { picked in
                    withAnimation(motion) { _ = actions.run { try $0.addExercise(picked.id) } }
                }
            }
            .alert(Text("La séance est complète", tableName: "SessionTools"), isPresented: $full) {
                Button(role: .cancel) {} label: { Text("OK", tableName: "SessionTools") }
            } message: {
                Text("Une séance compte au plus \(Bounds.maxSlots) exercices. Rien n’est ajouté.", tableName: "SessionTools")
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func header(_ exercise: ProgrammeExercise) -> some View {
        HStack(spacing: 6) {
            Text(verbatim: training.exerciseName(exercise.exerciseId))
                .font(.headline)
                .foregroundStyle(exercise.skipped ? .muted : .ink)
                .strikethrough(exercise.skipped)
            if exercise.note != nil {
                Image(systemName: "note.text")
                    .font(.subheadline)
                    .foregroundStyle(.ink)
                    .accessibilityLabel(Text("avec une note", tableName: "SessionTools"))
            }
        }
        .textCase(nil)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
        .accessibilityIdentifier("programme-exercise-\(exercise.slotIndex)")
    }

    private func row(_ row: ProgrammeExercise.Row, timed: Bool) -> some View {
        let layout = type.isAccessibilitySize
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 12))
        let lit = row.state != .toCome
        let title =
            row.warmup
            ? String(localized: "Montée \(row.number)", table: "SessionTools")
            : row.added
                ? String(localized: "Série \(row.number) · ajoutée", table: "SessionTools")
                : String(localized: "Série \(row.number)", table: "SessionTools")
        let load = row.weightKg.flatMap { kg in row.count.map { SetText.load(kg, String($0), timed: timed) } }
        return layout {
            Text(verbatim: title).font(.subheadline.weight(.semibold)).foregroundStyle(lit ? .ink : .muted)
            if !type.isAccessibilitySize { Spacer(minLength: 8) }
            HStack(spacing: 8) {
                if let load { Text(verbatim: load).monospacedDigit().foregroundStyle(.ink) }
                Image(systemName: Self.symbol(row.state)).foregroundStyle(lit ? .ink : .muted).accessibilityHidden(true)
            }
        }
        .frame(minHeight: 44)
        .listRowBackground(row.state == .current ? Color.track : Color.surface)
        .accessibilityElement(children: .combine)
        .accessibilityValue(Self.spoken(row.state))
        .accessibilityIdentifier("programme-row-\(row.id)")
    }

    private static func symbol(_ state: BarState) -> String {
        switch state {
        case .done: "checkmark.circle.fill"
        case .current: "arrowtriangle.down.circle"
        case .toCome: "circle"
        }
    }

    private static func spoken(_ state: BarState) -> Text {
        switch state {
        case .done: Text("faite", tableName: "SessionTools")
        case .current: Text("la prochaine", tableName: "SessionTools")
        case .toCome: Text("à venir", tableName: "SessionTools")
        }
    }

    private func icons(_ exercise: ProgrammeExercise) -> some View {
        let slot = exercise.slotIndex
        return HStack(spacing: 10) {
            icon("arrow.triangle.2.circlepath", Text("Remplacer", tableName: "SessionTools"), id: "replace-\(slot)") {
                replacing = exercise
            }
            icon(
                exercise.skipped ? "arrow.uturn.backward" : "minus",
                exercise.skipped ? Text("Remettre", tableName: "SessionTools") : Text("Retirer", tableName: "SessionTools"),
                id: "leave-\(slot)"
            ) {
                withAnimation(motion) { _ = actions.run { try $0.leaveOut(slotIndex: slot, !exercise.skipped) } }
            }
            icon("square.and.pencil", Text("Note", tableName: "SessionTools"), id: "note-\(slot)") { noting = exercise }
            if !exercise.skipped {
                icon("plus", Text("Ajouter une série", tableName: "SessionTools"), id: "addset-\(slot)") {
                    withAnimation(motion) { _ = actions.run { try $0.addSet(slotIndex: slot) } }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
    }

    private func icon(_ symbol: String, _ label: Text, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.headline)
                .foregroundStyle(.ink)
                .frame(width: 48, height: 48)
                .background(Color.track, in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityLabel(label)
        .accessibilityIdentifier(id)
    }
}
