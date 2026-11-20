import BelayCore
import SwiftUI

/// Activité: Cardio | Escalade | Pas in place of the title, opening on the kind last chosen on this
/// phone, the date first. Cardio and Escalade write one activity at ✓; the day's activities of the
/// kind are listed above the fields, and one picked opens with its deletion, asked first. Pas reads
/// the day's steps from Santé, with nothing to type (A39, A40); it shows only while the steps
/// import is off, since « Pas » on Accueil carries them once it is on. Opened from the history, it
/// starts on that activity's day and kind with the activity picked.
struct ActivitySheet: View {
    let corps: CorpsModel
    @State private var kind: DevicePrefs.ActivityKind
    @State private var date: Date
    /// The day's activity picked from the list; nil writes a new one.
    @State private var picked: String?
    @State private var minutes = 45.0
    @State private var cardioType = "run"
    @State private var style: String?
    @State private var runs = ""
    @State private var byColour = false
    @State private var grade: String?
    @State private var colour: String?
    @State private var importing = false
    @State private var importRefused = false
    /// Read once at opening: an import turned on from Pas keeps the segment until the sheet closes,
    /// so the steps it brings show where it was asked.
    private let offersSteps: Bool

    /// `day` and `picked` open on an activity kept: its day, its kind, its fields and its deletion.
    init(corps: CorpsModel, day: String? = nil, picked: String? = nil) {
        self.corps = corps
        offersSteps = !corps.stepsOn
        let last = DevicePrefs.activityKind.value
        let own = day.flatMap { day in
            [DevicePrefs.ActivityKind.climbing, .cardio].first { kind in
                corps.activities(on: day, kind: kind.rawValue).contains { $0.id == picked }
            }
        }
        _kind = State(initialValue: own ?? (last == .steps && corps.stepsOn ? DevicePrefs.activityKind.initial : last))
        _date = State(initialValue: day.flatMap(BodyText.date) ?? corps.now())
        _picked = State(initialValue: own == nil ? nil : picked)
    }

    private var day: String { toISODate(date, timeZone: corps.timeZone) }

    /// `cardio` or `climbing`, the contract's word; nil on Pas.
    private var type: String? { kind == .steps ? nil : kind.rawValue }

    private var own: [ActivityRow] { type.map { corps.activities(on: day, kind: $0) } ?? [] }

    /// What ✓ writes; nil while the entry is not whole.
    private var fields: ActivityFields? {
        switch kind {
        case .steps: return nil
        case .cardio: return ActivityFields(type: "cardio", durationMin: Int(minutes), cardioType: cardioType)
        case .climbing:
            let typed = runs.trimmingCharacters(in: .whitespaces)
            let count = typed.isEmpty ? nil : Int(typed)
            if !typed.isEmpty, count.map(isClimbRuns) != true { return nil }
            return ActivityFields(
                type: "climbing", durationMin: Int(minutes), climbStyle: style, climbRuns: count,
                climbGrade: byColour ? nil : grade, climbColor: byColour ? colour : nil)
        }
    }

    var body: some View {
        EntrySheet(
            title: Text("Activité", tableName: "Activity"), symbol: "figure.walk", domain: .activity, date: $date,
            latest: corps.now(), canSave: fields.map(isActivityFields) == true, id: "activity",
            save: { if let fields { corps.logActivity(id: picked, date: day, fields) } },
            deletion: picked.map { id in
                (Text("Supprimer l’activité", tableName: "Activity"), { corps.removeActivity(id: id) })
            },
            heading: AnyView(kinds),
            dateLabel: kind == .steps
                ? Text("Jour", tableName: "Activity") : Text("Date de l’activité", tableName: "Activity")
        ) {
            switch kind {
            case .cardio:
                dayList
                cardioFields
            case .climbing:
                dayList
                climbingFields
            case .steps:
                stepsSegment
            }
        }
        .onChange(of: kind) { _, kind in
            DevicePrefs.activityKind.value = kind
            start(from: nil)
        }
        .onChange(of: day) { start(from: nil) }
        .onAppear { start(from: picked) }
    }

    private var kinds: some View {
        Picker(String(localized: "Type d’activité", table: "Activity"), selection: $kind) {
            Text("Cardio", tableName: "Activity").tag(DevicePrefs.ActivityKind.cardio)
            Text("Escalade", tableName: "Activity").tag(DevicePrefs.ActivityKind.climbing)
            if offersSteps { Text("Pas", tableName: "Activity").tag(DevicePrefs.ActivityKind.steps) }
        }
        .pickerStyle(.segmented)
        .frame(minWidth: 250)
        .sensoryFeedback(.selection, trigger: kind)
        .accessibilityIdentifier("activity-kind")
    }

