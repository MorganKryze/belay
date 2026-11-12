import SwiftUI
import os

/// Séances: the program and, from the next change, the sessions kept. The segment chosen is the
/// shell's, so it stays while the app runs.
struct SeancesView: View {
    enum Segment: Hashable, CaseIterable {
        case programme, historique

        var title: Text {
            switch self {
            case .programme: Text("Programme", tableName: "Seances")
            case .historique: Text("Historique", tableName: "Seances")
            }
        }
    }

    let training: TrainingModel
    @Binding var segment: Segment
    /// Pushes a session's preview.
    let openPreview: (String) -> Void
    @State private var choosing = false

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
                // The sessions kept come with their own screens; until then the segment is empty.
                EmptyView()
            }
        }
        .belayList()
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
