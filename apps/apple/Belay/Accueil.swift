import os
import SwiftUI

/// Accueil: the day's session, next or under way. The trend and the day's entries come with the
/// screens they open.
struct AccueilView: View {
    let training: TrainingModel
    /// Opens the session cover, zooming from the element named.
    let openCover: (String) -> Void
    @State private var startFailed = false

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "accueil")

    var body: some View {
        List {
            Section {
                card
            }
            .listRowBackground(Color.surface)
        }
        .belayList()
        .background { Wall() }
        .navigationTitle(AppTab.home.title)
        .belaySubtitle(Self.today())
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // In the toolbar's own style: with `.plain` a tap on the simulator never reached
                // the link.
                NavigationLink(value: Route.settings) {
                    Avatar()
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Réglages")
                .accessibilityIdentifier("settings")
            }
            .sharedBackgroundVisibility(.hidden)
        }
        .alert("La séance n’a pas démarré. Réessaie.", isPresented: $startFailed) {
            Button("OK", role: .cancel) {}
        }
    }

    @ViewBuilder private var card: some View {
        if let open = training.open {
            DayCard(
                state: String(localized: "En cours"), lead: SessionText.short(open.code), name: open.name,
                line: String(localized: "Séries\u{202F}: \(open.setsDone) sur \(open.setsPlanned)"),
                button: "Reprendre", source: Morph.card
            ) {
                openCover(Morph.card)
            }
        } else if let next = training.next {
            DayCard(
                state: String(localized: "La prochaine"), lead: SessionText.short(next.code), name: next.name,
                line: SessionText.size(exercises: next.exercises, minutes: next.minutes),
                button: "Commencer", source: Morph.card, action: start
            )
        } else {
            Text("Aucune séance prévue. Choisis un programme sur le web.")
                .foregroundStyle(.ink)
                .padding(.vertical, 12)
        }
    }

    private func start() {
        do {
            _ = try training.start()
            openCover(Morph.card)
        } catch {
            Self.log.error("session not started: \(String(describing: error), privacy: .public)")
            startFailed = true
        }
    }

    /// « Mercredi 7 octobre », in the person's language.
    private static func today() -> String {
        let text = Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide))
        return text.prefix(1).localizedUppercase + text.dropFirst()
    }
}

/// How a session is named and sized, the same on the card, the accessory and the cover.
enum SessionText {
    /// « Séance A ».
    static func short(_ code: String) -> String {
        String(localized: "Séance \(code)")
    }

    /// « Séance A · Pectoraux », or « Séance A » for a session with no name.
    static func title(_ code: String, name: String?) -> String {
        guard let name, !name.isEmpty else { return short(code) }
        return "\(short(code)) · \(name)"
    }

    /// « 6 exercices · environ 55 min ».
    static func size(exercises: Int, minutes: Int) -> String {
        "\(String(localized: "\(exercises) exercices")) · \(String(localized: "environ \(minutes)\u{202F}min"))"
    }
}

/// The day's session. The state leads, the session's letter is the display face, the blue button
/// sits at the card's foot: mid-screen, in thumb reach.
struct DayCard: View {
    let state: String
    let lead: String
    let name: String?
    let line: String
    let button: LocalizedStringKey
    let source: String
    let action: () -> Void
    @Environment(\.zoomSpace) private var space
    @Environment(\.horizontalSizeClass) private var width
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(state)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.muted)
                .monospacedDigit()
                .contentTransition(reduceMotion ? .identity : .numericText())
            DayHero(text: lead)
                .padding(.top, 10)
            if let name, !name.isEmpty {
                Text(name)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.ink)
                    .padding(.top, 4)
            }
            Text(line)
                .font(.subheadline)
                .foregroundStyle(.muted)
                .monospacedDigit()
                .padding(.top, 4)
            PrimaryButton(title: button, action: action)
                .padding(.top, width == .regular ? 36 : 22)
        }
        // At the top the zoom source's corner clips the card: 12 keeps the label clear of its radius.
        .padding(.top, 12)
        .padding(.bottom, 8)
        .zoomSource(source, in: space)
    }
}

/// The day's lead in the wide face, as wide as the card. It grows with the text size until it
/// meets the card's edge, then holds there on one line.
struct DayHero: View {
    let text: String
    @Environment(\.horizontalSizeClass) private var width

    var body: some View {
        Text(text)
            .font(width == .regular ? .displayHeroWide : .displayHero)
            .foregroundStyle(.ink)
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .thinsUnderBar()
    }
}
