import BelayCore
import Foundation
import SwiftUI
import os

/// Séances › Exercices: the Muscle and Matériel menus, the program's exercises with their session's
/// letter, then the rest of the library; while searching or filtering, what is found under its
/// count. The search field is Séances' own, under its large title.
struct ExercisesSection: View {
    let training: TrainingModel
    let query: String
    @State private var muscle: String?
    @State private var equipment: Equipment?

    private var library: ExerciseLibrary { BundledLibrary.library }

    var body: some View {
        let found = library.filter(query: query, muscle: muscle, equipment: equipment)
        Section {
            HStack(spacing: 8) {
                FilterMenu(
                    title: Text("Muscle", tableName: "Exercices"), id: "filter-muscle",
                    options: ExerciseText.muscles.map { ($0, ExerciseText.muscle($0)) }, choice: $muscle)
                FilterMenu(
                    title: Text("Matériel", tableName: "Exercices"), id: "filter-equipment",
                    options: Equipment.allCases.map { ($0, ExerciseText.equipment($0)) }, choice: $equipment)
                Spacer(minLength: 0)
            }
            .listRowBackground(Color.clear)
            .listRowInsets(.all, 0)
        }
        if found.isEmpty {
            Section {
                ContentUnavailableView.search(text: query)
                    .listRowBackground(Color.clear)
            }
        } else if query.trimmingCharacters(in: .whitespaces).isEmpty, muscle == nil, equipment == nil {
            let program = programExercises
            if !program.isEmpty {
                list(Text("Dans ton programme", tableName: "Exercices"), program)
            }
            let rest = found.filter { exercise in !program.contains { $0.exercise.id == exercise.id } }
            list(Text("Tous · \(rest.count)", tableName: "Exercices"), rest.map { ($0, nil) })
        } else {
            list(Text("\(found.count) exercices", tableName: "Exercices"), found.map { ($0, letter($0.id)) })
        }
    }

    /// The exercises of the active rotation, in its order, each with the first session holding it.
    private var programExercises: [(exercise: LibraryExercise, code: String?)] {
        var seen = Set<String>()
        return training.sessions.flatMap { session in
            session.plan.compactMap { planned -> (LibraryExercise, String?)? in
                guard seen.insert(planned.exerciseId).inserted, let exercise = library.exercise(planned.exerciseId)
                else { return nil }
                return (exercise, session.code)
            }
        }
    }

    private func letter(_ id: String) -> String? {
        training.sessions.first { $0.plan.contains { $0.exerciseId == id } }?.code
    }

    private func list(_ title: Text, _ items: [(exercise: LibraryExercise, code: String?)]) -> some View {
        Section {
            ForEach(items, id: \.exercise.id) { item in
                NavigationLink(value: Route.exercise(id: item.exercise.id)) {
                    ExerciseRow(exercise: item.exercise, code: item.code)
                }
                .accessibilityIdentifier("exercise.\(item.exercise.id)")
            }
        } header: {
            title.textCase(nil).foregroundStyle(.ink)
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
    }
}

/// An exercise in the list: its thumbnail, its name in English, « muscle · matériel », and the
/// session's letter when the program holds it. One element for VoiceOver.
struct ExerciseRow: View {
    let exercise: LibraryExercise
    let code: String?

    var body: some View {
        HStack(spacing: 12) {
            LoopThumb(exerciseId: exercise.id, primary: exercise.primary, secondary: exercise.secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: exercise.name).font(.body.weight(.medium)).foregroundStyle(.ink)
                Text(verbatim: ExerciseText.line(exercise)).font(.subheadline).foregroundStyle(.muted)
            }
            Spacer(minLength: 4)
            if let code {
                Text(verbatim: code)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.sessionShade)
                    .frame(width: 28, height: 28)
                    .background(Color.sessionTint, in: .circle)
                    .accessibilityLabel(Text("séance \(code)", tableName: "Exercices"))
            }
        }
        .frame(minHeight: 56)
        .accessibilityElement(children: .combine)
    }
}

/// A capsule menu over one filter: its name while off, its choice in ink once chosen.
private struct FilterMenu<Value: Hashable>: View {
    let title: Text
    let id: String
    let options: [(Value, String)]
    @Binding var choice: Value?

