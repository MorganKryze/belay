import BelayCore
import os
import SwiftUI

/// The open session, full screen: one set at a time with the foot under the thumb; once finished,
/// its summary.
struct SessionCover: View {
    let training: TrainingModel
    let lower: () -> Void
    @Environment(\.accessibilityReduceMotion) private var systemReduce

    var body: some View {
        NavigationStack {
            Group {
                if let summary = training.summary {
                    SummaryView(
                        summary: summary, giveEffort: giveEffort,
                        heldInHealth: { training.heldInHealth(summary.workoutId) }
                    ) { note in
                        do {
                            try training.closeSummary(note: note)
                        } catch {
                            // The cover stays, the note still typed in it, so the ✓ can try again.
                            Self.log.error("summary not saved: \(AccountStore.logLabel(error), privacy: .public)")
                            return false
                        }
                        lower()
                        return true
                    }
                } else if let state = training.session {
                    Cover(training: training, state: state, lower: lower)
                }
            }
        }
        // The summary gets a stack of its own, so nothing of the session's bar stays over it.
        .id(training.summary == nil)
        .animation(Motion.change(reduce: Motion.reduced(systemReduce)), value: training.summary == nil)
    }

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "summary")

    private func giveEffort(_ floor: Int?) {
        do {
            try training.giveEffort(floor)
        } catch {
            Self.log.error("effort not kept: \(AccountStore.logLabel(error), privacy: .public)")
        }
    }
}

/// The session's actions as the cover runs them: one write each, then the sync told and the state
/// read again. A write that fails is logged by its kind and said on screen.
struct CoverActions {
    let training: TrainingModel
    let failed: () -> Void

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "session")

    @discardableResult
    func run(_ action: (SessionActions) throws -> Void) -> Bool {
        do {
            try training.act(action)
            return true
        } catch {
            Self.log.error("session action not written: \(AccountStore.logLabel(error), privacy: .public)")
            failed()
            return false
        }
    }
}

/// The running session: the card for its phase, the done sets under it, and the foot, one glass
/// whose pieces flow from state to state.
struct Cover: View {
    let training: TrainingModel
    let state: SessionState
    let lower: () -> Void
    @Environment(\.accessibilityReduceMotion) private var systemReduce
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @Namespace private var glass
    @Namespace private var flow
    /// The count under the ruler: the prefill, then what the person moved it to.
    @State private var reps = 0
    /// The reserve just answered, shown in a capsule for 2 s.
    @State private var noted: Int?
    @State private var programme = false
    @State private var failed = false
    @State private var logged = 0
    @State private var answered = 0

    private var reduce: Bool { Motion.reduced(systemReduce) }

    /// VoiceOver as the system runs it, or as a debug launch takes it as running for the tests.
    private var voiceOverOn: Bool {
        #if DEBUG
        voiceOver || Fixture.voiceOver
        #else
        voiceOver
        #endif
    }
    private var motion: Animation { Motion.change(reduce: reduce) }
    private var actions: CoverActions { CoverActions(training: training) { failed = true } }