    /// The fields from the activity picked, else from the last of the kind, as the web starts a
    /// new one: the same climb again is one tap.
    private func start(from id: String?) {
        picked = id
        let from = id.flatMap { id in own.first { $0.id == id } } ?? type.flatMap { corps.lastActivity(kind: $0, upTo: day) }
        minutes = Double(from?.durationMin ?? (kind == .climbing ? 90 : 45))
        cardioType = from?.cardioType ?? "run"
        style = from?.climbStyle
        runs = from?.climbRuns.map(String.init) ?? ""
        byColour = from?.climbColor != nil
        grade = from?.climbGrade
        colour = from?.climbColor
    }

    // MARK: The day's activities

    @ViewBuilder private var dayList: some View {
        if !own.isEmpty {
            Section {
                ForEach(Array(own.enumerated()), id: \.element.id) { index, activity in
                    choice(ActivityText.activity(activity), selected: picked == activity.id, id: "activity-day-\(index)") {
                        start(from: activity.id)
                    }
                }
                choice(
                    kind == .cardio
                        ? String(localized: "Un autre cardio", table: "Activity")
                        : String(localized: "Une autre escalade", table: "Activity"),
                    selected: picked == nil, id: "activity-new"
                ) {
                    start(from: nil)
                }
            } header: {
                Text("Ce jour", tableName: "Activity")
            }
            .listRowBackground(Color.surface)
        }
    }

