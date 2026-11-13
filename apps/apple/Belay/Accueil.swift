import BelayCore
import SwiftUI
import os

/// Accueil: the day's session in whichever state the day is in, and what the sync waits for, said
/// here only. The trend and the day's entries come with the screens they open.
struct AccueilView: View {
    let training: TrainingModel
    let notice: SyncNotice
    /// How the instance names the person; nil until it has said so.
    let displayName: String?
    /// Pushes a session's preview.
    let openPreview: (String) -> Void
    /// Opens the session cover, zooming from the element named.
    let openCover: (String) -> Void
    /// How far the list has scrolled, so the band behind the title leaves with it.
    @State private var scrolled: CGFloat = 0
    @State private var choosing = false

    var body: some View {
        List {
            Section {
                card
                if let ahead { NextRow(when: when(ahead), session: ahead) { openPreview(ahead.sessionId) } }
            }
            .listRowBackground(Color.surface)
        }
        // Inside the list's wall, so the wall lies under the band and the rows over it.
        .background(alignment: .top) { AccueilBand(domain: domain, scrolled: scrolled) }
        .belayList()
        .onScrollGeometryChange(for: CGFloat.self) { $0.contentOffset.y + $0.contentInsets.top } action: { _, y in
            scrolled = y
        }
        .safeAreaInset(edge: .top, spacing: 0) { notice }
        .navigationTitle(title)
        .largeTitleOnly()
        .belaySubtitle(WeekdayText.day(training.readAt).capitalizedFirst)
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
        .sheet(isPresented: $choosing) {
            ProgramChoiceSheet(programs: training.programs, activeId: training.activeProgramId) { id in
                choose(id)
            }
        }
    }

    /// « Bonjour Ada », or the tab's name before the instance has named the person.
    private var title: Text {
        guard let name = displayName, !name.isEmpty else { return Text(AppTab.home.title) }
        return Text("Bonjour \(name)")
    }

    /// A rest day reads in the rest colour; every other state is the session's.
    private var domain: Domain {
        if case .rest = training.accueil { .rest } else { .session }
    }

    /// The next session named under the card on a day already done or at rest.
    private var ahead: NextLine? {
        switch training.accueil {
        case .doneToday(_, let next)?: next
        case .rest(let next)?: next
        default: nil
        }
    }

    @ViewBuilder private var card: some View {
        switch training.accueil {
        case .running?:
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
            }
        case .next(let next)?:
            nextCard(next, state: String(localized: "La prochaine"))
        case .due(let next, let weekday)?:
            nextCard(next, state: String(localized: "Prévue ce \(WeekdayText.name(weekday))", table: "Accueil"))
        case .doneToday(let done, _)?:
            DoneDayCard(done: done, state: doneState(done.mark))
        case .rest?:
            RestDayCard()
        case .some(.none):
            ChooseCard(first: false) { choosing = true }
        case .first?:
            ChooseCard(first: true) { choosing = true }
        case nil:
            EmptyView()
        }
    }

    private func nextCard(_ next: NextCard, state: String) -> some View {
        DayCard(
            state: state, lead: SessionText.short(next.code), name: next.name,
            line: SessionText.size(exercises: next.exercises, minutes: next.minutes),
            button: "Voir la séance", source: Morph.card
        ) {
            openPreview(next.sessionId)
        }
    }

    /// « Faite aujourd'hui », or the weekday a fixed day's session was done early on.
    private func doneState(_ mark: DayMark) -> String {
        guard case .weekday(let day) = mark else { return String(localized: "Faite aujourd’hui", table: "Accueil") }
        return String(localized: "Faite \(WeekdayText.name(day))", table: "Accueil")
    }

    /// « Demain », the weekday within the week, or « La prochaine » in rotation, as the web says.
    private func when(_ line: NextLine) -> String {
        switch line.mark {
        case nil: String(localized: "La prochaine")
        case .today?: String(localized: "Aujourd’hui", table: "Accueil")
        case .tomorrow?: String(localized: "Demain", table: "Accueil")
        case .weekday(let day)?:
            WeekdayText.name(day).capitalizedFirst
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

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "accueil")


}

