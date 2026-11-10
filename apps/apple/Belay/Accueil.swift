import BelayCore
import SwiftUI

/// Accueil: the day's session, next or under way, and what the sync waits for, said here only.
/// The trend and the day's entries come with the screens they open.
struct AccueilView: View {
    let training: TrainingModel
    let notice: SyncNotice
    /// How the instance names the person; nil until it has said so.
    let displayName: String?
    /// Pushes the next session's preview.
    let openPreview: () -> Void
    /// Opens the session cover, zooming from the element named.
    let openCover: (String) -> Void

    var body: some View {
        List {
            Section {
                card
            }
            .listRowBackground(Color.surface)
        }
        .belayList()
        .safeAreaInset(edge: .top, spacing: 0) { notice }
        .background { Wall() }
        .navigationTitle(title)
        .largeTitleOnly()
        .belaySubtitle(Self.today())
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                // In the toolbar's own style: with `.plain` a tap on the simulator never reached
                // the link.
                NavigationLink(value: Route.settings) {
                    Avatar(letter: displayName?.first.map { String($0).localizedUppercase })
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .accessibilityLabel("Réglages")
                .accessibilityIdentifier("settings")
            }
            .sharedBackgroundVisibility(.hidden)
        }
    }

    /// « Bonjour Ada », or the tab's name before the instance has named the person.
    private var title: Text {
        guard let name = displayName, !name.isEmpty else { return Text(AppTab.home.title) }
        return Text("Bonjour \(name)")
    }

    @ViewBuilder private var card: some View {
        if let open = training.open {
            // Under way, the load leads: what is on the bar, not the session's name.
            DayCard(
                state: SessionText.progress(done: open.setsDone, of: open.setsPlanned),
                lead: open.current.flatMap(SessionText.load) ?? SessionText.short(open.code),
                name: open.current?.exercise ?? open.name,
                line: open.current.map { SessionText.setLine($0, code: open.code) } ?? SessionText.short(open.code),
                button: "Reprendre", source: Morph.card
            ) {
                openCover(Morph.card)
            }
        } else if let next = training.next {
            DayCard(
                state: String(localized: "La prochaine"), lead: SessionText.short(next.code), name: next.name,
                line: SessionText.size(exercises: next.exercises, minutes: next.minutes),
                button: "Voir la séance", source: Morph.card, action: openPreview
            )
        } else {
            Text("Aucune séance prévue. Choisis un programme sur le web.")
                .foregroundStyle(.ink)
                .padding(.vertical, 12)
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

    /// « En cours · 2 séries sur 19 ».
    static func progress(done: Int, of planned: Int) -> String {
        String(localized: "En cours · \(done) séries sur \(planned)")
    }

    /// « Série 3 sur 4 · Séance A », or « Montée 1 sur 2 · Séance A » on a warm-up, as the cover says.
    static func setLine(_ set: CurrentSet, code: String) -> String {
        set.warmup
            ? String(localized: "Montée \(set.number) sur \(set.of) · \(short(code))")
            : String(localized: "Série \(set.number) sur \(set.of) · \(short(code))")
    }

    /// « 62,5 kg × 8 », « 45 s », « 5 kg · 45 s »; nil while the load is still to type.
    static func load(_ set: CurrentSet) -> String? {
        guard let weightKg = set.weightKg, let count = set.count else { return nil }
        return set.timed
            ? load(Load(weightKg: weightKg, reps: nil, seconds: count))
            : load(Load(weightKg: weightKg, reps: count, seconds: nil))
    }

    /// A set's load and count as the summary and the card write them.
    static func load(_ load: Load) -> String {
        let kg = "\(SetText.kg(load.weightKg))\u{202F}kg"
        guard let seconds = load.seconds else { return "\(kg) × \(load.reps ?? 0)" }
        return load.weightKg > 0 ? "\(kg) · \(seconds)\u{202F}s" : "\(seconds)\u{202F}s"
    }

    /// « 4 × 6–8 · la dernière fois 62,5 kg × 8, 8, 7, 6 », or the sets alone the first time.
    static func target(_ exercise: PlannedExercise) -> String {
        let sets = "\(exercise.sets) × \(exercise.repRange.map(String.init).joined(separator: "–"))"
            + (exercise.timed ? "\u{202F}s" : "")
        guard !exercise.lastTime.isEmpty else { return sets }
        // Typed: with the store's SQL builder in scope, the literals below would build a query.
        let last: String = exercise.lastTime.map { group in
            let counts = group.counts.map(String.init).joined(separator: ", ")
            return exercise.timed && group.weightKg == 0
                ? "\(counts)\u{202F}s"
                : "\(SetText.kg(group.weightKg))\u{202F}kg × \(counts)\(exercise.timed ? "\u{202F}s" : "")"
        }.joined(separator: " · ")
        return "\(sets) · \(String(localized: "la dernière fois \(last)"))"
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
