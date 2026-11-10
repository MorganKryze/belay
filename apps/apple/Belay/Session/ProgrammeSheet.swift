import BelayCore
import SwiftUI

/// The whole session, opened from the card's header: each exercise with its sets (done, the next
/// on a grey ground, to come) and one menu that names its actions: replace it, set it aside or put
/// it back, note it, add a set. The rows offer the first three by a swipe, as Mail and Reminders
/// do. « + Exercice » closes the list.
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
                SheetTitle(title: Text(verbatim: state.title))
                ForEach(training.programme) { exercise in
                    Section {
                        if exercise.skipped {
                            Text("Mis de côté pour cette séance", tableName: "SessionTools")
                                .font(.subheadline)
                                .foregroundStyle(.muted)
                                .frame(minHeight: 44)
                                .swipeActions(edge: .leading, allowsFullSwipe: false) { leading(exercise) }
                                .swipeActions(edge: .trailing, allowsFullSwipe: false) { trailing(exercise) }
                        } else {
                            ForEach(exercise.rows) {
                                row($0, timed: exercise.timed)
                                    .swipeActions(edge: .leading, allowsFullSwipe: false) { leading(exercise) }
                                    .swipeActions(edge: .trailing, allowsFullSwipe: false) { trailing(exercise) }
                            }
                        }
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
            .sheetWithoutBar()
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
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityIdentifier("programme-exercise-\(exercise.slotIndex)")
            Spacer(minLength: 8)
            menu(exercise)
        }
        .textCase(nil)
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

    // MARK: An exercise's actions

    /// One labelled menu per exercise: each action says what it does, none sits as a bare sign
    /// beside another.
    private func menu(_ exercise: ProgrammeExercise) -> some View {
        Menu {
            replaceButton(exercise)
            leaveButton(exercise)
            noteButton(exercise)
            if !exercise.skipped {
                Button { addSet(exercise) } label: {
                    Label { Text("Ajouter une série", tableName: "SessionTools") } icon: { Image(systemName: "plus") }
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.headline)
                .foregroundStyle(.ink)
                // 48 pt as drawn: the sheet's half height shows its content at 0.96 (measured), and the
                // target still keeps 44 pt there.
                .frame(width: 48, height: 48)
                .background(Color.track, in: .circle)
                .contentShape(.circle)
        }
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityLabel(Text("Actions pour \(training.exerciseName(exercise.exerciseId))", tableName: "SessionTools"))
        .accessibilityIdentifier("actions-\(exercise.slotIndex)")
    }

    /// The same actions on the exercise's rows, as Mail and Reminders offer them: the note from the
    /// leading edge, set aside and replace from the trailing one. No full swipe, so a long swipe
    /// never sets an exercise aside. Set aside keeps the system's gray, so it reads apart from
    /// replace beside it.
    private func leading(_ exercise: ProgrammeExercise) -> some View {
        noteButton(exercise).tint(.mark)
    }

    @ViewBuilder private func trailing(_ exercise: ProgrammeExercise) -> some View {
        leaveButton(exercise)
        replaceButton(exercise).tint(.mark)
    }

    private func replaceButton(_ exercise: ProgrammeExercise) -> some View {
        Button { replacing = exercise } label: {
            Label { Text("Remplacer", tableName: "SessionTools") } icon: { Image(systemName: "arrow.triangle.2.circlepath") }
        }
    }

    private func leaveButton(_ exercise: ProgrammeExercise) -> some View {
        Button {
            withAnimation(motion) { _ = actions.run { try $0.leaveOut(slotIndex: exercise.slotIndex, !exercise.skipped) } }
        } label: {
            if exercise.skipped {
                Label { Text("Remettre", tableName: "SessionTools") } icon: { Image(systemName: "arrow.uturn.backward") }
            } else {
                Label { Text("Mettre de côté", tableName: "SessionTools") } icon: { Image(systemName: "archivebox") }
            }
        }
    }

    private func noteButton(_ exercise: ProgrammeExercise) -> some View {
        Button { noting = exercise } label: {
            Label { Text("Note", tableName: "SessionTools") } icon: { Image(systemName: "square.and.pencil") }
        }
    }

    private func addSet(_ exercise: ProgrammeExercise) {
        withAnimation(motion) { _ = actions.run { try $0.addSet(slotIndex: exercise.slotIndex) } }
    }
}