/// Days as the screens write them, in the person's language; a schedule's weekday runs Monday 0
/// to Sunday 6.
enum WeekdayText {
    /// « mercredi », as it reads inside a sentence.
    static func name(_ weekday: Int) -> String {
        Calendar.current.weekdaySymbols[calendarIndex(weekday)]
    }

    /// « M », the weekday's initial.
    static func initial(_ weekday: Int) -> String {
        Calendar.current.veryShortStandaloneWeekdaySymbols[calendarIndex(weekday)]
    }

    /// « mercredi 7 octobre », as it reads inside a sentence.
    static func day(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.wide))
    }

    /// « 18 h 00 » in French, as a length reads « 1 h 4 min »; the locale's own clock elsewhere,
    /// « 6:00 PM » in English.
    static func time(_ date: Date) -> String {
        guard Bundle.main.preferredLocalizations.first == "fr" else {
            return date.formatted(date: .omitted, time: .shortened)
        }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        let minute = (parts.minute ?? 0).formatted(.number.precision(.integerLength(2)))
        return "\(parts.hour ?? 0)\u{202F}h\u{202F}\(minute)"
    }

    /// The calendar counts from Sunday.
    private static func calendarIndex(_ weekday: Int) -> Int { (weekday + 1) % 7 }
}

extension String {
    /// « Mercredi 7 octobre »: the text as a label starts, the rest left as it is.
    var capitalizedFirst: String { prefix(1).localizedUppercase + dropFirst() }
}

/// How a session is named and sized, the same on the card, the accessory and the cover.
enum SessionText {
    /// « 48 min », « 1 h 5 min », « 1 h »: one way to say a length, on Accueil, the history and
    /// the summary alike.
    static func duration(ms: Int) -> String {
        let minutes = max(ms, 0) / 60_000
        guard minutes >= 60 else { return "\(minutes)\u{202F}min" }
        let hours = "\(minutes / 60)\u{202F}h"
        return minutes % 60 == 0 ? hours : "\(hours)\u{202F}\(minutes % 60)\u{202F}min"
    }

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

    /// « 62,5 kg × 8 », « 45 s », « 5 kg · 45 s »; nil while the load is still to type, and for
    /// a set of reps with no load: a first time knows none yet, and « 0 kg × 6 » reads as one.
    static func load(_ set: CurrentSet) -> String? {
        guard let weightKg = set.weightKg, let count = set.count, weightKg > 0 || set.timed else { return nil }
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

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DomainChip(domain: .session, text: state, symbol: "dumbbell.fill")
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

/// Accueil's band: the day's domain tint at the top of the screen fading to the wall, behind the
/// title: violet on a rest day, the session's blue otherwise. It moves with the list, as the title
/// does, and goes wherever plainer grounds are asked for, as the wall's dust does.
struct AccueilBand: View {
    let domain: Domain
    let scrolled: CGFloat
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.contrastIncreased) private var contrastIncreased

    var body: some View {
        if !reduceTransparency && contrast != .increased && !contrastIncreased {
            LinearGradient(colors: [domain.tint, domain.tint.opacity(0)], startPoint: .top, endPoint: .bottom)
                .frame(height: 280)
                .offset(y: -max(scrolled, 0))
                .ignoresSafeArea(edges: .top)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
}

/// Today's session done: the record stands in ink with no blue button, its figures in tiles.
struct DoneDayCard: View {
    let done: DoneCard
    let state: String
    @Environment(\.zoomSpace) private var space

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DomainChip(domain: .session, text: state, symbol: "checkmark")
            DayHero(text: SessionText.short(done.code))
                .padding(.top, 10)
            if let name = done.name, !name.isEmpty {
                Text(name)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.ink)
                    .padding(.top, 4)
            }
            DoneTiles(durationMs: done.durationMs, sets: done.workSets, effort: done.effort)
                .padding(.top, 16)
        }
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .zoomSource(Morph.card, in: space)
    }
}

