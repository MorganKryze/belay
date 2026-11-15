import BelayCore
import SwiftUI

/// Apports: today's calories and protein against what the tools give (CO29), then the days
/// before. The calories compare to the day's expenditure, named as such, never as a target (D1).
struct IntakeView: View {
    let corps: CorpsModel
    @State private var adding = false

    var body: some View {
        let state = corps.intake
        List {
            Section {
                VStack(alignment: .leading, spacing: 16) {
                    DomainChip(domain: .intake, text: String(localized: "Aujourd’hui", table: "Entries"), symbol: "fork.knife")
                    calories(state)
                    protein(state)
                }
                .padding(.vertical, 10)
            } footer: {
                if state.previous.isEmpty { footer }
            }
            .listRowBackground(Color.surface)
            if !state.previous.isEmpty {
                Section {
                    ForEach(state.previous, id: \.date) { row in
                        HStack(spacing: 8) {
                            Text(BodyText.longDay(row.date, today: corps.today)).foregroundStyle(.ink)
                            Spacer(minLength: 8)
                            VStack(alignment: .trailing, spacing: 1) {
                                if let kcal = row.kcal {
                                    Text(BodyText.kcal(kcal)).font(.body.weight(.semibold)).foregroundStyle(.ink)
                                }
                                if let protein = row.proteinG {
                                    Text("\(BodyText.whole(protein))\u{202F}g de protéines", tableName: "Entries")
                                        .font(.subheadline)
                                        .foregroundStyle(.muted)
                                }
                            }
                            .monospacedDigit()
                            .multilineTextAlignment(.trailing)
                        }
                        .frame(minHeight: 52)
                        .accessibilityElement(children: .combine)
                    }
                } header: {
                    Text("Jours précédents", tableName: "Entries").textCase(nil).foregroundStyle(.ink)
                } footer: {
                    footer
                }
                .headerProminence(.increased)
                .listRowBackground(Color.surface)
            }
        }
        .belayList()
        .navigationTitle(Text("Apports", tableName: "Entries"))
        .largeTitleOnly()
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { adding = true } label: {
                    Image(systemName: "plus").fontWeight(.semibold)
                }
                .accessibilityLabel(Text("Saisir les apports", tableName: "Entries"))
                .accessibilityIdentifier("intake-add")
            }
        }
        .sheet(isPresented: $adding) { IntakeSheet(corps: corps) }
    }

    private var footer: some View {
        Text("Un total par jour, pas aliment par aliment.", tableName: "Entries").foregroundStyle(.muted)
    }

    private func calories(_ state: IntakeState) -> some View {
        let value = state.today.kcal ?? 0
        let line: Text? =
            if state.protein == nil {
                Text("Ce repère arrive avec ta première pesée.", tableName: "Entries")
            } else if state.kcalFigure == nil {
                Text(
                    "Ce repère demande ton profil\u{202F}: formule, année de naissance et taille, à remplir sur le web pour l’instant.",
                    tableName: "Entries")
            } else {
                nil
            }
        return Meter(
            title: Text("Calories", tableName: "Entries"), value: value,
            of: state.kcalFigure.map { Text("sur \(BodyText.kcal(Int($0)))", tableName: "Entries") },
            share: state.kcalFigure.map { Double(value) / $0 },
            words: line.map { AnyView($0.font(.subheadline.weight(.medium)).foregroundStyle(.ink)) },
            source: state.kcalFigure == nil
                ? nil : Text("ta dépense du jour d’après l’outil Dépense énergétique", tableName: "Entries"),
            id: "intake-kcal")
    }

    private func protein(_ state: IntakeState) -> some View {
        let value = state.today.proteinG ?? 0
        let words: AnyView? = state.protein.map { range in
            let low = BodyText.whole(Int(range.lowG)), high = BodyText.whole(Int(range.highG))
            let grams = Double(value)
            if grams < range.lowG {
                return AnyView(
                    Text("\(BodyText.whole(Int(range.lowG - grams)))\u{202F}g sous ta fourchette de \(low) à \(high)\u{202F}g", tableName: "Entries")
                        .font(.subheadline.weight(.medium)).foregroundStyle(.ink))
            }
            if grams > range.highG {
                return AnyView(
                    Text("\(BodyText.whole(Int(grams - range.highG)))\u{202F}g au-dessus de ta fourchette de \(low) à \(high)\u{202F}g", tableName: "Entries")
                        .font(.subheadline.weight(.medium)).foregroundStyle(.ink))
            }
            return AnyView(
                RangePill(text: LocalizedStringKey(String(localized: "dans ta fourchette de \(low) à \(high)\u{202F}g", table: "Entries"))))
        }
        return Meter(
            title: Text("Protéines", tableName: "Entries"), value: value,
            of: state.proteinFigure.map { Text("sur \(BodyText.whole(Int($0)))\u{202F}g", tableName: "Entries") },
            share: state.proteinFigure.map { Double(value) / $0 },
            words: words ?? AnyView(
                Text("Ce repère arrive avec ta première pesée.", tableName: "Entries")
                    .font(.subheadline.weight(.medium)).foregroundStyle(.ink)),
            source: state.protein == nil ? nil : Text("fourchette de l’outil Protéines", tableName: "Entries"),
            id: "intake-protein")
    }
}

/// One intake figure: its name, the day's value large, what it is read against, a bar in the
/// intake shade, then the words. VoiceOver reads it as one element.
private struct Meter: View {
    let title: Text
    let value: Int
    /// « sur 2 100 kcal », when the tool gives a figure.
    let of: Text?
    /// The value over the figure, for the bar.
    let share: Double?
    let words: AnyView?
    let source: Text?
    let id: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            title.font(.subheadline.weight(.semibold)).foregroundStyle(.muted)
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 6) { figure }
                VStack(alignment: .leading, spacing: 2) { figure }
            }
            .monospacedDigit()
            if let share {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.intakeTint)
                        Capsule().fill(Color.intakeShade).frame(width: g.size.width * min(1, max(0, share)))
                    }
                }
                .frame(height: 10)
                .accessibilityHidden(true)
            }
            words
            source.map { $0.font(.footnote).foregroundStyle(.muted) }
        }
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(id)
    }

    @ViewBuilder private var figure: some View {
        Text(BodyText.whole(value)).font(.displayStat).foregroundStyle(.ink)
        of.map { $0.font(.headline).foregroundStyle(.muted) }
    }
}

extension BodyText {
    /// « 1 850 kcal ».
    static func kcal(_ value: Int) -> String {
        String(localized: "\(whole(value))\u{202F}kcal", table: "Entries")
    }
}
