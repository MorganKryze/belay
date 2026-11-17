import BelayCore
import SwiftUI

/// Protéines: the goal on three segments, the weight opening on the weigh-ins, and in a cut the
/// body fat, optional. The day's range large, per kilo under it, then what 3 and 4 meals each
/// take. Apports reads the goal chosen here.
struct ProteinTool: View {
    @Bindable var outils: OutilsModel
    let corps: CorpsModel
    /// Read once, when the page opens.
    @State private var defaults: ToolDefaults

    init(outils: OutilsModel, corps: CorpsModel) {
        self.outils = outils
        self.corps = corps
        _defaults = State(initialValue: corps.toolDefaults)
    }

    var body: some View {
        let goal = outils.proteinGoal
        let weight = outils.number(.protein, .weight, defaults)
        let fat = goal == .cut ? ToolNumber.value(outils.input(.protein, "fat")) : nil
        let range = range(weight, goal: goal, fat: fat)
        ToolPage(tool: .protein, note: note(range, goal: goal)) {
            switch range {
            case .success(let range): result(range, weight: weight ?? 1)
            case .failure(let line): ResultWaiting(label: "Par jour", line: line)
            }
        } fields: {
            Section {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Ton objectif", tableName: "Outils").foregroundStyle(.ink)
                    Picker(selection: $outils.proteinGoal) {
                        Text("Maintien", tableName: "Outils").tag(ProteinGoal.maintain)
                        Text("Sèche", tableName: "Outils").tag(ProteinGoal.cut)
                        Text("Prise", tableName: "Outils").tag(ProteinGoal.gain)
                    } label: {
                        Text("Ton objectif", tableName: "Outils")
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("tool-goal")
                    .sensoryFeedback(.selection, trigger: goal)
                }
                .padding(.vertical, 6)
                KeypadField(
                    label: "Poids", text: outils.binding(.protein, .weight, defaults), prompt: "70",
                    source: outils.source(.protein, .weight, defaults).map {
                        SourceLine(source: $0, timeZone: corps.timeZone)
                    }, id: "tool-field-weight")
                if goal == .cut {
                    KeypadField(
                        label: "Masse grasse (facultatif)",
                        text: Binding(get: { outils.input(.protein, "fat") }, set: { outils.setInput(.protein, "fat", $0) }),
                        unit: "%", prompt: "18", id: "tool-field-fat")
                }
                if outils.anyPrefilled(.protein, [.weight], defaults) {
                    RestoreRow { outils.restore(.protein, [.weight]) }
                }
            } footer: {
                Text("Corps › Apports compare tes protéines à cette fourchette.", tableName: "Outils")
                    .foregroundStyle(.muted)
            }
            .listRowBackground(Color.surface)
        }
    }

    private func range(_ weight: Double?, goal: ProteinGoal, fat: Double?) -> Result<ProteinRange, BodyLine> {
        guard let weight else { return .failure(.missing([.weight])) }
        guard weightRangeKg.contains(weight) else { return .failure(.outside("weight")) }
        do {
            return .success(try proteinRange(weight, goal: goal, bodyFatPct: fat))
        } catch {
            return .failure(.outside(error.message))
        }
    }

    /// In a cut, what the range is read from, and the floor when it lifted the low end.
    private func note(_ range: Result<ProteinRange, BodyLine>, goal: ProteinGoal) -> Text? {
        guard goal == .cut, case .success(let range) = range else { return nil }
        let basis =
            range.basis == .noBodyFat
            ? Text(
                "Sans masse grasse, Belay prend 1,8 à 2,5\u{00A0}g par kg de poids (heuristique Belay). Ajoute ta masse grasse pour une fourchette plus juste.",
                tableName: "Outils")
            : Text(
                "En sèche, la fourchette part de ta masse maigre\u{202F}: 2,3 à 3,1\u{00A0}g par kg de masse maigre.",
                tableName: "Outils")
        guard range.floorApplied else { return basis }
        let floor = Text(
            "Relevée à 1,6\u{00A0}g par kg de poids, le plancher que Belay garde en sèche (heuristique Belay).",
            tableName: "Outils")
        return Text("\(basis) \(floor)", tableName: "Outils")
    }

    private func result(_ range: ProteinRange, weight: Double) -> some View {
        // To the tenth, written to the hundredth unless whole, as designed: « 1,40 à 2 ».
        let perKg = { (grams: Double) in
            let value = roundTo(grams / weight, step: 0.1)
            return value.formatted(.number.precision(.fractionLength(value == value.rounded() ? 0 : 2)))
        }
        let day = Self.grams(range.lowG, range.highG)
        return VStack(alignment: .leading, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                ResultLabel(text: "Par jour")
                Figure(text: day, value: range.lowG, unit: "g")
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: "\(String(localized: "Par jour", table: "Outils")), \(day)\u{202F}g"))
            .accessibilityIdentifier("tool-figure-protein")
            Text("soit \(perKg(range.lowG)) à \(perKg(range.highG))\u{00A0}g par kg de poids", tableName: "Outils")
                .font(.subheadline).foregroundStyle(.muted)
            Divider().overlay(Color.line).padding(.top, 8).padding(.bottom, 12)
            HStack(alignment: .top, spacing: 16) {
                meal(String(localized: "Sur 3 repas", table: "Outils"), range.perMeal3, id: "tool-meals-3")
                meal(String(localized: "Sur 4 repas", table: "Outils"), range.perMeal4, id: "tool-meals-4")
            }
        }
        .padding(.vertical, 6)
    }

    /// « 110 à 160 », or one figure when both ends meet.
    private static func grams(_ low: Double, _ high: Double) -> String {
        let n = { (value: Double) in BodyText.whole(Int(value)) }
        return low == high ? n(low) : String(localized: "\(n(low)) à \(n(high))", table: "Outils")
    }

    private func meal(_ title: String, _ grams: [Double], id: String) -> some View {
        let amount = "\(Self.grams(grams[0], grams[1]))\u{202F}g"
        return VStack(alignment: .leading, spacing: 2) {
            Text(verbatim: title).font(.subheadline).foregroundStyle(.muted)
            Text(verbatim: amount).font(.title3.weight(.bold)).monospacedDigit().foregroundStyle(.ink)
                .lineLimit(1).minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(title), \(amount)"))
        .accessibilityIdentifier(id)
    }
}
