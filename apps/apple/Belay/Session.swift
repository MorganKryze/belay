import BelayCore
import os
import SwiftUI

/// The open session, full screen: its exercises and work sets, the next one under the thumb; once
/// finished, its summary.
struct SessionCover: View {
    let training: TrainingModel
    let lower: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var askFinish = false
    @State private var finishFailed = false

    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "session")

    var body: some View {
        NavigationStack {
            Group {
                if let summary = training.summary {
                    SummaryView(summary: summary) {
                        training.closeSummary()
                        lower()
                    }
                } else if let cover = training.cover {
                    SessionList(training: training, cover: cover, lower: lower, askFinish: $askFinish)
                }
            }
            .animation(reduceMotion ? nil : .smooth, value: training.summary == nil)
        }
        // On the cover, which stays while the list under the dialog turns into the summary.
        .confirmationDialog("Terminer la séance\u{202F}?", isPresented: $askFinish, titleVisibility: .visible) {
            Button("Terminer et enregistrer", action: finish)
            Button("Continuer la séance", role: .cancel) {}
        } message: {
            Text(finishMessage)
        }
        .alert("La séance n’a pas été terminée. Réessaie.", isPresented: $finishFailed) {
            Button("OK", role: .cancel) {}
        }
    }

    private func finish() {
        do {
            try training.finish()
        } catch {
            Self.log.error("session not ended: \(String(describing: error), privacy: .public)")
            finishFailed = true
        }
    }

    private var finishMessage: String {
        guard let cover = training.cover else { return "" }
        let count = String(localized: "Séries notées\u{202F}: \(cover.setsDone) sur \(cover.setsPlanned).")
        guard cover.setsDone < cover.setsPlanned else { return count }
        return "\(count) \(String(localized: "Celles non cochées ne seront pas enregistrées."))"
    }
}

/// What the person typed into the next set, as text until it is ticked.
private struct Draft: Equatable {
    var kg: String
    var count: String
}

private struct SessionList: View {
    let training: TrainingModel
    let cover: CoverState
    let lower: () -> Void
    @Environment(\.dynamicTypeSize) private var type
    @Environment(\.scenePhase) private var scenePhase
    @State private var drafts: [String: Draft] = [:]
    /// The next set ticked, waiting for its RIR.
    @State private var armed: String?
    @State private var rir = 0
    /// Counts the sets this screen recorded: one haptic each, once the write returned.
    @State private var recorded = 0
    @Binding var askFinish: Bool
    @State private var failed: LocalizedStringKey?
    /// The time the rest row was last checked against; moved when the rest ends or the app returns.
    @State private var clock = Date.now
    @FocusState private var typing: Bool

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