    /// The set the ruler is for.
    private var due: DueSet? {
        if case .due(let due) = state.phase, !due.timed { due } else { nil }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                card.transition(.opacity)
                if showsDone, !state.done.isEmpty {
                    DoneList(sets: state.done, asking: state.askRIR, actions: actions, space: flow, reduce: reduce)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 16)
        }
        // No band under the bar once the card scrolls up: the content runs under the glass buttons,
        // as on every titled page.
        .scrollEdgeEffectHidden(true, for: .top)
        // The cover has no title: the bar holds the clock, and the card starts right under it
        // instead of under the empty room a large title keeps.
        .navigationBarTitleDisplayMode(.inline)
        .background { Wall() }
        .safeAreaBar(edge: .bottom) { foot }
        .toolbar {
            SessionBar(
                state: state, lower: lower, pause: { withAnimation(motion) { _ = actions.run { try $0.pause() } } },
                stop: stopAsk)
        }
        .animation(motion, value: stateKey)
        .sheet(isPresented: $programme) { ProgrammeSheet(state: state, actions: actions) }
        .sensoryFeedback(.success, trigger: logged)
        .sensoryFeedback(.impact(weight: .light), trigger: answered)
        .onChange(of: due.map { "\($0.place.slotIndex)-\($0.place.position)-\($0.count)" }, initial: true) {
            if let due { reps = due.count }
        }
        // The count moved on the ruler is kept as the set's draft, so a relaunch shows it again.
        .task(id: reps) {
            guard let due, reps != due.count else { return }
            try? await Task.sleep(for: Self.draftDelay)
            // A ✓ in the meantime logged this count and moved on: the set due now keeps its own.
            guard !Task.isCancelled, case .due(let now)? = training.session?.phase, now.place == due.place else { return }
            actions.run { try $0.choose(weightKg: nil, count: reps) }
        }
        .task(id: noted) {
            guard noted != nil else { return }
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            withAnimation(motion) { noted = nil }
        }
        .onChange(of: voiceOverOn, initial: true) { training.mark { $0.voiceOver = voiceOverOn } }
        // Each new state is said once: the next exercise, the pause.
        .onChange(of: spoken) { _, said in
            if let said { AccessibilityNotification.Announcement(said).post() }
        }
        .onChange(of: restStarted) { _, started in
            if started { AccessibilityNotification.Announcement(String(localized: "Repos commencé", table: "Session")).post() }
        }
        .alert(Text("Ce n’est pas noté. Réessaie.", tableName: "Session"), isPresented: $failed) {
            Button(role: .cancel) {} label: { Text("OK", tableName: "Session") }
        }
        #if DEBUG
        .overlay(alignment: .topLeading) { Fixture.MotionProbe(animation: motion) }
        #endif
    }

    /// How long the ruler stands still before its count is kept as the draft. A debug launch
    /// stretches it, so a test can tap ✓ inside it.
    private static var draftDelay: Duration {
        #if DEBUG
        if Fixture.draftDelay > 0 { return .seconds(Fixture.draftDelay) }
        #endif
        return .milliseconds(400)
    }

    // MARK: The card

    @ViewBuilder private var card: some View {
        switch state.phase {
        case .due(let due) where due.timed:
            HoldCard(state: state, training: training, actions: actions) { programme = true }
        case .due(let due):
            SetCard(state: state, due: due, training: training, actions: actions) { programme = true }
        case .holding, .held:
            HoldCard(state: state, training: training, actions: actions) { programme = true }
        case .resting(let rest):
            RestCard(rest: rest, from: training.restFrom ?? .now, training: training, actions: actions, reduce: reduce)
        case .recap, .announce, .allDone:
            ExerciseEndCard(state: state, training: training, reduce: reduce)
        case .paused(let paused):
            PausedCard(paused: paused, reduce: reduce)
        }
    }

    private var showsDone: Bool {
        switch state.phase {
        case .due, .holding, .held, .resting: true
        default: false
        }
    }

    /// What VoiceOver says as the phase turns to the next exercise or to the pause.
    private var spoken: String? {
        switch state.phase {
        case .announce(let announce):
            String(localized: "Ensuite, \(training.exerciseName(announce.next.exerciseId))", table: "SessionEnd")
        case .paused:
            String(localized: "En pause", table: "SessionEnd")
        default: nil
        }
    }

    private var restStarted: Bool {
        if case .resting = state.phase { true } else { false }
    }

    /// What changes the cover's layout: the phase and the set it is about, the question, the capsule.
    private var stateKey: String {
        let phase: String =
            switch state.phase {
            case .due(let due): "due-\(due.place.slotIndex)-\(due.place.position)"
            case .holding: "holding"
            case .held: "held"
            case .resting: "resting"
            case .recap: "recap"
            case .announce: "announce"
            case .allDone: "allDone"
            case .paused: "paused"
            }
        return "\(phase) \(state.askRIR?.id ?? "") \(noted.map(String.init) ?? "") \(state.done.count)"
    }

    // MARK: The foot

    @ViewBuilder private var foot: some View {
        GlassEffectContainer(spacing: 18) {
            Group {
                switch state.phase {
                case .paused:
                    bigAction("play.fill", id: "play", label: Text("Reprendre", tableName: "Session")) {
                        actions.run { try $0.resume() }
                    }
                case .allDone:
                    bigAction("flag.checkered", id: "finish", label: Text("Terminer la séance", tableName: "Session")) {
                        finish()
                    }
                case .announce:
                    bigAction("forward.end.fill", id: "skip", label: Text("Passer le repos", tableName: "Session")) {
                        actions.run { try $0.skipRest() }
                    }
                case .due(let due) where due.timed:
                    bigAction("play.fill", id: "play", label: Text("Lancer la tenue", tableName: "Session")) {
                        actions.run { try $0.startHold() }
                    }
                case .holding:
                    bigAction("stop.fill", id: "stop", label: Text("Arrêter la tenue", tableName: "Session")) {
                        actions.run { try $0.stopHold() }
                    }
                case .held(let held):
                    HStack(spacing: 12) {
                        Text("\(held.seconds)\u{202F}s tenues", tableName: "Session")
                            .font(.headline)
                            .foregroundStyle(.ink)
                            .padding(.horizontal, 22)
                            .frame(height: 54)
                            .glassEffect(.regular, in: .capsule)
                            .glassEffectID("hold", in: glass)
                        check(
                            Text("Noter la série \(held.due.number), \(held.seconds)\u{202F}s", tableName: "Session")
                        ) { log(held.due, count: held.seconds) }
                    }
                case .resting, .recap:
                    reserve
                case .due(let due):
                    HStack(spacing: 12) {
                        ruler(due)
                        check(checkLabel(due)) { log(due, count: reps) }
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 4)
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
    }

    private func checkLabel(_ due: DueSet) -> Text {
        due.warmup
            ? Text("Noter la montée \(due.number), \(reps) reps", tableName: "Session")
            : Text("Noter la série \(due.number), \(reps) reps", tableName: "Session")
    }

    private func ruler(_ due: DueSet) -> some View {
        let low = due.target.first ?? 0
        let high = due.target.last ?? low
        return VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("Reps", tableName: "Session").font(.subheadline.weight(.semibold)).foregroundStyle(.ink)
                Spacer()
                Text("cible \(low)–\(high)", tableName: "Session").font(.footnote.weight(.medium)).foregroundStyle(.ink)
            }
            .padding(.horizontal, 18)
            .padding(.top, 12)
            .accessibilityHidden(true)
            RepRuler(
                value: $reps, target: due.target, flightId: DoneList.flightId(due.place), space: flow, reduce: reduce
            )
            .frame(height: 70)
            .padding(.bottom, 6)
        }
        .glassEffect(.regular, in: .rect(cornerRadius: 34))
        .glassEffectID("ruler", in: glass)
    }

    private func check(_ label: Text, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: "checkmark")
                .font(.system(size: 30, weight: .bold))
                .foregroundStyle(Color.onMark)
                .frame(width: 76, height: 76)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.tint(.mark).interactive(), in: .circle)
        .glassEffectID("check", in: glass)
        .accessibilityLabel(label)
        .accessibilityIdentifier("log-set")
    }

    private func bigAction(_ symbol: String, id: String, label: Text, action: @escaping () -> Void) -> some View {
        HStack {
            Spacer()
            Button { withAnimation(motion) { action() } } label: {
                Image(systemName: symbol)
                    .font(.system(size: 30, weight: .bold))
                    .foregroundStyle(Color.onMark)
                    .frame(width: 84, height: 84)
                    .contentShape(.circle)
            }
            .buttonStyle(.plain)
            .glassEffect(.regular.tint(.mark).interactive(), in: .circle)
            .glassEffectID(id, in: glass)
            .accessibilityLabel(label)
            .accessibilityIdentifier("foot-\(id)")
            Spacer()
        }
    }

    /// Asked, not assumed: nothing is chosen until a tap, the plan's target is the hint. Once
    /// answered, a capsule says so for 2 s and the clock stays alone.
    @ViewBuilder private var reserve: some View {
        if let noted {
            HStack(spacing: 10) {
                Image(systemName: "checkmark").font(.headline.weight(.bold)).accessibilityHidden(true)
                Text("Réserve \(Self.rir(noted)) notée", tableName: "Session").font(.headline)
            }
            .foregroundStyle(.ink)
            .padding(.horizontal, 22)
            .frame(height: 54)
            .glassEffect(.regular, in: .capsule)
            .glassEffectID("capsule", in: glass)
            .accessibilityElement(children: .combine)
        } else if let asked = state.askRIR {
            let target = training.rirTarget(slotIndex: asked.place.slotIndex)
            VStack(alignment: .leading, spacing: 10) {
                Text("Série \(asked.place.position - Bounds.maxWarmups + 1)\u{202F}: combien en réserve\u{202F}?", tableName: "Session")
                    .font(.headline)
                    .foregroundStyle(.ink)
                    .padding(.horizontal, 6)
                    .accessibilityAddTraits(.isHeader)
                HStack(spacing: 0) {
                    ForEach(0...Bounds.rirMax, id: \.self) { value in
                        if value > 0 { Spacer(minLength: 6) }
                        drop(value, for: asked)
                    }
                }
                if let low = target.first, let high = target.last {
                    Text("Cible\u{202F}: \(low)–\(high). Touche ce qui reste vraiment.", tableName: "Session")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(.ink)
                        .padding(.horizontal, 6)
                }
            }
            .padding(14)
            .background(Color.surface.opacity(0.94), in: .rect(cornerRadius: 34))
        }
    }

    private func drop(_ value: Int, for set: DoneSet) -> some View {
        Button { answer(value, for: set) } label: {
            Text(verbatim: Self.rir(value))
                .font(.custom(Font.archivoName, size: 22, relativeTo: .title2))
                .foregroundStyle(.ink)
                .frame(width: 58, height: 58)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .glassEffect(.regular.interactive(), in: .circle)
        .glassEffectID("rir\(value)", in: glass)
        .accessibilityLabel(
            value == Bounds.rirMax
                ? Text("\(value) ou plus en réserve", tableName: "Session")
                : Text("\(value) en réserve", tableName: "Session"))
        .accessibilityIdentifier("rir-\(value)")
    }

    /// « 2 », or « 4+ » at the top of the scale.
    private static func rir(_ value: Int) -> String {
        value == Bounds.rirMax ? "\(value)+" : String(value)
    }

    // MARK: Actions

    private func log(_ due: DueSet, count: Int) {
        withAnimation(motion) {
            guard actions.run({ _ = try $0.logNext(count: count, weightKg: nil, expecting: due.place) }) else { return }
            noted = nil
            logged += 1
        }
    }

    private func answer(_ value: Int, for set: DoneSet) {
        withAnimation(motion) {
            do {
                try training.answerRIR(setId: set.id, rir: value)
            } catch {
                failed = true
                return
            }
            noted = value
            answered += 1
        }
        AccessibilityNotification.Announcement(
            String(localized: "Réserve \(Self.rir(value)) notée", table: "Session")
        ).post()
    }

    /// ■'s question, counted on the work sets the plan holds.
    private var stopAsk: StopAsk {
        StopAsk(
            done: training.open?.setsDone ?? 0, planned: training.open?.setsPlanned ?? 0,
            holdsSets: training.restFrom != nil,
            stop: { withAnimation(motion) { finish() } },
            leave: {
                do {
                    try training.stopEmpty()
                } catch SessionError.notEmpty {
                    return false
                } catch {
                    failed = true
                    return true
                }
                lower()
                return true
            })
    }

    private func finish() {
        do {
            try training.finish()
        } catch {
            failed = true
        }
    }
}
