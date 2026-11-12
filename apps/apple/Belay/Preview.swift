import os
import SwiftUI

/// A session of the active program seen before it starts: when it was last kept, its exercises,
/// each with its sets and last time's, and the start at the foot.
struct SessionPreview: View {
    let training: TrainingModel
    let sessionId: String
    /// Opens the session cover, zooming from the element named.
    let openCover: (String) -> Void
    @State private var startFailed = false
    @Environment(\.zoomSpace) private var space

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "preview")

    var body: some View {
        Group {
            if let session = training.preview(sessionId) {
                content(session)
            } else {
                // Another program chosen, or this one edited elsewhere, while the preview was open.
                ContentUnavailableView(
                    String(localized: "Cette séance n’est plus dans ton programme.", table: "Seances"),
                    systemImage: "dumbbell")
            }
        }
        .background { Wall() }
        .alert("La séance n’a pas démarré. Réessaie.", isPresented: $startFailed) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder private func content(_ next: NextSession) -> some View {
        let size = Self.size(next)
        List {
            TitleLines(name: next.name, line: size)
            if next.last != nil || otherOpen != nil {
                Section {
                    if let last = next.last {
                        Text(Self.last(last))
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                            .monospacedDigit()
                            .accessibilityIdentifier("preview-last")
                    }
                    if let open = otherOpen {
                        Text(String(localized: "\(SessionText.short(open.code)) est en cours.", table: "Seances"))
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                            .accessibilityIdentifier("preview-running")
                    }
                }
                .listRowBackground(Color.surface)
            }
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
        .largeTitleOnly()
        .scrollEdgeEffectStyle(.hard, for: .bottom)
        .safeAreaBar(edge: .bottom) {
            FootBar {
                // A session already open, this one or another, is taken up: never a second one.
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
            _ = try training.start(sessionId: sessionId)
            openCover(Morph.start)
        } catch {
            Self.log.error("session not started: \(String(describing: error), privacy: .public)")
            startFailed = true
        }
    }
}

extension SessionPreview {
    /// Another session open while this one is seen; nil when none is, or when it is this one. Two
    /// programs can each have a session A, so the program session tells them apart, not the letter.
    private var otherOpen: OpenSession? {
        guard let open = training.open, open.sessionId != sessionId else { return nil }
        return open
    }

    /// « 6 exercices · 19 séries · environ 55 min ».
    private static func size(_ session: NextSession) -> String {
        [
            String(localized: "\(session.exercises) exercices"),
            String(localized: "\(session.sets) séries", table: "Seances"),
            String(localized: "environ \(session.minutes)\u{202F}min"),
        ].joined(separator: " · ")
    }

    /// « La dernière fois : jeudi 1 octobre, 58 min ».
    private static func last(_ last: LastKept) -> String {
        let day = WeekdayText.day(last.startedAt)
        return String(
            localized: "La dernière fois\u{202F}: \(day), \(SessionText.duration(ms: last.durationMs))", table: "Seances")
    }
}

/// The lines under a large title, as the list's first row: the session's name, then its line; the
/// line alone for a session with no name. Not in the bar's subtitle slot: a pushed screen whose bar
/// needs more height than the one it leaves (Séances' title has no subtitle) opens on the compact
/// bar, its large title and lines gone. The title in the wide face holds « Séance C » at any text
/// size, where « Séance C · Fessiers + tirage léger » would truncate.
struct TitleLines: View {
    let name: String?
    let line: String

    var body: some View {
        Section {
            VStack(alignment: .leading, spacing: 4) {
                if let name, !name.isEmpty {
                    Text(name).font(.title3.weight(.semibold)).foregroundStyle(.ink)
                }
                Text(line).font(.subheadline).foregroundStyle(.muted).monospacedDigit()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .listRowBackground(Color.clear)
            .listRowInsets(.init(top: 6, leading: 0, bottom: 0, trailing: 0))
        }
    }
}
