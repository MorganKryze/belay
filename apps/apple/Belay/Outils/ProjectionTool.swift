import BelayCore
import SwiftUI

/// Projection: the average weight opening on the weigh-ins, the goal, and the pace on three
/// segments or tuned by 0,05 % a week up to 2,5 %. The arrival as a range of dates, the weeks
/// under it and the window on a strip of months; past 1 % and 1,5 % a week the web's warnings in
/// words, in ink.
struct ProjectionTool: View {
    @Bindable var outils: OutilsModel
    let corps: CorpsModel
    /// Read once, when the page opens.
    @State private var defaults: ToolDefaults
    /// The day the projection starts from, read once too.
    @State private var today: String

    init(outils: OutilsModel, corps: CorpsModel) {
        self.outils = outils
        self.corps = corps
        _defaults = State(initialValue: corps.toolDefaults)
        _today = State(initialValue: toISODate(corps.now(), timeZone: corps.timeZone))
    }

    /// The pace chosen, « Équilibré » until one is.
    private var pct: Double {
        get { Double(outils.input(.projection, "rate")) ?? 0.75 }
        nonmutating set { outils.setInput(.projection, "rate", String(newValue)) }
    }

    private var fine: Bool {
        get { outils.input(.projection, "fine") == "1" }
        nonmutating set { outils.setInput(.projection, "fine", newValue ? "1" : "") }
    }

    var body: some View {
        let weight = outils.number(.projection, .weight, defaults)
        let target = ToolNumber.value(outils.input(.projection, "target"))
        ToolPage(tool: .projection) {
            switch projection(weight, target) {
            case .success(let (low, high, weeksLow, weeksHigh)):
                result(low: low, high: high, weeksLow: weeksLow, weeksHigh: weeksHigh)
            case .failure(let line): ResultWaiting(label: "Objectif atteint", line: line)
            }
        } fields: {
            Section {
                KeypadField(
                    label: "Poids moyen", text: outils.binding(.projection, .weight, defaults), prompt: "70",
                    source: outils.source(.projection, .weight, defaults).map {
                        SourceLine(source: $0, timeZone: corps.timeZone)
                    }, id: "tool-field-weight")
                KeypadField(
                    label: "Objectif",
                    text: Binding(
                        get: { outils.input(.projection, "target") }, set: { outils.setInput(.projection, "target", $0) }),
                    prompt: "65", id: "tool-field-target")
                if outils.anyPrefilled(.projection, [.weight], defaults) {
                    RestoreRow { outils.restore(.projection, [.weight]) }
                }
            }
            .listRowBackground(Color.surface)
            Section {
                pace(weight)
                warning
            } header: {
                Text("Ton rythme \(Text("(perte par semaine)", tableName: "Outils").foregroundStyle(.muted))", tableName: "Outils")
                    .font(.subheadline.weight(.semibold)).foregroundStyle(.ink).textCase(nil)
            }
            .listRowBackground(Color.surface)
        }
    }

    /// The three segments, or « Réglage fin » on − and +.
    @ViewBuilder private func pace(_ weight: Double?) -> some View {
        if fine {
            HStack(spacing: 8) {
                rateLine(weight).accessibilityIdentifier("tool-rate-pct")
                Spacer(minLength: 8)
                Nudge(
                    value: Binding(get: { pct }, set: { pct = $0 }), range: rateMinPct...rateMaxPct, step: rateStepPct,
                    what: "\(Self.pct(rateStepPct))\u{202F}%")
            }
            .frame(minHeight: 52)
            Button { fine = false } label: { Text("Revenir aux rythmes", tableName: "Outils").frame(minHeight: 44) }
                .accessibilityIdentifier("tool-rate-presets")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                Picker(selection: Binding(get: { pct }, set: { pct = $0 })) {
                    ForEach(ratePresets, id: \.id) { preset in
                        Text(Self.presetName(preset.id)).tag(preset.pct)
                    }
                } label: {
                    Text("Ton rythme", tableName: "Outils")
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("tool-rate")
                .sensoryFeedback(.selection, trigger: pct)
                rateLine(weight).accessibilityIdentifier("tool-rate-pct")
            }
            .padding(.vertical, 6)
            Button { fine = true } label: { Text("Réglage fin", tableName: "Outils").frame(minHeight: 44) }
                .accessibilityIdentifier("tool-rate-fine")
        }
    }

    /// « 0,75 % · 0,6 kg par semaine ».
    private func rateLine(_ weight: Double?) -> some View {
        let percent = "\(Self.pct(pct))\u{202F}%"
        let line =
            weight.map { kg in
                String(
                    localized: "\(percent) · \(BodyText.number(kgPerWeek(kg, pctPerWeek: pct)))\u{202F}kg par semaine",
                    table: "Outils")
            } ?? percent
        return Text(verbatim: line).font(.subheadline).monospacedDigit().foregroundStyle(.muted)
            .accessibilityLabel(Text(verbatim: line))
    }

