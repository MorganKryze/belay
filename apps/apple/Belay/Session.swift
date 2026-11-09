import BelayCore
import os
import SwiftUI

/// The open session, full screen: its exercises and work sets, the next one under the thumb; once
/// finished, its summary.
struct SessionCover: View {
    let training: TrainingModel
    let lower: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        NavigationStack {
            Group {
                if let summary = training.summary {
                    SummaryView(summary: summary) {
                        training.closeSummary()
                        lower()
                    }
                } else if let cover = training.cover {
                    SessionList(training: training, cover: cover, lower: lower)
                }
            }
        }
        // The summary gets a stack of its own: the session's inline bar would otherwise hold its
        // large title down.
        .id(training.summary == nil)
        .animation(reduceMotion ? nil : .smooth, value: training.summary == nil)
    }
}

/// What the person typed into the next set, as text until it is ticked.
private struct Draft: Equatable {
    var kg: String
    var count: String
}

/// A set's two fields, so a tap anywhere on a box focuses its own.
private enum LoadField: Hashable {
    case kg(String), count(String)
}

private struct SessionList: View {
    let training: TrainingModel
    let cover: CoverState
    let lower: () -> Void
    @Environment(\.dynamicTypeSize) private var type
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// An exercise opened or folded by hand; otherwise the one up next is open, the others folded.
    @State private var opened: [Int: Bool] = [:]
    /// Counts the rests that ran to their end here: one tap of the hand each.
    @State private var restOvers = 0
    @State private var drafts: [String: Draft] = [:]
    /// The RIR chosen for a set before its tick; the plan's low target until then.
    @State private var rirs: [String: Int] = [:]
    /// The set just recorded here: its check draws itself.
    @State private var justLogged: String?
    /// Counts the sets this screen recorded: one haptic each, once the write returned.
    @State private var recorded = 0
    @State private var askFinish = false
    @State private var askDelete = false
    @State private var failed: LocalizedStringKey?
    /// The time the rest row was last checked against; moved when the rest ends or the app returns.
    @State private var clock = Date.now
    @FocusState private var typing: LoadField?

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "session")

    private var nextSet: (exercise: CoverExercise, set: CoverSet)? {
        guard let turn = cover.next,
              let exercise = cover.exercises.first(where: { $0.slotIndex == turn.slotIndex }),
              exercise.sets.indices.contains(turn.round)
        else { return nil }
        return (exercise, exercise.sets[turn.round])
    }

    private var resting: Date? {
        training.restEnd.flatMap { $0 > clock ? $0 : nil }
    }

    /// The tint moves to the next target on a critically damped spring; nothing plays under Reduce Motion.
    private var settle: Animation? { reduceMotion ? nil : .spring(duration: 0.35, bounce: 0) }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                ForEach(cover.exercises) { exercise in
                    Section {
                        header(exercise)
                            .listRowBackground(Color.surface)
                            .listRowSeparator(expanded(exercise) ? .hidden : .automatic, edges: .bottom)
                        if expanded(exercise) {
                            if !type.isAccessibilitySize {
                                columns(exercise)
                                    .listRowBackground(Color.surface)
                                    .listRowSeparator(.hidden)
                            }
                            ForEach(exercise.sets) { set in
                                row(exercise, set)
                            }
                        }
                    }
                }
            }
            // Rows packed with figures stay legible under the toolbar: the hard edge holds them back.
            .belayList(edge: .hard)
            .environment(\.defaultMinListRowHeight, 44)
            .onChange(of: cover.next) { old, _ in
                // An exercise just finished folds again, unless the person opens it.
                if let old, old.slotIndex != cover.next?.slotIndex { opened[old.slotIndex] = nil }
                withAnimation(settle) { land(proxy) }
            }
            .onAppear { DispatchQueue.main.async { land(proxy) } }
        }
        .navigationTitle(SessionText.short(cover.code))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .safeAreaBar(edge: .bottom) { foot }
        .scrollEdgeEffectStyle(.hard, for: .bottom)
        .sensoryFeedback(.success, trigger: recorded)
        .sensoryFeedback(.impact(weight: .medium), trigger: restOvers)
        .task(id: training.restEnd) { await followRest() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { clock = .now }
        }
        .alert(failed ?? "", isPresented: Binding(get: { failed != nil }, set: { if !$0 { failed = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    /// The rest row stays while its end is ahead; the clock itself is the system's. A rest that
    /// runs out here taps the hand; one moved or skipped cancels this first.
    private func followRest() async {
        clock = .now
        guard let end = training.restEnd, end > clock else { return }
        do {
            try await Task.sleep(for: .seconds(end.timeIntervalSince(clock)))
        } catch {
            return
        }
        clock = .now
        restOvers += 1
    }

    /// The exercise's name stays on screen above the load and the rest clear of the foot, as long as
    /// the table allows; past that, or at the largest text sizes, the load itself takes the middle.
    private func land(_ proxy: ScrollViewProxy) {
        guard let next = nextSet else { return }
        if next.exercise.sets.filter(\.done).count <= 5, !type.isAccessibilitySize {
            proxy.scrollTo(Self.anchor(next.exercise), anchor: .top)
        } else {
            proxy.scrollTo(next.set.id, anchor: .center)
        }
    }

    private static func anchor(_ exercise: CoverExercise) -> String {
        "exercise-\(exercise.slotIndex)"
    }

    private func expanded(_ exercise: CoverExercise) -> Bool {
        opened[exercise.slotIndex] ?? (exercise.slotIndex == cover.next?.slotIndex)
    }

    // MARK: Rows

    /// A button that folds the exercise: open, its prescription and last time; folded, where it
    /// stands in one line, with a check once every set is done.
    private func header(_ exercise: CoverExercise) -> some View {
        let open = expanded(exercise)
        let done = exercise.sets.allSatisfy(\.done)
        return Button {
            withAnimation(settle) { opened[exercise.slotIndex] = !open }
        } label: {
            HStack(spacing: 12) {
                if done {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(.ink)
                        .accessibilityHidden(true)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(exercise.name)
                        .font(.headline)
                        .foregroundStyle(.ink)
                    Text(open ? SetText.prescription(exercise) : SetText.status(exercise))
                        .font(.subheadline)
                        .foregroundStyle(.muted)
                        .monospacedDigit()
                    if open && !exercise.lastTime.isEmpty {
                        Text("la dernière fois \(SetText.lastTime(exercise))")
                            .font(.subheadline)
                            .foregroundStyle(.muted)
                            .monospacedDigit()
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.up")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.muted)
                    .rotationEffect(.degrees(open ? 0 : 180))
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 4)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(.isHeader)
        .accessibilityValue(open ? Text("ouvert") : Text("replié"))
        .accessibilityIdentifier(Self.anchor(exercise))
        .id(Self.anchor(exercise))
    }

    /// « Série · kg · Reps » over the figures, once per exercise.
    private func columns(_ exercise: CoverExercise) -> some View {
        SetColumns {
            Text("Série")
        } kg: {
            Text("kg")
        } count: {
            Text(exercise.timed ? "Secondes" : "Reps")
        } tick: {
            Color.clear.frame(height: 1)
        }
        .font(.footnote.weight(.semibold))
        .foregroundStyle(.muted)
        .listRowInsets(.init(top: 0, leading: 16, bottom: 0, trailing: 12))
        .accessibilityHidden(true)
    }

    @ViewBuilder private func row(_ exercise: CoverExercise, _ set: CoverSet) -> some View {
        let isNext = nextSet?.set.id == set.id
        if isNext {
            NextSetRow(
                exercise: exercise, set: set, draft: draft(set), touched: drafts[set.id] != nil, typing: $typing,
                tick: { tick(exercise, set) }
            )
            .id(set.id)
            .listRowBackground(Color.surface)
            .listRowSeparator(.hidden, edges: .bottom)
            if !exercise.timed {
                RIRRow(rir: rir(exercise, set))
                    .listRowBackground(Color.surface)
            }
            if let resting {
                RestRow(
                    end: resting, start: training.restFrom, label: restLabel(after: exercise, set),
                    more: { moveRest(to: resting.addingTimeInterval(30)) }, skip: { moveRest(to: nil) }
                )
                .listRowBackground(Color.surface)
            }
        } else {
            // A done row keeps its sunk tint, and the hairline between rows crosses the card in the
            // line colour, so the done rows read as one thin table rather than grey bands.
            SetRow(
                exercise: exercise, set: set, draft: draft(set), touched: drafts[set.id] != nil,
                fresh: justLogged == set.id, typing: $typing, tick: { tick(exercise, set) }
            )
                .listRowBackground(set.done ? Color.sunk : Color.surface)
                .listRowSeparatorTint(.line)
                .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
        }
    }

    private func draft(_ set: CoverSet) -> Binding<Draft> {
        Binding(
            get: { drafts[set.id] ?? Draft(kg: set.weightKg.map(SetText.kg) ?? "", count: set.count.map(String.init) ?? "") },
            set: { drafts[set.id] = $0 })
    }

    private func rir(_ exercise: CoverExercise, _ set: CoverSet) -> Binding<Int> {
        Binding(
            get: { rirs[set.id] ?? set.rir ?? exercise.rirTarget.first ?? 0 },
            set: { rirs[set.id] = $0 })
    }

    /// « Repos · série 2 ensuite », or the next exercise's name when the set up next is another's.
    private func restLabel(after exercise: CoverExercise, _ set: CoverSet) -> String {
        guard let next = nextSet else { return String(localized: "Repos") }
        if next.exercise.slotIndex == exercise.slotIndex {
            return String(localized: "Repos · série \(next.set.number) ensuite")
        }
        return String(localized: "Repos · \(next.exercise.name) ensuite")
    }

    /// The end the web moves too: 30 s later, or now with « Passer ».
    private func moveRest(to end: Date?) {
        do {
            try training.moveRest(to: end)
        } catch {
            Self.log.error("rest not moved: \(AccountStore.logLabel(error), privacy: .public)")
            failed = "Le repos n’a pas été changé. Réessaie."
        }
    }

    // MARK: Tick

    /// One tap records the set with the RIR shown under it; a timed set has none.
    private func tick(_ exercise: CoverExercise, _ set: CoverSet) {
        typing = nil
        let typed = draft(set).wrappedValue
        let rir = exercise.timed ? nil : rir(exercise, set).wrappedValue
        guard let kg = SetText.parseKg(typed.kg), let count = Int(typed.count) else {
            failed = "Indique la charge et le nombre avant de valider."
            return
        }
        do {
            try training.tick(slotIndex: set.slotIndex, position: set.position, weightKg: kg, count: count, rir: rir)
        } catch {
            Self.log.error("set not recorded: \(AccountStore.logLabel(error), privacy: .public)")
            failed = "La série n’a pas été notée. Vérifie la charge et le nombre, puis réessaie."
            return
        }
        // Only now, with the set stored: the row turns done and the hand feels it once.
        drafts[set.id] = nil
        rirs[set.id] = nil
        justLogged = set.id
        recorded += 1
        AccessibilityNotification.Announcement(String(localized: "Série notée.")).post()
    }

    // MARK: End

    private func finish() {
        do {
            try training.finish()
        } catch {
            Self.log.error("session not ended: \(String(describing: error), privacy: .public)")
            failed = "La séance n’a pas été terminée. Réessaie."
        }
    }

    /// The session goes, with every set logged in it; the program stays as it is.
    private func delete() {
        do {
            try training.delete()
        } catch {
            Self.log.error("session not removed: \(AccountStore.logLabel(error), privacy: .public)")
            failed = "La séance n’a pas été supprimée. Réessaie."
            return
        }
        lower()
    }

    /// The web's words: what is kept, what is not, and that the program stays as it is.
    private var finishMessage: String {
        let left = cover.setsPlanned - cover.setsDone
        guard left > 0 else {
            return String(
                localized: "\(cover.setsDone) séries notées sur \(cover.setsPlanned)\u{202F}; ton programme ne change pas.")
        }
        let count = String(localized: "\(cover.setsDone) séries notées sur \(cover.setsPlanned).")
        let rest = String(
            localized: "Les \(left) séries non cochées ne seront pas enregistrées\u{202F}; ton programme ne change pas.")
        return "\(count) \(rest)"
    }

    // MARK: Bars

    /// One thumb, wet hands: the next set is validated from the foot of the screen too.
    @ViewBuilder private var foot: some View {
        FootBar {
            if let next = nextSet {
                PrimaryButton(title: footTitle(next.exercise, next.set), place: .foot) { tick(next.exercise, next.set) }
                    .accessibilityIdentifier("foot")
            } else {
                PrimaryButton(title: "Terminer la séance", place: .foot) { askFinish = true }
                    .accessibilityIdentifier("foot")
            }
        }
    }

    /// « Valider la série 3 · 60 kg × 8 »: what the tap logs. At the largest sizes the row above
    /// already holds the values, so the foot keeps the set alone.
    private func footTitle(_ exercise: CoverExercise, _ set: CoverSet) -> LocalizedStringKey {
        let typed = draft(set).wrappedValue
        guard !type.isAccessibilitySize, let kg = SetText.parseKg(typed.kg), let count = Int(typed.count) else {
            return "Valider la série \(set.number)"
        }
        return "Valider la série \(set.number) · \(SetText.load(kg, count, timed: exercise.timed))"
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button("Réduire la séance", systemImage: "chevron.down", action: lower)
        }
        ToolbarItem(placement: .principal) {
            // The system counts the seconds itself, so no timer runs in the app for it.
            Text(timerInterval: cover.startedAt ... .distantFuture, countsDown: false)
                .font(.headline)
                .monospacedDigit()
                .foregroundStyle(.ink)
                .accessibilityLabel("Temps écoulé")
        }
        ToolbarItem(placement: .topBarTrailing) {
            // Both questions come from the button that asked them.
            Button("Terminer") { askFinish = true }
                .confirmationDialog("Terminer la séance\u{202F}?", isPresented: $askFinish, titleVisibility: .visible) {
                    Button("Terminer et enregistrer", action: finish)
                    Button("Supprimer la séance…", role: .destructive) { askDelete = true }
                    Button("Continuer la séance", role: .cancel) {}
                } message: {
                    Text(finishMessage)
                }
                .confirmationDialog("Supprimer la séance\u{202F}?", isPresented: $askDelete, titleVisibility: .visible) {
                    Button("Supprimer la séance", role: .destructive, action: delete)
                    Button("Continuer la séance", role: .cancel) {}
                } message: {
                    Text("Les \(cover.setsDone) séries notées ne seront pas gardées\u{202F}; ton programme ne change pas.")
                }
        }
        ToolbarItemGroup(placement: .keyboard) {
            Spacer()
            Button("OK") { typing = nil }
                .fontWeight(.semibold)
        }
    }
}

// MARK: - Set rows

/// The session table's columns, the same for every row; at accessibility sizes the label goes
/// above the figures, so nothing is cut.
private struct SetColumns<A: View, B: View, C: View, D: View>: View {
    @ViewBuilder let label: A
    @ViewBuilder let kg: B
    @ViewBuilder let count: C
    @ViewBuilder let tick: D
    @ScaledMetric(relativeTo: .subheadline) private var labelWidth: CGFloat = 56
    @Environment(\.dynamicTypeSize) private var type

    var body: some View {
        if type.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                label
                HStack(spacing: 8) {
                    kg.frame(maxWidth: .infinity)
                    count.frame(maxWidth: .infinity)
                    tick.frame(width: 56)
                }
            }
        } else {
            HStack(spacing: 8) {
                label.frame(width: labelWidth, alignment: .leading)
                kg.frame(maxWidth: .infinity)
                count.frame(maxWidth: .infinity)
                tick.frame(width: 44)
            }
        }
    }
}

/// A set done, read as one element; or one to come after the next, its boxes already holding
/// what is offered, so it can be corrected, or ticked, before its turn.
private struct SetRow: View {
    let exercise: CoverExercise
    let set: CoverSet
    @Binding var draft: Draft
    /// Typed into since it was offered: until then its boxes are dashed.
    let touched: Bool
    /// Recorded this instant: the check draws itself.
    let fresh: Bool
    var typing: FocusState<LoadField?>.Binding
    let tick: () -> Void

    var body: some View {
        Group {
            if set.done { done } else { open }
        }
        .monospacedDigit()
        .listRowInsets(.init(top: set.done ? 0 : 4, leading: 16, bottom: set.done ? 0 : 4, trailing: 12))
    }

    private var done: some View {
        SetColumns {
            Text("\(set.number)")
                .font(.subheadline.weight(.semibold))
        } kg: {
            Text(set.weightKg.map(SetText.kg) ?? "–")
        } count: {
            Text(set.count.map(String.init) ?? "–")
        } tick: {
            Tick(done: true, fresh: fresh)
        }
        .font(.body.weight(.semibold))
        .foregroundStyle(.ink)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SetText.spoken(exercise, set))
        .accessibilityIdentifier("set-\(set.id)")
    }

    private var open: some View {
        SetColumns {
            Text("\(set.number)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.muted)
                .accessibilityLabel(
                    SetText.spoken(exercise, set, weightKg: SetText.parseKg(draft.kg), count: Int(draft.count)))
                .accessibilityIdentifier("set-\(set.id)")
        } kg: {
            cell($draft.kg, .kg(set.id), keyboard: .decimalPad, id: "kg-\(set.id)",
                 label: "Charge de la série \(set.number), kg")
        } count: {
            cell($draft.count, .count(set.id), keyboard: .numberPad, id: "count-\(set.id)",
                 label: exercise.timed ? "Secondes de la série \(set.number)" : "Répétitions de la série \(set.number)")
        } tick: {
            Button(action: tick) {
                Tick(done: false, fresh: false)
            }
            .buttonStyle(.borderless)
            .accessibilityLabel("Valider la série \(set.number)")
            .accessibilityIdentifier("tick-\(set.id)")
        }
    }

    private func cell(
        _ text: Binding<String>, _ field: LoadField, keyboard: UIKeyboardType, id: String, label: LocalizedStringKey
    ) -> some View {
        TextField(text: text, prompt: Text(verbatim: "–")) { Text(label) }
            .labelsHidden()
            .accessibilityLabel(Text(label))
            .keyboardType(keyboard)
            .multilineTextAlignment(.center)
            .font(.title3)
            .foregroundStyle(touched ? .ink : .muted)
            .focused(typing, equals: field)
            .accessibilityIdentifier(id)
            .frame(maxWidth: .infinity, minHeight: 44)
            .background(Color.track, in: .rect(cornerRadius: 12))
            .overlay { if !touched { Prefilled(radius: 12) } }
            .contentShape(.rect(cornerRadius: 12))
            .onTapGesture { typing.wrappedValue = field }
    }
}

/// Offered from last time until typed into: dashed, as on every platform.
private struct Prefilled: View {
    let radius: CGFloat

    var body: some View {
        RoundedRectangle(cornerRadius: radius)
            .strokeBorder(Color.muted.opacity(0.45), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))
            .allowsHitTesting(false)
    }
}

/// The set's tick. A row just recorded arrives with its ring and turns it into the check, so the
/// symbol's own transition plays on a row that otherwise changed in one frame.
private struct Tick: View {
    let done: Bool
    @State private var checked: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(done: Bool, fresh: Bool) {
        self.done = done
        _checked = State(initialValue: done && !fresh)
    }

    var body: some View {
        Image(systemName: checked ? "checkmark.circle.fill" : "circle")
            .font(.title2)
            .foregroundStyle(checked ? .ink : .muted)
            .contentTransition(reduceMotion ? .identity : .symbolEffect(.replace.magic(fallback: .downUp.byLayer)))
            .frame(width: 44, height: 44)
            .contentShape(.rect)
            .onAppear { follow() }
            .onChange(of: done) { follow() }
    }

    private func follow() {
        guard checked != done else { return }
        withAnimation(reduceMotion ? nil : .snappy) { checked = done }
    }
}

/// The set under load: the one row in the display face, a row and a half tall.
private struct NextSetRow: View {
    let exercise: CoverExercise
    let set: CoverSet
    @Binding var draft: Draft
    let touched: Bool
    var typing: FocusState<LoadField?>.Binding
    let tick: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Série \(set.number) sur \(exercise.sets.count)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.ink)
                .monospacedDigit()
                .accessibilityLabel(SetText.spoken(exercise, set, weightKg: SetText.parseKg(draft.kg), count: Int(draft.count)))
                .accessibilityIdentifier("set-\(set.id)")
            HStack(spacing: 8) {
                cell($draft.kg, .kg(set.id), unit: "kg", keyboard: .decimalPad, id: "load-kg",
                     label: "Charge de la série \(set.number), kg")
                cell($draft.count, .count(set.id), unit: exercise.timed ? "s" : "reps", keyboard: .numberPad, id: "load-count",
                     label: exercise.timed ? "Secondes de la série \(set.number)" : "Répétitions de la série \(set.number)")
                Button(action: tick) {
                    Image(systemName: "circle")
                        .font(.largeTitle)
                        .foregroundStyle(.ink)
                        .frame(width: 52, height: 76)
                        .contentShape(.rect)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Valider la série \(set.number)")
                .accessibilityIdentifier("tick")
            }
        }
        .padding(.vertical, 6)
        .listRowInsets(.init(top: 4, leading: 16, bottom: 4, trailing: 12))
    }

    private func cell(
        _ text: Binding<String>, _ field: LoadField, unit: LocalizedStringKey, keyboard: UIKeyboardType, id: String,
        label: LocalizedStringKey
    ) -> some View {
        VStack(spacing: 0) {
            // A dash while empty: the field's name is for VoiceOver, not drawn in the box.
            TextField(text: text, prompt: Text(verbatim: "–")) { Text(label) }
                .labelsHidden()
                .accessibilityLabel(Text(label))
                .keyboardType(keyboard)
                .multilineTextAlignment(.center)
                .font(.displayLoad)
                .monospacedDigit()
                .foregroundStyle(.ink)
                .focused(typing, equals: field)
                .accessibilityIdentifier(id)
                // The display face past this size would push the tick off the row.
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
            Text(unit)
                .font(.footnote.weight(.medium))
                .foregroundStyle(.muted)
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity, minHeight: 76)
        .background(Color.track, in: .rect(cornerRadius: 16))
        .overlay { if !touched { Prefilled(radius: 16) } }
        // The field itself is one line of the box; the box is what looks like the target.
        .contentShape(.rect(cornerRadius: 16))
        .onTapGesture { typing.wrappedValue = field }
    }
}

