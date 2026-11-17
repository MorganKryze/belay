import BelayCore
import SwiftUI

/// Profil, from Réglages' profile cell: the facts the tools start from, each optional, with the
/// tools it serves. An empty fact offers « Renseigner », a swipe on a set one « Effacer », which
/// writes it empty. Then the loss range, on − and +, by the contract's step and within its bounds.
struct ProfileView: View {
    let corps: CorpsModel
    /// Facts the person has asked to fill, shown with their control before they hold a value.
    @State private var filling: Set<ProfileFact> = []
    @State private var height = ""
    @State private var low = defaultTarget.minPct
    @State private var high = defaultTarget.maxPct
    @FocusState private var typingHeight: Bool

    private var profile: ProfileRow? { corps.profile }

    var body: some View {
        List {
            Section {
                fact(.formula, "Formule", uses: "Sert à\u{202F}: Dépense énergétique, Masse grasse") {
                    Picker(selection: Binding(get: { profile?.formula }, set: { if let formula = $0 { corps.setFormula(formula) } })) {
                        Text("Femme", tableName: "Reglages").tag(ProfileFormula?.some(.female))
                        Text("Homme", tableName: "Reglages").tag(ProfileFormula?.some(.male))
                    } label: {
                        Text("Formule", tableName: "Reglages")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                    .fixedSize()
                    .accessibilityIdentifier("profile-formula")
                }
                fact(.birthYear, "Année de naissance", uses: "Sert à\u{202F}: Dépense énergétique") { yearMenu }
                fact(.height, "Taille", uses: "Sert à\u{202F}: IMC, Masse grasse, Dépense énergétique") { heightField }
            } header: {
                Text("Ton corps", tableName: "Reglages").textCase(nil).foregroundStyle(.ink)
            } footer: {
                Text("Tout est facultatif. Chaque information ne sert qu’aux outils indiqués.", tableName: "Reglages")
                    .foregroundStyle(.muted)
            }
            .headerProminence(.increased)
            .listRowBackground(Color.surface)
            rangeSection
        }
        .belayList()
        .navigationTitle(Text("Profil", tableName: "Reglages"))
        .largeTitleOnly()
        .onAppear {
            height = profile?.heightCm.map(String.init) ?? ""
            (low, high) = (corps.range.minPct, corps.range.maxPct)
        }
        .onChange(of: typingHeight) { _, typing in if !typing { saveHeight() } }
        // A run of taps writes once, the value after the last one; leaving writes at once.
        .task(id: TargetRange(minPct: low, maxPct: high)) {
            try? await Task.sleep(for: .milliseconds(700))
            if !Task.isCancelled { saveRange() }
        }
        .onDisappear(perform: saveRange)
    }

    private func isSet(_ fact: ProfileFact) -> Bool {
        switch fact {
        case .formula: profile?.formula != nil
        case .birthYear: profile?.birthYear != nil
        case .height: profile?.heightCm != nil
        }
    }

    /// The years the tools take, newest first.
    private var years: [Int] { birthYearRange(today: corps.today).reversed() }

    private var yearMenu: some View {
        Menu {
            Picker(selection: Binding(get: { profile?.birthYear }, set: { if let year = $0 { corps.setBirthYear(year) } })) {
                ForEach(years, id: \.self) { Text(verbatim: String($0)).tag(Int?.some($0)) }
            } label: {
                Text("Année de naissance", tableName: "Reglages")
            }
        } label: {
            HStack(spacing: 4) {
                Text(verbatim: profile?.birthYear.map(String.init) ?? "—")
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.muted)
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .accessibilityLabel(
            Text(
                verbatim:
                    "\(String(localized: "Année de naissance", table: "Reglages")), \(profile?.birthYear.map(String.init) ?? "—")"
            )
        )
        .accessibilityIdentifier("profile-birth-year")
    }

    private var heightField: some View {
        HStack(spacing: 6) {
            TextField(text: $height, prompt: Text(verbatim: "175")) { Text("Taille", tableName: "Reglages") }
                .keyboardType(.numberPad)
                .multilineTextAlignment(.trailing)
                .font(.title3.weight(.semibold))
                .monospacedDigit()
                .foregroundStyle(.ink)
                .focused($typingHeight)
                .frame(width: 72)
                .accessibilityIdentifier("profile-height")
            Text("cm", tableName: "Reglages").foregroundStyle(.muted).accessibilityHidden(true)
        }
    }

    /// Whole centimetres within the tools' range; anything else goes back to the stored value.
    private func saveHeight() {
        if let cm = Int(height.trimmingCharacters(in: .whitespaces)), isProfileHeight(cm) {
            corps.setHeight(cm)
        } else {
            height = profile?.heightCm.map(String.init) ?? ""
        }
        if profile?.heightCm != nil { filling.remove(.height) }
    }

    private func saveRange() {
        corps.setRange(TargetRange(minPct: low, maxPct: high))
    }

    /// A fact's row: its name and its control, or « Renseigner » while empty, and the tools it
    /// serves under them.
    private func fact<Control: View>(
        _ fact: ProfileFact, _ title: LocalizedStringKey, uses: LocalizedStringKey,
        @ViewBuilder control: () -> Control
    ) -> some View {
        let set = isSet(fact)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 10) {
                Text(title, tableName: "Reglages").foregroundStyle(.ink).layoutPriority(1)
                Spacer(minLength: 8)
                if set || filling.contains(fact) {
                    control()
                } else {
                    fill(fact)
                }
            }
            Text(uses, tableName: "Reglages")
                .font(.footnote)
                .foregroundStyle(.muted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .frame(minHeight: 56)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("profile-fact-\(fact.rawValue)")
        .swipeActions(edge: .trailing) {
            if set {
                Button(role: .destructive) {
                    filling.remove(fact)
                    if fact == .height { height = "" }
                    corps.clearProfile(fact)
                } label: {
                    Label { Text("Effacer", tableName: "Reglages") } icon: { Image(systemName: "xmark") }
                }
            }
        }
    }

    private func fill(_ fact: ProfileFact) -> some View {
        Button {
            filling.insert(fact)
            if fact == .height { typingHeight = true }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "plus").fontWeight(.bold).accessibilityHidden(true)
                Text("Renseigner", tableName: "Reglages")
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.ink)
            .padding(.horizontal, 14)
            .frame(minHeight: 44)
            .background(Color.track, in: .capsule)
        }
        .buttonStyle(.plain)
        .fixedSize()
        .accessibilityLabel(fillLabel(fact))
    }

