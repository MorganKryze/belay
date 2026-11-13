import BelayCore
import SwiftUI
import os

/// A session kept, opened from the history: its figures, each exercise with its sets, the
/// deletion at the foot. « Modifier » makes each set open the correction sheet, until « OK ».
struct PastSessionView: View {
    let training: TrainingModel
    private let make: () -> PastSessionModel
    /// The model, built at the first pass of the body: the destination makes this view again at
    /// each pass of the shell, and a model made in `init` would read the store each time.
    @State private var built = Once<PastSessionModel>()
    @State private var editing = false
    @State private var correcting: DoneSet?
    @State private var deleting = false
    @State private var failed = false
    @Environment(\.dismiss) private var dismiss

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "past")

    init(training: TrainingModel, model: @escaping () -> PastSessionModel) {
        self.training = training
        make = model
    }

    private var model: PastSessionModel { built.value(make) }

    var body: some View {
        Group {
            if let session = model.session {
                content(session)
            } else {
                // Deleted from another device while it was open; one deleted here leaves at once.
                Color.clear
            }
        }
        .background { Wall() }
        .task { await model.follow() }
        .sheet(item: $correcting) { set in
            CorrectSheet(
                set: set, exercise: training.exerciseName(set.exerciseId), correcting: model,
                removal: Text("Les autres séries de la séance restent.", tableName: "Seances"),
                loneWarmup: Self.lone(set, in: model.session)
            ) { failed = true }
        }
        .alert(Text("La modification n’a pas été enregistrée. Réessaie.", tableName: "Seances"), isPresented: $failed) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder private func content(_ session: PastSession) -> some View {
        List {
            TitleLines(name: session.name, line: Self.when(session.startedAt))
            Section {
                Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 14) {
                    GridRow {
                        tile(String(localized: "Durée", table: "Accueil"), id: "duration") {
                            Text(SessionText.duration(ms: session.durationMs))
                        }
                        tile(String(localized: "Séries", table: "Accueil"), id: "sets") {
                            Text(session.workSets.formatted())
                        }
                    }
                    GridRow {
                        tile(String(localized: "Volume", table: "Seances"), id: "volume") {
                            Text(HistoryText.volume(session.volumeKg))
                        }
                        if let effort = session.effort {
                            tile(String(localized: "Effort", table: "Accueil"), id: "effort") {
                                HStack(alignment: .lastTextBaseline, spacing: 6) {
                                    EffortGlyph(floor: effort)
                                    Text(EffortText.word(effort))
                                }
                            }
                        }
                    }
                }
                .padding(.vertical, 8)
            }
            .listRowBackground(Color.surface)
            ForEach(session.exercises) { exercise in
                Section {
                    ForEach(exercise.sets) { set in row(set, of: exercise) }
                } header: {
                    Text(training.exerciseName(exercise.exerciseId)).font(.headline).textCase(nil).foregroundStyle(.ink)
                }
                .listRowBackground(Color.surface)
            }
            Section {
                Button(role: .destructive) { deleting = true } label: {
                    Text("Supprimer la séance", tableName: "Seances").frame(maxWidth: .infinity, minHeight: 44)
                }
                .foregroundStyle(.danger)
                .accessibilityIdentifier("past-delete")
                .confirmationDialog(
                    Text("Supprimer cette séance\u{202F}?", tableName: "Seances"), isPresented: $deleting,
                    titleVisibility: .visible
                ) {
                    Button(role: .destructive, action: delete) { Text("Supprimer", tableName: "Seances") }
                }
            }
            .listRowBackground(Color.surface)
        }
        .belayList()
        .navigationTitle(SessionText.short(session.code))
        .navigationBarTitleDisplayMode(.large)
        .largeTitleOnly()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editing.toggle()
                } label: {
                    editing ? Text("OK", tableName: "Seances") : Text("Modifier", tableName: "Seances")
                }
                .accessibilityIdentifier(editing ? "OK" : "Modifier")
            }
        }
    }

    /// A set's rank and its load; while editing, a tap opens its correction.
    @ViewBuilder private func row(_ set: PastSet, of exercise: PastExercise) -> some View {
        let name = SetName.of(Self.done(set, of: exercise), loneWarmup: exercise.sets.count(where: \.warmup) == 1)
        let load = SessionText.load(Load(weightKg: set.weightKg, reps: set.reps, seconds: set.seconds))
        let content = LabeledContent {
            Text(load).font(.body.weight(.semibold)).foregroundStyle(.ink).monospacedDigit()
        } label: {
            Text(name).foregroundStyle(.muted)
        }
        .frame(minHeight: 44)
        Group {
            if editing {
                Button { correcting = Self.done(set, of: exercise) } label: { content.contentShape(.rect) }
                    .buttonStyle(.plain)
                    .accessibilityHint(Text("Corrige la série", tableName: "Seances"))
            } else {
                content
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name), \(load)")
        .accessibilityAddTraits(editing ? .isButton : [])
        .accessibilityIdentifier("past.set")
    }

    private func tile(_ label: String, id: String, @ViewBuilder value: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(.muted)
            value()
                .font(.title2.weight(.bold))
                .foregroundStyle(.ink)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("past.\(id)")
    }

    private func delete() {
        do {
            try model.delete()
            dismiss()
        } catch {
            Self.log.error("session not deleted: \(AccountStore.logLabel(error), privacy: .public)")
            failed = true
        }
    }
}

extension PastSessionView {
    /// Whether the set is its exercise's only warm-up, so its sheet names it as its row does.
    private static func lone(_ set: DoneSet, in session: PastSession?) -> Bool {
        guard set.warmup else { return false }
        let exercise = session?.exercises.first { $0.slotIndex == set.place.slotIndex && $0.exerciseId == set.exerciseId }
        return exercise?.sets.count(where: \.warmup) == 1
    }

    /// The set as the correction sheet takes it. Its place carries the rank shown, which is all
    /// the sheet reads of it: the sheet names the set from it.
    private static func done(_ set: PastSet, of exercise: PastExercise) -> DoneSet {
        DoneSet(
            id: set.setId,
            place: SetPlace(
                slotIndex: exercise.slotIndex,
                position: set.warmup ? set.number - 1 : Bounds.maxWarmups + set.number - 1),
            exerciseId: exercise.exerciseId, warmup: set.warmup, timed: set.seconds != nil,
            weightKg: set.weightKg, count: set.seconds ?? set.reps ?? 0, rir: set.rir)
    }

    /// « Lundi 5 octobre · 18 h 00 ».
    private static func when(_ startedAt: String) -> String {
        guard let date = Instant.date(startedAt) else { return "" }
        return "\(HistoryText.day(startedAt)) · \(WeekdayText.time(date))"
    }
}