    var body: some View {
        let chosen = options.first { $0.0 == choice }?.1
        Menu {
            Picker(selection: $choice) {
                Text("Tous", tableName: "Exercices").tag(Value?.none)
                ForEach(options, id: \.0) { Text(verbatim: $0.1).tag(Value?.some($0.0)) }
            } label: {
                title
            }
        } label: {
            HStack(spacing: 4) {
                if let chosen { Text(verbatim: chosen) } else { title }
                Image(systemName: "chevron.down").font(.caption.weight(.bold))
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(chosen == nil ? Color.ink : Color.paper)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(chosen == nil ? Color.surface : Color.ink, in: .capsule)
        }
        .accessibilityIdentifier(id)
        .accessibilityLabel(chosen.map { Text("\(title)\u{202F}: \($0)", tableName: "Exercices") } ?? title)
    }
}

/// How the library's muscles and equipment read, in the app's language.
enum ExerciseText {
    /// Belay's sixteen muscles, upper body first, as the web lists them.
    static let muscles = [
        "chest", "front_delts", "side_delts", "rear_delts", "biceps", "triceps", "forearms", "lats", "upper_back",
        "lower_back", "abs", "glutes", "quads", "hamstrings", "adductors", "calves",
    ]

    static func muscle(_ id: String) -> String {
        switch id {
        case "chest": String(localized: "Pectoraux", table: "Exercices")
        case "front_delts": String(localized: "Épaules avant", table: "Exercices")
        case "side_delts": String(localized: "Épaules latérales", table: "Exercices")
        case "rear_delts": String(localized: "Épaules arrière", table: "Exercices")
        case "biceps": String(localized: "Biceps", table: "Exercices")
        case "triceps": String(localized: "Triceps", table: "Exercices")
        case "forearms": String(localized: "Avant-bras", table: "Exercices")
        case "lats": String(localized: "Grand dorsal", table: "Exercices")
        case "upper_back": String(localized: "Haut du dos", table: "Exercices")
        case "lower_back": String(localized: "Bas du dos", table: "Exercices")
        case "abs": String(localized: "Abdos", table: "Exercices")
        case "glutes": String(localized: "Fessiers", table: "Exercices")
        case "quads": String(localized: "Quadriceps", table: "Exercices")
        case "hamstrings": String(localized: "Ischios", table: "Exercices")
        case "adductors": String(localized: "Adducteurs", table: "Exercices")
        case "calves": String(localized: "Mollets", table: "Exercices")
        default: id
        }
    }

    static func equipment(_ equipment: Equipment) -> String {
        switch equipment {
        case .barbell: String(localized: "Barre", table: "Exercices")
        case .dumbbell: String(localized: "Haltères", table: "Exercices")
        case .machine: String(localized: "Machine", table: "Exercices")
        case .cable: String(localized: "Poulie", table: "Exercices")
        case .bodyweight: String(localized: "Poids du corps", table: "Exercices")
        case .other: String(localized: "Autre", table: "Exercices")
        }
    }

    /// « Pectoraux · Barre ».
    static func line(_ exercise: LibraryExercise) -> String {
        let muscle = exercise.primary.first.map(muscle)
        return [muscle, equipment(exercise.equipment)].compactMap(\.self).joined(separator: " · ")
    }
}

/// « Comment faire »: each exercise's steps, bundled with the app in French and English and read
/// once, in the app's language, the first time a page asks.
enum HowTo {
    nonisolated private static let french: [String: [String]] = read("fr")
    nonisolated private static let english: [String: [String]] = read("en")

    nonisolated static func steps(_ exerciseId: String) -> [String] {
        let language = Bundle.main.preferredLocalizations.first ?? "fr"
        return (language.hasPrefix("en") ? english : french)[exerciseId] ?? []
    }

    nonisolated private static func read(_ language: String) -> [String: [String]] {
        // A build without them still opens the page, its steps left out, and says why.
        let log = Logger(subsystem: "cloud.libresoftware.belay", category: "library")
        guard let url = Bundle.main.url(forResource: language, withExtension: "json") else {
            log.error("steps not read: missing \(language, privacy: .public)")
            return [:]
        }
        do {
            return try JSONDecoder().decode([String: [String]].self, from: Data(contentsOf: url))
        } catch {
            log.error("steps not read: unreadable \(language, privacy: .public)")
            return [:]
        }
    }
}
