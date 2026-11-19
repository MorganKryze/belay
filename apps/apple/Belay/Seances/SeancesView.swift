import SwiftUI
import os

/// Séances: the program and the sessions kept. The segment chosen is the shell's, so it stays
/// while the app runs.
struct SeancesView: View {
    enum Segment: Hashable, CaseIterable {
        case programme, historique, exercices

        var title: Text {
            switch self {
            case .programme: Text("Programme", tableName: "Seances")
            case .historique: Text("Historique", tableName: "Seances")
            case .exercices: Text("Exercices", tableName: "Exercices")
            }
        }
    }

    let training: TrainingModel
    @Binding var segment: Segment
    /// Pushes a session's preview.
    let openPreview: (String) -> Void
    @State private var choosing = false
    /// Exercices' search, kept while the app runs as the segment is.
    @State private var query = ""

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "seances")

    var body: some View {
        List {
            Section {
                Picker(selection: $segment) {
                    ForEach(Segment.allCases, id: \.self) { $0.title.tag($0) }
                } label: {
                    Text("Afficher", tableName: "Seances")
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .controlSize(.large)
                .sensoryFeedback(.selection, trigger: segment)
                .listRowBackground(Color.clear)
                .listRowInsets(.all, 0)
            }
            switch segment {
            case .programme:
                ProgrammeSection(
                    state: training.programmeState, programs: training.programs,
                    activeId: training.activeProgramId, openPreview: openPreview
                ) { choosing = true }
            case .historique:
                HistorySection(weeks: training.weeks)
            case .exercices:
                ExercisesSection(training: training, query: query)
            }
        }
        .belayList()
        .modifier(ExerciseSearch(on: segment == .exercices, query: $query))
        .navigationTitle(Text(AppTab.seances.title))
        .largeTitleOnly()
        .sheet(isPresented: $choosing) {
            ProgramChoiceSheet(programs: training.programs, activeId: training.activeProgramId) { id in
                choose(id)
            }
        }
    }

    private func choose(_ id: String) {
        do {
            try training.chooseProgram(id)
            choosing = false
        } catch {
            // The sheet stays open on the list as it stands: the tap can be tried again.
            Self.log.error("program not chosen: \(String(describing: error), privacy: .public)")
        }
    }
}

/// Exercices' search field, under Séances' large title while that segment shows.
private struct ExerciseSearch: ViewModifier {
    let on: Bool
    @Binding var query: String

    func body(content: Content) -> some View {
        if on {
            content.searchable(
                text: $query, placement: .navigationBarDrawer(displayMode: .always),
                prompt: Text("Rechercher un exercice", tableName: "Exercices"))
        } else {
            content
        }
    }
}