    /// Past 1 % and 1,5 % a week, in words and in ink: a pace is never a fault.
    @ViewBuilder private var warning: some View {
        let words: Text? =
            switch rateWarning(pct) {
            case .none: nil
            case .above1:
                Text(
                    "Chez des athlètes, un rythme d’environ 1\u{202F}% par semaine s’est accompagné de moins de gain de masse maigre (Garthe 2011). Source dans la fiche.",
                    tableName: "Outils")
            case .above15:
                Text(
                    "À ce rythme, Belay te conseille de te faire suivre par un médecin ou un diététicien.",
                    tableName: "Outils")
            }
        if let words {
            Label {
                words.foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
            } icon: {
                Image(systemName: "info.circle").foregroundStyle(.ink)
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(words)
            .accessibilityIdentifier("tool-rate-warning")
        }
    }

    private func projection(_ weight: Double?, _ target: Double?)
        -> Result<(String, String, Int, Int), BodyLine>
    {
        guard let weight, let target else {
            return .failure(.missing([weight == nil ? .weight : nil, target == nil ? .target : nil]))
        }
        guard weightRangeKg.contains(weight), weightRangeKg.contains(target) else {
            return .failure(.outside("weight"))
        }
        do {
            switch try projectLoss(currentKg: weight, targetKg: target, pctPerWeek: pct, today: today) {
            case .ok(let weeksLow, let weeksHigh, let dateLow, let dateHigh):
                return .success((dateLow, dateHigh, weeksLow, weeksHigh))
            case .targetNotBelow:
                return .failure(.notBelow)
            }
        } catch {
            return .failure(.outside(error.message))
        }
    }

    private func result(low: String, high: String, weeksLow: Int, weeksHigh: Int) -> some View {
        let zone = corps.timeZone
        let between = String(
            localized: "Entre le \(ToolDay.text(low, zone)) et le \(ToolDay.text(high, zone))", table: "Outils")
        return VStack(alignment: .leading, spacing: 6) {
            ResultLabel(text: "Objectif atteint")
            Text(verbatim: between).font(.title2.weight(.bold)).foregroundStyle(.ink)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityLabel(Text(verbatim: between))
                .accessibilityIdentifier("tool-projection-dates")
            Text(
                "Dans \(weeksLow) à \(weeksHigh) semaines. La perte ralentit à mesure que tu perds du poids, d’où une fourchette.",
                tableName: "Outils"
            )
            .font(.subheadline).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("tool-projection-weeks")
            MonthBand(today: today, low: low, high: high, timeZone: zone).padding(.top, 8)
        }
        .padding(.vertical, 6)
    }

    /// « 0,75 », « 1 », « 2,5 ».
    static func pct(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(0...2)))
    }

    static func presetName(_ id: String) -> LocalizedStringResource {
        switch id {
        case "gentle": LocalizedStringResource("Doux", table: "Outils")
        case "steady": LocalizedStringResource("Soutenu", table: "Outils")
        default: LocalizedStringResource("Équilibré", table: "Outils")
        }
    }
}

/// The months from today to the late date, the arrival window filled in ink.
private struct MonthBand: View {
    let today: String
    let low: String
    let high: String
    let timeZone: TimeZone

    var body: some View {
        let start = ToolDay.date(today, timeZone) ?? .distantPast
        let end = ToolDay.date(high, timeZone) ?? start
        let from = ToolDay.date(low, timeZone) ?? start
        let span = max(1, end.timeIntervalSince(start))
        let words = String(
            localized: "Fenêtre d’arrivée\u{202F}: de \(ToolDay.text(low, timeZone)) à \(ToolDay.text(high, timeZone))",
            table: "Outils")
        VStack(alignment: .leading, spacing: 4) {
            GeometryReader { geometry in
                let width = geometry.size.width
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.track)
                    Capsule().fill(Color.ink)
                        .frame(width: max(8, width * (end.timeIntervalSince(from) / span)))
                        .offset(x: width * (from.timeIntervalSince(start) / span))
                }
            }
            .frame(height: 10)
            HStack {
                Text(verbatim: ToolDay.month(today, timeZone))
                Spacer()
                Text(verbatim: ToolDay.month(high, timeZone))
            }
            .font(.footnote).foregroundStyle(.muted)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: words))
        .accessibilityIdentifier("tool-projection-band")
    }
}

/// A local day of the rules (« 2026-12-09 ») as the tools write it.
enum ToolDay {
    static func date(_ iso: String, _ zone: TimeZone) -> Date? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        let parts = iso.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// « 9 décembre ».
    static func text(_ iso: String, _ zone: TimeZone) -> String {
        format(iso, zone, Date.FormatStyle().day().month(.wide))
    }

    /// « oct. ».
    static func month(_ iso: String, _ zone: TimeZone) -> String {
        format(iso, zone, Date.FormatStyle().month(.abbreviated))
    }

    private static func format(_ iso: String, _ zone: TimeZone, _ style: Date.FormatStyle) -> String {
        guard let date = date(iso, zone) else { return iso }
        var style = style
        style.timeZone = zone
        return date.formatted(style)
    }
}