/// Duration, sets and the effort when this phone holds it: side by side while they fit, one under
/// the other at the largest text sizes, so no figure ever covers another.
struct DoneTiles: View {
    let durationMs: Int
    let sets: Int
    let effort: Int?

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top, spacing: 12) { tiles }
            VStack(alignment: .leading, spacing: 10) { tiles }
        }
    }

    @ViewBuilder private var tiles: some View {
        tile(String(localized: "Durée", table: "Accueil"), id: "duration") {
            Text(SessionText.duration(ms: durationMs))
        }
        tile(String(localized: "Séries", table: "Accueil"), id: "sets") {
            Text(sets.formatted())
        }
        if let effort {
            tile(String(localized: "Effort", table: "Accueil"), id: "effort") {
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    EffortGlyph(floor: effort)
                    Text(EffortText.word(effort))
                }
            }
        }
    }

    private func tile(_ label: String, id: String, @ViewBuilder value: () -> some View) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.muted)
            value()
                .font(.title3.weight(.bold))
                .foregroundStyle(.ink)
                .monospacedDigit()
                .lineLimit(1)
                .fixedSize()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("done.\(id)")
    }

}

/// The effort's five floors, filled up to the one given; the word always comes with it.
struct EffortGlyph: View {
    let floor: Int
    @ScaledMetric(relativeTo: .subheadline) private var unit: CGFloat = 3

    var body: some View {
        HStack(alignment: .bottom, spacing: unit * 0.7) {
            ForEach(1...5, id: \.self) { step in
                RoundedRectangle(cornerRadius: unit * 0.5)
                    .fill(step <= floor ? Color.ink : Color.line)
                    .frame(width: unit * 1.6, height: unit * (1.2 + Double(step) * 0.9))
            }
        }
        .accessibilityHidden(true)
    }
}

/// A rest day on a fixed week says so plainly, in the rest colour: nothing to do, so nothing blue.
struct RestDayCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            DomainChip(domain: .rest, text: String(localized: "Jour de repos", table: "Accueil"), symbol: "moon.zzz.fill")
            DayHero(text: String(localized: "Repos", table: "Accueil"))
                .padding(.top, 10)
            Text("Prévu par ton programme", tableName: "Accueil")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.ink)
                // At AX3 the list cut it short on one line.
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            Text("Tes muscles se reconstruisent aujourd’hui.", tableName: "Accueil")
                .font(.subheadline)
                .foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
        }
        .padding(.top, 12)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Nothing planned: the card keeps its place and offers the one way to fill it. On the first
/// launch it welcomes with the mark instead of a chip.
struct ChooseCard: View {
    let first: Bool
    let choose: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if first {
                HStack(alignment: .center, spacing: 14) {
                    WelcomeMark(side: 52)
                    Text("Bienvenue", tableName: "Accueil")
                        .font(.displayCard)
                        .foregroundStyle(.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                        .accessibilityAddTraits(.isHeader)
                }
                Text("Choisis un programme pour ta première séance.", tableName: "Accueil")
                    .font(.body)
                    .foregroundStyle(.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 14)
            } else {
                DomainChip(
                    domain: .session, text: String(localized: "Aucune séance prévue", table: "Accueil"),
                    symbol: "calendar")
                Text("Choisis un programme\u{202F}: ta prochaine séance s’affichera ici.", tableName: "Accueil")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 12)
            }
            PrimaryButton(title: "Choisir un programme", tableName: "Accueil", action: choose)
                .padding(.top, 20)
        }
        .padding(.top, first ? 14 : 12)
        .padding(.bottom, 8)
    }
}

/// « Demain » and the session, quiet, under the card: the next one is a tap away, never a second
/// blue button. It reads as one element that opens the session's preview.
struct NextRow: View {
    let when: String
    let session: NextLine
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                LetterTile(letter: session.code)
                VStack(alignment: .leading, spacing: 1) {
                    Text(when)
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                    Text(SessionText.title(session.code, name: session.name))
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.ink)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.muted)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 4)
            .frame(minHeight: 52)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(when), \(SessionText.title(session.code, name: session.name))")
        .accessibilityHint(Text("Ouvre la séance", tableName: "Accueil"))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("next-row")
    }
}

/// A session's letter on the session tint: the tile a row leads with.
struct LetterTile: View {
    let letter: String
    var domain = Domain.session
    @ScaledMetric(relativeTo: .title2) private var side: CGFloat = 48

    var body: some View {
        Text(letter)
            .font(.custom(Font.archivoName, size: 24, relativeTo: .title2))
            .foregroundStyle(domain.shade)
            .frame(width: side, height: side)
            .background(domain.tint, in: .rect(cornerRadius: 13))
            .accessibilityHidden(true)
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