    private func fillLabel(_ fact: ProfileFact) -> Text {
        switch fact {
        case .formula: Text("Renseigner formule", tableName: "Reglages")
        case .birthYear: Text("Renseigner année de naissance", tableName: "Reglages")
        case .height: Text("Renseigner taille", tableName: "Reglages")
        }
    }

    // MARK: The range

    /// The step and the bounds are the contract's; the lower stays at least the gap under the
    /// upper, so no tap can make a range the server refuses.
    private var rangeSection: some View {
        let bounds = Bounds.target
        return Section {
            rangeRow("Au moins", value: $low, range: bounds.min...gapped(high, -Bounds.targetGap), id: "range-min")
            rangeRow("Au plus", value: $high, range: gapped(low, Bounds.targetGap)...bounds.max, id: "range-max")
            NavigationLink(value: Route.science(id: "target-rate")) {
                Text("Comment c’est choisi", tableName: "Reglages").foregroundStyle(.ink).frame(minHeight: 44)
            }
        } header: {
            VStack(alignment: .leading, spacing: 4) {
                Text("Ta fourchette de perte", tableName: "Reglages").foregroundStyle(.ink)
                Text(
                    "Par semaine, en\u{202F}% de ton poids moyen. Sert à dire «\u{202F}dans ta fourchette\u{202F}» sur Corps.",
                    tableName: "Reglages"
                )
                .font(.subheadline)
                .foregroundStyle(.muted)
            }
            .textCase(nil)
        } footer: {
            Text(
                "Réglable de 0,25 à 1\u{202F}%. Les recommandations publiées s’arrêtent à 1\u{202F}%\u{202F}: l’app ne propose pas plus.",
                tableName: "Reglages"
            )
            .foregroundStyle(.muted)
        }
        .headerProminence(.increased)
        .listRowBackground(Color.surface)
    }

    /// `value` moved by `by`, kept on the step's grid so a bound compares exactly.
    private func gapped(_ value: Double, _ by: Double) -> Double {
        ((value + by) * 1e6).rounded() / 1e6
    }

    private func rangeRow(
        _ title: LocalizedStringKey, value: Binding<Double>, range: ClosedRange<Double>, id: String
    ) -> some View {
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title, tableName: "Reglages").foregroundStyle(.ink)
                Text(verbatim: BodyText.percent(value.wrappedValue.upToHundredths))
                    .font(.title3.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.ink)
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(id)
            Spacer(minLength: 8)
            Nudge(
                value: value, range: range, step: Bounds.target.step,
                what: BodyText.percent(Bounds.target.step.upToHundredths), id: id)
        }
        .frame(minHeight: 52)
    }
}
