import BelayCore
import SwiftUI

/// An exercise: its name and equipment in the page, the loop, last time's work sets, the muscles
/// in words, the program's sessions that use it, then how to do it and the dataset's credit.
struct ExercisePage: View {
    let training: TrainingModel
    let exerciseId: String
    @State private var steps: [String] = []

    var body: some View {
        let exercise = BundledLibrary.library.exercise(exerciseId)
        let name = exercise?.name ?? exerciseId
        List {
            Section {
                header(name, exercise)
            }
            Section {
                LoopCard(exerciseId: exerciseId, name: name)
                    .listRowInsets(.all, 0)
            }
            .listRowBackground(Color.surface)
            if let exercise {
                let last = training.lastTime(exerciseId: exerciseId, timed: exercise.measure == .seconds)
                if !last.isEmpty {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("La dernière fois", tableName: "Exercices")
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(.muted)
                            DayHero(text: Self.loads(last, timed: exercise.measure == .seconds))
                        }
                        .padding(.vertical, 6)
                        .accessibilityElement(children: .combine)
                    }
                    .listRowBackground(Color.surface)
                }
                muscles(exercise)
            }
            uses
            howTo
        }
        .belayList()
        .navigationTitle(Text(verbatim: name))
        .navigationBarTitleDisplayMode(.inline)
        .largeTitleOnly()
        .task(id: exerciseId) {
            // Read off the main actor: the first page opened decodes the whole language's file.
            let id = exerciseId
            steps = await Task.detached(priority: .userInitiated) { HowTo.steps(id) }.value
        }
    }

    /// The name in the display face, wrapping, then « Barre · incrément 2,5 kg ».
    private func header(_ name: String, _ exercise: LibraryExercise?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: name)
                .font(.custom(Font.archivoName, size: 26, relativeTo: .largeTitle))
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("exercise-name")
            if let exercise {
                Text(
                    "\(ExerciseText.equipment(exercise.equipment)) · incrément \(SetText.kg(exercise.incrementKg))\u{202F}kg",
                    tableName: "Exercices"
                )
                .font(.subheadline)
                .foregroundStyle(.muted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 4))
    }

    private func muscles(_ exercise: LibraryExercise) -> some View {
        Section {
            LabeledContent {
                Text(verbatim: exercise.primary.map(ExerciseText.muscle).joined(separator: ", "))
            } label: {
                Text("Principal", tableName: "Exercices")
            }
            if !exercise.secondary.isEmpty {
                LabeledContent {
                    Text(verbatim: exercise.secondary.map(ExerciseText.muscle).joined(separator: ", "))
                } label: {
                    Text("Secondaires", tableName: "Exercices")
                }
            }
        } header: {
            Text("Muscles", tableName: "Exercices").textCase(nil).foregroundStyle(.ink)
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
    }

    /// Each session of the active program that holds the exercise, opening its preview.
    @ViewBuilder private var uses: some View {
        let uses = training.sessions.flatMap { session in
            session.plan.filter { $0.exerciseId == exerciseId }.map { (session, $0) }
        }
        if !uses.isEmpty {
            Section {
                ForEach(uses, id: \.1.slotIndex) { session, planned in
                    if let sessionId = session.sessionId {
                        NavigationLink(value: Route.preview(sessionId: sessionId)) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(verbatim: SessionText.short(session.code))
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(.ink)
                                Text(verbatim: Self.target(planned))
                                    .font(.subheadline)
                                    .foregroundStyle(.muted)
                                    .monospacedDigit()
                            }
                            .frame(minHeight: 52)
                            .accessibilityElement(children: .combine)
                        }
                        .accessibilityIdentifier("uses.\(session.code)")
                    }
                }
            } header: {
                Text("Dans ton programme", tableName: "Exercices").textCase(nil).foregroundStyle(.ink)
            }
            .headerProminence(.increased)
            .listRowBackground(Color.surface)
        }
    }

    @ViewBuilder private var howTo: some View {
        if !steps.isEmpty {
            Section {
                ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(verbatim: "\(index + 1)")
                            .font(.headline)
                            .monospacedDigit()
                            .foregroundStyle(.muted)
                            .frame(minWidth: 18)
                        Text(verbatim: step).foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.vertical, 2)
                    .accessibilityElement(children: .combine)
                }
            } header: {
                Text("Comment faire", tableName: "Exercices").textCase(nil).foregroundStyle(.ink)
            } footer: {
                Text("Texte\u{202F}: exercises-dataset (MIT)", tableName: "Exercices").foregroundStyle(.muted)
            }
            .headerProminence(.increased)
            .listRowBackground(Color.surface)
        }
    }
}

extension ExercisePage {
    /// « 62,5 kg × 8, 8, 7, 6 », equal loads in a row grouped.
    static func loads(_ groups: [LoadGroup], timed: Bool) -> String {
        groups.map { SetText.load($0.weightKg, $0.counts.map(String.init).joined(separator: ", "), timed: timed) }
            .joined(separator: " · ")
    }

    /// « 4 × 6–8 · RIR 1–2 · repos 2 min 30 », the rest left out inside a group.
    static func target(_ planned: PlannedExercise) -> String {
        let sets = "\(planned.sets) × \(planned.repRange.map(String.init).joined(separator: "–"))"
            + (planned.timed ? "\u{202F}s" : "")
        let rir = Set(planned.rirTarget).count == 1
            ? planned.rirTarget.map(String.init).first
            : planned.rirTarget.isEmpty ? nil : planned.rirTarget.map(String.init).joined(separator: "–")
        var parts = [sets]
        if let rir { parts.append(String(localized: "RIR \(rir)", table: "Exercices")) }
        if planned.restSec > 0 { parts.append(String(localized: "repos \(rest(planned.restSec))", table: "Exercices")) }
        return parts.joined(separator: " · ")
    }

    /// « 2 min 30 », « 2 min », « 45 s ».
    static func rest(_ seconds: Int) -> String {
        let minutes = seconds / 60
        let rest = seconds % 60
        if minutes == 0 { return "\(rest)\u{202F}s" }
        return rest == 0 ? "\(minutes)\u{202F}min" : "\(minutes)\u{202F}min\u{202F}\(rest)"
    }
}