    var body: some View {
        List {
            ForEach(cover.exercises) { exercise in
                Section {
                    header(exercise)
                        .listRowBackground(Color.surface)
                    ForEach(exercise.sets) { set in
                        row(exercise, set)
                    }
                }
            }
        }
        // Rows packed with figures stay legible under the toolbar: the hard edge holds them back.
        .belayList(edge: .hard)
        .environment(\.defaultMinListRowHeight, 44)
        .navigationTitle(SessionText.short(cover.code))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .safeAreaBar(edge: .bottom) { foot }
        .scrollEdgeEffectStyle(.hard, for: .bottom)
        .sensoryFeedback(.success, trigger: recorded)
        .task(id: training.restEnd) { await followRest() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { clock = .now }
        }
        .alert(failed ?? "", isPresented: Binding(get: { failed != nil }, set: { if !$0 { failed = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    /// The rest row stays while its end is ahead; the clock itself is the system's.
    private func followRest() async {
        clock = .now
        guard let end = training.restEnd, end > clock else { return }
        try? await Task.sleep(for: .seconds(end.timeIntervalSince(clock)))
        clock = .now
    }

    // MARK: Rows

    private func header(_ exercise: CoverExercise) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(exercise.name)
                .font(.headline)
                .foregroundStyle(.ink)
            Text(SetText.prescription(exercise))
                .font(.subheadline)
                .foregroundStyle(.muted)
                .monospacedDigit()
            if !exercise.lastTime.isEmpty {
                Text("la dernière fois \(SetText.lastTime(exercise))")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .monospacedDigit()
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private func row(_ exercise: CoverExercise, _ set: CoverSet) -> some View {
        let isNext = nextSet?.set.id == set.id
        if isNext {
            NextSetRow(
                exercise: exercise, set: set, draft: draft(set), typing: $typing,
                tick: { tick(exercise, set) }
            )
            .listRowBackground(Color.surface)
            .listRowSeparator(.hidden, edges: .bottom)
            if armed == set.id {
                RIRRow(rir: $rir, confirm: { record(exercise, set, rir: rir) })
                    .listRowBackground(Color.surface)
            }
            if let resting {
                RestRow(end: resting, label: restLabel(after: exercise, set))
                    .listRowBackground(Color.surface)
            }
        } else {
            PlainSetRow(exercise: exercise, set: set)
                .listRowBackground(set.done ? Color.sunk : Color.surface)
        }
    }

    private func draft(_ set: CoverSet) -> Binding<Draft> {
        Binding(
            get: { drafts[set.id] ?? Draft(kg: set.weightKg.map(SetText.kg) ?? "", count: set.count.map(String.init) ?? "") },
            set: { drafts[set.id] = $0 })
    }

    /// « Repos · série 2 ensuite », or the next exercise's name when the set up next is another's.
    private func restLabel(after exercise: CoverExercise, _ set: CoverSet) -> String {
        guard let next = nextSet else { return String(localized: "Repos") }
        if next.exercise.slotIndex == exercise.slotIndex {
            return String(localized: "Repos · série \(next.set.number) ensuite")
        }
        return String(localized: "Repos · \(next.exercise.name) ensuite")
    }

    // MARK: Tick

    /// A set in repetitions asks for its RIR before it is recorded; a timed set has none.
    private func tick(_ exercise: CoverExercise, _ set: CoverSet) {
        typing = false
        if exercise.timed { return record(exercise, set, rir: nil) }
        if armed == set.id { return record(exercise, set, rir: rir) }
        rir = exercise.rirTarget.first ?? 0
        armed = set.id
    }

    private func record(_ exercise: CoverExercise, _ set: CoverSet, rir: Int?) {
        let typed = draft(set).wrappedValue
        guard let kg = SetText.parseKg(typed.kg), let count = Int(typed.count) else {
            failed = "Indique la charge et le nombre avant de valider."
            return
        }
        do {
            try training.tick(slotIndex: set.slotIndex, position: set.position, weightKg: kg, count: count, rir: rir)
        } catch {
            Self.log.error("set not recorded: \(String(describing: error), privacy: .public)")
            failed = "La série n’a pas été notée. Vérifie la charge et le nombre, puis réessaie."
            return
        }
        // Only now, with the set stored: the row turns done and the hand feels it once.
        armed = nil
        drafts[set.id] = nil
        recorded += 1
        AccessibilityNotification.Announcement(String(localized: "Série notée.")).post()
    }

    // MARK: Bars

    /// One thumb, wet hands: the next set is validated from the foot of the screen too.
    @ViewBuilder private var foot: some View {
        FootBar {
            if let next = nextSet {
                let title: LocalizedStringKey =
                    armed == next.set.id ? "Noter la série \(next.set.number)" : "Valider la série \(next.set.number)"
                PrimaryButton(title: title, place: .foot) { tick(next.exercise, next.set) }
                    .accessibilityIdentifier("foot")
            } else {
                PrimaryButton(title: "Terminer la séance", place: .foot) { askFinish = true }
                    .accessibilityIdentifier("foot")
            }
        }
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
            Button("Terminer") { askFinish = true }
        }
        ToolbarItemGroup(placement: .keyboard) {
            Spacer()
            Button("OK") { typing = false }
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

/// A set done, or one to come after the next: read only, one element for VoiceOver.
private struct PlainSetRow: View {
    let exercise: CoverExercise
    let set: CoverSet

    var body: some View {
        SetColumns {
            Text("\(set.number)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(set.done ? .ink : .muted)
        } kg: {
            Text(set.weightKg.map(SetText.kg) ?? "–")
        } count: {
            Text(set.count.map(String.init) ?? "–")
        } tick: {
            Image(systemName: set.done ? "checkmark.circle.fill" : "circle")
                .font(.title2)
                .foregroundStyle(set.done ? .ink : .muted)
                .frame(width: 44, height: 44)
        }
        .font(.body.weight(set.done ? .semibold : .regular))
        .foregroundStyle(set.done ? .ink : .muted)
        .monospacedDigit()
        .listRowInsets(.init(top: 0, leading: 16, bottom: 0, trailing: 12))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(SetText.spoken(exercise, set))
        .accessibilityIdentifier("set-\(set.id)")
    }
}

/// The set under load: the one row in the display face, a row and a half tall.
private struct NextSetRow: View {
    let exercise: CoverExercise
    let set: CoverSet
    @Binding var draft: Draft
    var typing: FocusState<Bool>.Binding
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
                cell($draft.kg, unit: "kg", keyboard: .decimalPad, id: "load-kg",
                     label: "Charge de la série \(set.number), kg")
                cell($draft.count, unit: exercise.timed ? "s" : "reps", keyboard: .numberPad, id: "load-count",
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
        _ text: Binding<String>, unit: LocalizedStringKey, keyboard: UIKeyboardType, id: String,
        label: LocalizedStringKey
    ) -> some View {
        VStack(spacing: 0) {
            TextField(label, text: text)
                .labelsHidden()
                .keyboardType(keyboard)
                .multilineTextAlignment(.center)
                .font(.displayLoad)
                .monospacedDigit()
                .foregroundStyle(.ink)
                .focused(typing)
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
    }
}

/// Five segments, one word each, then the button that records the set with the RIR chosen.
private struct RIRRow: View {
    @Binding var rir: Int
    let confirm: () -> Void
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
    }

    private var button: some View {
        Button(action: confirm) {
            Text("Noter")
                .font(.subheadline.weight(.semibold))
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .buttonBorderShape(.capsule)
        .tint(.muted)
        .foregroundStyle(.ink)
        .accessibilityLabel("Noter la série avec ce RIR")
        .accessibilityIdentifier("rir-confirm")
    }

    var body: some View {
        Group {
            if type.isAccessibilitySize {
                // The label moves above, so every segment keeps its 44 points.
                VStack(alignment: .leading, spacing: 8) {
                    label
                    picker
                    button
                }
            } else {
                HStack(spacing: 8) {
                    label.frame(width: labelWidth, alignment: .leading)
                    picker
                    button.fixedSize()
                }
            }
        }
        .listRowInsets(.init(top: 0, leading: 16, bottom: 10, trailing: 12))
    }
}

/// The rest is a row of the table, under the next set: quiet, in system type at title size. It
/// counts to an absolute end, so a locked phone or a closed app finds it where it should be.
private struct RestRow: View {
    let end: Date
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.muted)
            Text(timerInterval: Date.now ... end, countsDown: true)
                .font(.title.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.ink)
                .accessibilityIdentifier("rest-clock")
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
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
        let range = exercise.repRange.map(String.init).joined(separator: "–")
        let sets = "\(exercise.sets.count) × \(range)"
        if exercise.timed { return "\(sets)\u{202F}s" }
        let rir = exercise.rirTarget.map(String.init).joined(separator: "–")
        return "\(sets) · RIR \(rir)"
    }

    /// « 62,5 kg × 8, 8, 7, 6 », the groups of equal loads one after the other.
    static func lastTime(_ exercise: CoverExercise) -> String {
        exercise.lastTime.map { group in
            let counts = group.counts.map(String.init).joined(separator: ", ")
            return exercise.timed && group.weightKg == 0
                ? "\(counts)\u{202F}s" : "\(kg(group.weightKg))\u{202F}kg × \(counts)\(exercise.timed ? "\u{202F}s" : "")"
        }.joined(separator: " · ")
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