    private func choice(_ label: String, selected: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Text(label).foregroundStyle(.ink).monospacedDigit()
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark").font(.body.weight(.semibold)).foregroundStyle(.ink)
                        .accessibilityHidden(true)
                }
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(id)
    }

    // MARK: Cardio and Escalade

    /// « Durée » over its value, bold, as a count reads; − and + on the right.
    private var duration: some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text("Durée", tableName: "Activity").foregroundStyle(.ink)
                Text(ActivityText.minutes(Int(minutes)))
                    .font(.title3.weight(.semibold)).foregroundStyle(.ink).monospacedDigit()
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 8)
            Nudge(value: $minutes, range: 5...480, step: 5, what: "5 minutes", id: "activity-duration")
        }
        .frame(minHeight: 52)
        .accessibilityElement(children: .contain)
    }

    /// A segment's row: its name, and a muted hint under it, on the left; the segment on the right.
    private func segmentRow(_ title: LocalizedStringKey, hint: LocalizedStringKey? = nil, picker: some View) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title, tableName: "Activity").foregroundStyle(.ink)
                if let hint { Text(hint, tableName: "Activity").font(.footnote).foregroundStyle(.muted) }
            }
            Spacer(minLength: 8)
            picker.labelsHidden().frame(maxWidth: 190)
        }
        .frame(minHeight: 52)
    }

    private var cardioFields: some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text("Type", tableName: "Activity").foregroundStyle(.ink)
                ChipFlow {
                    ForEach(Bounds.cardioTypes, id: \.self) { t in
                        chip(ActivityText.cardio(t), selected: cardioType == t, id: "cardio-\(t)") { cardioType = t }
                    }
                }
            }
            .padding(.vertical, 6)
            duration
        }
        .listRowBackground(Color.surface)
    }

    /// Type, Durée, Voies ou blocs; then « Le plus dur », by grade or by colour, all optional.
    @ViewBuilder private var climbingFields: some View {
        Section {
            segmentRow(
                "Type",
                picker: Picker(selection: $style) {
                    Text("Bloc", tableName: "Activity").tag(String?.some("boulder"))
                    Text("Voie", tableName: "Activity").tag(String?.some("route"))
                } label: {
                    Text("Type", tableName: "Activity")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("climb-style"))
            duration
            HStack {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Voies ou blocs", tableName: "Activity").foregroundStyle(.ink)
                    Text("facultatif", tableName: "Activity").font(.footnote).foregroundStyle(.muted)
                }
                TextField(String(localized: "Voies ou blocs", table: "Activity"), text: $runs, prompt: Text(verbatim: "12"))
                    .font(.title3.weight(.semibold))
                    .keyboardType(.numberPad)
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .accessibilityIdentifier("climb-runs")
            }
            .frame(minHeight: 52)
        } footer: {
            if fields == nil {
                Text("Saisis un nombre entier entre 0 et 200.", tableName: "Activity").foregroundStyle(.muted)
            }
        }
        .listRowBackground(Color.surface)
        Section {
            segmentRow(
                "Le plus dur", hint: "facultatif",
                picker: Picker(selection: $byColour) {
                    Text("Cotation", tableName: "Activity").tag(false)
                    Text("Couleur", tableName: "Activity").tag(true)
                } label: {
                    Text("Le plus dur", tableName: "Activity")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("climb-by"))
            if byColour {
                ChipFlow {
                    ForEach(Bounds.climbColors, id: \.self) { c in
                        chip(ActivityText.colour(c), selected: colour == c, id: "colour-\(c)") {
                            colour = colour == c ? nil : c
                        }
                    }
                }
                .padding(.vertical, 6)
            } else {
                Picker(selection: $grade) {
                    Text("Aucune", tableName: "Activity").tag(String?.none)
                    ForEach(Bounds.climbGrades, id: \.self) { Text(verbatim: $0).tag(String?.some($0)) }
                } label: {
                    Text("Cotation", tableName: "Activity")
                }
                .pickerStyle(.menu)
                .frame(minHeight: 44)
                .accessibilityIdentifier("climb-grade")
            }
        }
        .listRowBackground(Color.surface)
    }

    /// A chip: filled while chosen, named in words.
    private func chip(_ text: String, selected: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if selected {
                    Image(systemName: "checkmark").font(.caption.weight(.bold)).accessibilityHidden(true)
                }
                Text(text)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(selected ? Color.surface : Color.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(selected ? Color.ink : Color.track, in: .capsule)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(id)
    }

    // MARK: Pas

    @ViewBuilder private var stepsSegment: some View {
        Section {
            if !corps.stepsOn {
                Text("Les pas viennent de Santé.", tableName: "Activity").foregroundStyle(.ink)
                    .frame(minHeight: 44, alignment: .leading)
                Button {
                    Task {
                        importing = true
                        importRefused = !(await corps.importSteps())
                        importing = false
                    }
                } label: {
                    Text("Importer les pas de Santé", tableName: "Activity").frame(minHeight: 44)
                }
                .disabled(importing)
                .accessibilityIdentifier("steps-import")
            } else if let steps = corps.steps(on: day) {
                HStack(alignment: .firstTextBaseline) {
                    Text(ActivityText.steps(steps.value))
                        .font(.title2.weight(.semibold)).foregroundStyle(.ink).monospacedDigit()
                    Spacer(minLength: 8)
                    if steps.fromHealth {
                        Text("depuis Santé", tableName: "Activity").font(.subheadline).foregroundStyle(.muted)
                    }
                }
                .frame(minHeight: 52)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("steps-value")
            } else {
                Text("Aucun pas dans Santé pour ce jour.", tableName: "Activity").foregroundStyle(.muted)
                    .frame(minHeight: 44, alignment: .leading)
            }
        } footer: {
            if importRefused, !corps.stepsOn {
                Text(
                    "Pour importer tes pas, Belay a besoin de l’accès à Santé. Autorise-le dans l’app Santé, puis réessaie.",
                    tableName: "Health"
                )
                .foregroundStyle(.muted)
            }
        }
        .listRowBackground(Color.surface)
    }
}

/// An activity and a day's activity in words, as the web writes them: « Escalade · 1 h 30 · 6b+ »,
/// « Vélo · 45 min », « 8 437 pas », « 2 activités ».
enum ActivityText {
    static func summary(_ summary: DaySummary) -> String {
        switch summary {
        case .none: String(localized: "pas encore saisie", table: "Activity")
        case .steps(let n): steps(n)
        case .activity(let a): activity(a)
        case .many(let n): String(localized: "\(n) activités", table: "Activity")
        }
    }

    static func activity(_ a: ActivityRow) -> String {
        if a.kind == "cardio" { return "\(cardio(a.cardioType ?? "other")) · \(minutes(a.durationMin))" }
        let hardest = a.climbGrade ?? a.climbColor.map(colour)
        return ([String(localized: "Escalade", table: "Activity"), minutes(a.durationMin)] + [hardest].compactMap(\.self))
            .joined(separator: " · ")
    }

    /// « 45 min », « 1 h », « 1 h 30 ».
    static func minutes(_ m: Int) -> String {
        if m < 60 { return String(localized: "\(m)\u{202F}min", table: "Activity") }
        let rest = m % 60
        if rest == 0 { return String(localized: "\(m / 60)\u{202F}h", table: "Activity") }
        let mm = rest < 10 ? "0\(rest)" : "\(rest)"
        return String(localized: "\(m / 60)\u{202F}h\u{202F}\(mm)", table: "Activity")
    }

    static func steps(_ n: Int) -> String {
        String(localized: "\(BodyText.whole(n))\u{202F}pas", table: "Activity")
    }

    static func cardio(_ type: String) -> String {
        switch type {
        case "run": String(localized: "Course", table: "Activity")
        case "bike": String(localized: "Vélo", table: "Activity")
        case "row": String(localized: "Rameur", table: "Activity")
        case "walk": String(localized: "Marche", table: "Activity")
        case "swim": String(localized: "Natation", table: "Activity")
        default: String(localized: "Autre", table: "Activity")
        }
    }

    static func colour(_ name: String) -> String {
        switch name {
        case "yellow": String(localized: "jaune", table: "Activity")
        case "green": String(localized: "vert", table: "Activity")
        case "blue": String(localized: "bleu", table: "Activity")
        case "red": String(localized: "rouge", table: "Activity")
        case "black": String(localized: "noir", table: "Activity")
        case "purple": String(localized: "violet", table: "Activity")
        case "white": String(localized: "blanc", table: "Activity")
        default: name
        }
    }
}
