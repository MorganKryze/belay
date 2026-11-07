import os
import SwiftUI

/// The session Accueil offers next, seen before it starts: its exercises, each with its sets and
/// last time's, and the start at the foot.
struct SessionPreview: View {
    let training: TrainingModel
    /// Opens the session cover, zooming from the element named.
    let openCover: (String) -> Void
    @State private var startFailed = false
    @Environment(\.zoomSpace) private var space

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "preview")

    var body: some View {
        Group {
            if let next = training.next {
                content(next)
            } else {
                ContentUnavailableView("Aucune séance prévue. Choisis un programme sur le web.", systemImage: "dumbbell")
            }
        }
        .background { Wall() }
        .alert("La séance n’a pas démarré. Réessaie.", isPresented: $startFailed) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder private func content(_ next: NextSession) -> some View {
        let size = SessionText.size(exercises: next.exercises, minutes: next.minutes)
        List {
            Section {
                ForEach(next.plan) { exercise in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(exercise.name).font(.body.weight(.medium)).foregroundStyle(.ink)
                        Text(SessionText.target(exercise))
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                            .monospacedDigit()
                    }
                    .padding(.vertical, 3)
                    .accessibilityElement(children: .combine)
                }
                Text("Le programme se modifie sur ordinateur.")
                    .font(.footnote)
                    .foregroundStyle(.muted)
            } header: {
                Text("Exercices").textCase(nil).foregroundStyle(.ink)
            }
            .headerProminence(.increased)
            .listRowBackground(Color.surface)
        }
        .belayList()
        .navigationTitle(SessionText.short(next.code))
        .navigationBarTitleDisplayMode(.large)
        .modifier(Subtitle(name: next.name, line: size))
        .scrollEdgeEffectStyle(.hard, for: .bottom)
        .safeAreaBar(edge: .bottom) {
            FootBar {
                // Started here and lowered, the session waits above the tab bar: the foot takes it up.
                if training.open != nil {
                    PrimaryButton(title: "Reprendre la séance", place: .foot) { openCover(Morph.start) }
                        .zoomSource(Morph.start, in: space, radius: 30)
                } else {
                    PrimaryButton(title: "Commencer la séance", place: .foot, action: start)
                        .zoomSource(Morph.start, in: space, radius: 30)
                }
            }
        }
    }

    private func start() {
        do {
            _ = try training.start()
            openCover(Morph.start)
        } catch {
            Self.log.error("session not started: \(String(describing: error), privacy: .public)")
            startFailed = true
        }
    }
}

/// Under a large title, the session's name then its line; the line alone for a session with no name.
struct Subtitle: ViewModifier {
    let name: String?
    let line: String

    func body(content: Content) -> some View {
        if let name, !name.isEmpty {
            content.belaySubtitle(name: name, line)
        } else {
            content.belaySubtitle(line)
        }
    }
}
