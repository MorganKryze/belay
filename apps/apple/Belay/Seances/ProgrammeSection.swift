import BelayCore
import SwiftUI

/// Séances' Programme segment: the week on fixed days, the sessions with the day's mark, the
/// active program and the rhythm; or, with no program active, the way to choose one.
struct ProgrammeSection: View {
    let state: ProgrammeState?
    let programs: [ProgramChoice]
    let activeId: String?
    /// Pushes a session's preview.
    let openPreview: (String) -> Void
    /// Opens « Programme actif ».
    let choose: () -> Void

    var body: some View {
        if let state, state.program != nil, let active = programs.first(where: { $0.id == activeId }) {
            if let week = state.week, let perWeek = state.perWeek {
                Section {
                    WeekStrip(week: week)
                        .padding(.vertical, 6)
                } header: {
                    Text("Ta semaine", tableName: "Seances").textCase(nil).foregroundStyle(.ink)
                } footer: {
                    Text(Self.perWeek(perWeek)).foregroundStyle(.muted)
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
            }
            Section {
                ForEach(state.sessions) { session in
                    SessionRow(session: session) { openPreview(session.sessionId) }
                }
            } header: {
                Text(active.title).textCase(nil).foregroundStyle(.ink)
            }
            .headerProminence(.increased)
            .listRowBackground(Color.surface)
            Section {
                ActiveProgramRow(program: active, action: choose)
                RhythmRow(rhythm: state.rhythm)
            } footer: {
                Text("Les exercices du programme se modifient sur ordinateur.", tableName: "Seances")
                    .foregroundStyle(.muted)
            }
            .listRowBackground(Color.surface)
        } else {
            Section {
                VStack(alignment: .leading, spacing: 12) {
                    DomainChip(
                        domain: .session, text: String(localized: "Aucun programme", table: "Seances"),
                        symbol: "calendar")
                    Text("Un programme range tes séances A, B, C et tes jours de repos.", tableName: "Seances")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    PrimaryButton(title: "Choisir un programme", tableName: "Seances", action: choose)
                        .accessibilityIdentifier("seances-choose")
                        .padding(.top, 6)
                }
                .padding(.vertical, 12)
            }
            .listRowBackground(Color.surface)
        }
    }

    /// « 3 séances et 4 jours de repos par semaine. »
    private static func perWeek(_ count: PerWeek) -> String {
        String(localized: "\(count.sessions) séances et \(count.rest) jours de repos par semaine.", table: "Seances")
    }
}

/// One session of the program: its letter tile, its name and size, and the day's mark. A tap
/// opens its preview; a long press offers it with a peek.
private struct SessionRow: View {
    let session: SessionRowState
    let open: () -> Void
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        NavigationLink(value: Route.preview(sessionId: session.sessionId)) {
            Group {
                // At the largest sizes the tile rises above the words, so they keep the row's width.
                if typeSize.isAccessibilitySize {
                    VStack(alignment: .leading, spacing: 6) {
                        if let mark = session.mark { MarkChip(mark: mark) }
                        LetterTile(letter: session.code)
                        words(withChip: false)
                    }
                } else {
                    HStack(spacing: 14) {
                        LetterTile(letter: session.code)
                        words(withChip: true)
                    }
                }
            }
            .padding(.vertical, 8)
            .frame(minHeight: 56)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(SessionText.title(session.code, name: session.name)), \(size)")
        .accessibilityValue(session.mark.map(MarkChip.text) ?? "")
        .accessibilityHint(Text("Ouvre la séance", tableName: "Seances"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("session.\(session.code)")
        .contextMenu {
            Button(action: open) {
                Label(String(localized: "Voir la séance", table: "Seances"), systemImage: "arrow.up.right")
            }
        } preview: {
            SessionPeek(session: session)
        }
    }

    private var size: String { SessionText.size(exercises: session.exercises, minutes: session.minutes) }

    private func words(withChip: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if withChip, let mark = session.mark { MarkChip(mark: mark) }
            Text(session.name.flatMap { $0.isEmpty ? nil : $0 } ?? SessionText.short(session.code))
                .font(.body.weight(.semibold))
                .foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(size)
                .font(.subheadline)
                .foregroundStyle(.muted)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The day's mark on a session row: what comes next, what is under way, what is done.
private struct MarkChip: View {
    let mark: SessionRowState.Mark

    var body: some View {
        switch mark {
        case .next: DomainChip(domain: .session, text: Self.text(mark), symbol: "arrow.forward")
        case .running: DomainChip(domain: .session, text: Self.text(mark), symbol: "dumbbell.fill")
        case .tomorrow: DomainChip(domain: .session, text: Self.text(mark), symbol: "arrow.forward")
        case .doneToday: DomainChip(domain: .activity, text: Self.text(mark), symbol: "checkmark")
        }
    }

    static func text(_ mark: SessionRowState.Mark) -> String {
        switch mark {
        case .next: String(localized: "La prochaine", table: "Seances")
        case .running: String(localized: "En cours", table: "Seances")
        case .tomorrow: String(localized: "Demain", table: "Seances")
        case .doneToday: String(localized: "Faite aujourd’hui", table: "Seances")
        }
    }
}

/// What a long press on a session shows before it opens.
private struct SessionPeek: View {
    let session: SessionRowState

    var body: some View {
        HStack(spacing: 14) {
            LetterTile(letter: session.code)
            VStack(alignment: .leading, spacing: 2) {
                Text(SessionText.title(session.code, name: session.name))
                    .font(.headline)
                    .foregroundStyle(.ink)
                Text(SessionText.size(exercises: session.exercises, minutes: session.minutes))
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .monospacedDigit()
            }
        }
        .padding(20)
        .frame(width: 320, alignment: .leading)
        .background(Color.surface)
    }
}

/// « Programme actif »: the program's name and its sessions; it opens the program sheet.
private struct ActiveProgramRow: View {
    let program: ProgramChoice
    let action: () -> Void

    var body: some View {
        let line = "\(program.title) · \(String(localized: "\(program.sessions) séances", table: "Seances"))"
        Button(action: action) {
            HStack(spacing: 14) {
                SymbolTile(domain: .session, symbol: "list.bullet.rectangle")
                VStack(alignment: .leading, spacing: 2) {
                    Text("Programme actif", tableName: "Seances")
                        .font(.body.weight(.medium))
                        .foregroundStyle(.ink)
                    Text(line)
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.muted)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 52)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(String(localized: "Programme actif", table: "Seances")), \(line)")
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("programme-active")
    }
}

/// « Rythme », said in words. Changing it stays on the computer for now, so the row opens nothing.
private struct RhythmRow: View {
    let rhythm: Rhythm

    var body: some View {
        HStack(spacing: 14) {
            SymbolTile(domain: .rest, symbol: "moon.zzz.fill")
            VStack(alignment: .leading, spacing: 2) {
                Text("Rythme", tableName: "Seances")
                    .font(.body.weight(.medium))
                    .foregroundStyle(.ink)
                Text(words)
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .frame(minHeight: 52)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(String(localized: "Rythme", table: "Seances")), \(words)")
        .accessibilityIdentifier("rhythm")
    }

    /// « A, B, C à la suite » in rotation, « 3 séances par semaine » on a fixed week.
    private var words: String {
        switch rhythm {
        case .rotation(let letters):
            String(localized: "\(letters.joined(separator: ", ")) à la suite", table: "Seances")
        case .fixed(let sessions):
            String(localized: "\(sessions) séances par semaine", table: "Seances")
        }
    }
}

/// A row's symbol on its domain's tint, the size of a session's letter tile.
private struct SymbolTile: View {
    let domain: Domain
    let symbol: String
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 36

    var body: some View {
        Image(systemName: symbol)
            .font(.body.weight(.semibold))
            .foregroundStyle(domain.shade)
            .frame(width: side, height: side)
            .background(domain.tint, in: .rect(cornerRadius: 10))
            .accessibilityHidden(true)
    }
}