/// Five segments, one word each, under the next set: its tick records the one chosen.
private struct RIRRow: View {
    @Binding var rir: Int
    @ScaledMetric(relativeTo: .subheadline) private var labelWidth: CGFloat = 56
    @Environment(\.dynamicTypeSize) private var type

    private var label: some View {
        Text("RIR")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.muted)
            .accessibilityHidden(true)
    }

    private var picker: some View {
        Picker("RIR, répétitions en réserve", selection: $rir) {
            ForEach(0...Bounds.rirMax, id: \.self) { value in
                Text(value == Bounds.rirMax ? "\(value)+" : "\(value)").tag(value)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .controlSize(.large)
        .sensoryFeedback(.selection, trigger: rir)
    }

    var body: some View {
        Group {
            if type.isAccessibilitySize {
                // The label moves above, so every segment keeps its 44 points.
                VStack(alignment: .leading, spacing: 6) { label; picker }
            } else {
                HStack(spacing: 8) {
                    label.frame(width: labelWidth, alignment: .leading)
                    picker
                }
            }
        }
        .listRowInsets(.init(top: 0, leading: 16, bottom: 10, trailing: 12))
    }
}

/// A system ProgressView, drawn as the rope: 3 pt of ink over a hairline of the line colour.
private struct RopeLine: ProgressViewStyle {
    let reduceMotion: Bool

    func makeBody(configuration: Configuration) -> some View {
        let fraction = configuration.fractionCompleted ?? 0
        return Color.line
            .frame(height: 1)
            .frame(maxWidth: .infinity)
            .overlay(alignment: .leading) {
                GeometryReader { box in
                    Capsule()
                        .fill(Color.ink)
                        .frame(width: box.size.width * fraction, height: 3)
                        .frame(maxHeight: .infinity, alignment: .center)
                        .animation(reduceMotion ? nil : .linear(duration: 1), value: fraction)
                }
                .frame(height: 3)
            }
            .frame(height: 3)
    }
}

/// The rest is a row of the table, under the next set: quiet, in system type at title size. It
/// counts to an absolute end, so a locked phone or a closed app finds it where it should be.
private struct RestRow: View {
    let end: Date
    /// When the set before it was done: the rope's full length runs from there to the end.
    let start: Date?
    let label: String
    let more: () -> Void
    let skip: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.muted)
            // The buttons go under the clock when the text is too large for one line.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    clock
                    Spacer(minLength: 4)
                    buttons
                }
                VStack(alignment: .leading, spacing: 8) {
                    clock
                    HStack(spacing: 8) { buttons }
                }
            }
            TimelineView(.periodic(from: .now, by: 1)) { context in
                let total = max(1, end.timeIntervalSince(start ?? context.date))
                ProgressView(value: min(total, max(0, end.timeIntervalSince(context.date))), total: total)
                    .progressViewStyle(RopeLine(reduceMotion: reduceMotion))
            }
            .padding(.top, 4)
            .accessibilityHidden(true)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
    }

    private var clock: some View {
        Text(timerInterval: Date.now ... end, countsDown: true)
            .font(.title.weight(.semibold))
            .monospacedDigit()
            .foregroundStyle(.ink)
            .accessibilityIdentifier("rest-clock")
    }

    private var buttons: some View {
        Group {
            Button(action: more) {
                Text("+30\u{202F}s")
                    .monospacedDigit()
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityIdentifier("rest-more")
            Button(action: skip) {
                Text("Passer")
                    .frame(minWidth: 44, minHeight: 44)
            }
            .accessibilityIdentifier("rest-skip")
        }
        .font(.subheadline.weight(.semibold))
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(.muted)
        .foregroundStyle(.ink)
        .fixedSize()
    }
}

// MARK: - Text

/// How a set and its exercise read on the cover, on screen and to VoiceOver.
enum SetText {
    /// « 62,5 », in the person's language.
    static func kg(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }

    /// A load typed with a comma or a point.
    static func parseKg(_ text: String) -> Double? {
        Double(text.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: "."))
    }

    /// « 4 × 6–8 · RIR 1–2 », or « 3 × 30–45 s » for a timed exercise.
    static func prescription(_ exercise: CoverExercise) -> String {
        if exercise.timed { return target(exercise) }
        let rir = exercise.rirTarget.map(String.init).joined(separator: "–")
        return "\(target(exercise)) · RIR \(rir)"
    }

    /// « 3 × 8–10 », or « 3 × 30–45 s » for a timed exercise.
    static func target(_ exercise: CoverExercise) -> String {
        let range = exercise.repRange.map(String.init).joined(separator: "–")
        return "\(exercise.sets.count) × \(range)\(exercise.timed ? "\u{202F}s" : "")"
    }

    /// A folded exercise in one line: « 4 séries notées », « 2 séries sur 4 », « 3 × 8–10 · à venir ».
    static func status(_ exercise: CoverExercise) -> String {
        let done = exercise.sets.filter(\.done).count
        if done == exercise.sets.count { return String(localized: "\(done) séries notées") }
        if done > 0 { return String(localized: "\(done) séries sur \(exercise.sets.count)") }
        return String(localized: "\(target(exercise)) · à venir")
    }

    /// « 62,5 kg × 8, 8, 7, 6 », the groups of equal loads one after the other.
    static func lastTime(_ exercise: CoverExercise) -> String {
        exercise.lastTime.map { group in
            load(group.weightKg, group.counts.map(String.init).joined(separator: ", "), timed: exercise.timed)
        }.joined(separator: " · ")
    }

    /// « 60 kg × 8 », or « 30 s » for a hold with no added load.
    static func load(_ weightKg: Double, _ counts: some StringProtocol, timed: Bool) -> String {
        if timed && weightKg == 0 { return "\(counts)\u{202F}s" }
        return "\(kg(weightKg))\u{202F}kg × \(counts)\(timed ? "\u{202F}s" : "")"
    }

    static func load(_ weightKg: Double, _ count: Int, timed: Bool) -> String {
        load(weightKg, String(count), timed: timed)
    }

    /// « Barbell bench press, série 1 sur 4, 62,5 kg, 8 répétitions, faite ».
    static func spoken(_ exercise: CoverExercise, _ set: CoverSet, weightKg: Double? = nil, count: Int? = nil)
        -> String
    {
        let load = (weightKg ?? set.weightKg).map { String(localized: "\(kg($0)) kg") }
            ?? String(localized: "charge à indiquer")
        let number = count ?? set.count
        let counted = number.map {
            exercise.timed ? String(localized: "\($0) secondes") : String(localized: "\($0) répétitions")
        } ?? String(localized: "nombre à indiquer")
        let state = set.done ? String(localized: "faite") : String(localized: "à faire")
        return String(
            localized: "\(exercise.name), série \(set.number) sur \(exercise.sets.count), \(load), \(counted), \(state)")
    }
}
