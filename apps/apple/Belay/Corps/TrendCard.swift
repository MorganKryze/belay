import BelayCore
import Charts
import SwiftUI

/// The 7-day average, its last week and its range in words; on Corps the span and the curve under
/// them. The body's accent is the same for a loss and a gain, never red (R9).
struct TrendCard: View {
    /// Réglages › Corps › Pastille: off leaves the figure alone when it is in range.
    @AppStorage(DevicePrefs.rangePill.key) private var pill = DevicePrefs.rangePill.initial
    /// Accueil shows no curve; Ta tendance adds creatine's band, the annotations and the legend.
    enum Place { case corps, accueil, trend }
    let state: CorpsState
    let series: TrendSeries
    let place: Place
    /// Corps's span over the curve; Accueil has no curve.
    var span: Binding<TrendSpan>? = nil
    /// « Ajouter une pesée », on Corps before the first weigh-in.
    var add: (() -> Void)? = nil
    /// Opens « Comment c’est calculé » from the range, on Ta tendance.
    var explain: (() -> Void)? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            DomainChip(domain: .body, text: String(localized: "Moyenne 7 jours", table: "Corps"), symbol: "chart.line.downtrend.xyaxis")
            switch state {
            case .first:
                heading(Text("Pas encore de pesée", tableName: "Corps"))
                line(
                    Text(
                        "La moyenne apparaît dès 4 pesées sur 7 jours, la perte par semaine après deux semaines complètes.",
                        tableName: "Corps"))
                if place == .corps {
                    EmptyChart()
                    if let add {
                        PrimaryButton(title: "Ajouter une pesée", tableName: "Corps", action: add).padding(.top, 4)
                    }
                }
            case .early(let count, let points):
                heading(Text("Encore \(count) pesées cette semaine", tableName: "Corps"))
                line(Text(verbatim: early(count)))
                if place == .corps { WeightChart(points: points, average: [], span: earlySpan(points)) }
            case .usual(let trend):
                let unit = BodyText.unit
                Figure(
                    text: BodyText.figure(trend.averageKg, unit), value: weighingFromKg(trend.averageKg, unit),
                    unit: unit.rawValue)
                change(trend)
                range(trend)
                if place != .accueil, let span {
                    Picker(String(localized: "Période", table: "Corps"), selection: span) {
                        ForEach(TrendSpan.allCases, id: \.self) { s in
                            Text(s.letter).accessibilityLabel(s.name).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                    // 44 pt tall, the rule's target, its words capped so it stays whole at AX3.
                    .controlSize(.extraLarge)
                    .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
                    .sensoryFeedback(.selection, trigger: span.wrappedValue)
                    .accessibilityIdentifier("trend-span")
                    .padding(.top, 6)
                    if place == .trend {
                        WeightChart(
                            points: series.points, average: series.average, span: span.wrappedValue,
                            creatine: series.creatine, annotations: series.annotations)
                        Divider().overlay(Color.line).padding(.top, 8)
                        ChartLegend(series: series).padding(.vertical, 6)
                    } else {
                        WeightChart(points: series.points, average: series.average, span: span.wrappedValue)
                    }
                }
            }
        }
        .padding(.vertical, 10)
    }

    /// The rule, then the weigh-ins this week already holds, their number in words as French
    /// writes a small number in a sentence.
    private func early(_ count: Int) -> String {
        let rule = String(localized: "La moyenne apparaît dès 4 pesées sur 7 jours.", table: "Corps")
        let there = minWeighings - count
        switch there {
        case ...0: return rule
        case 1: return rule + " " + String(localized: "Ta première est déjà là.", table: "Corps")
        default:
            let words = NumberFormatter.localizedString(from: NSNumber(value: there), number: .spellOut)
            return rule + " " + String(localized: "Tes \(words) premières sont déjà là.", table: "Corps")
        }
    }

    private func heading(_ text: Text) -> some View {
        text.font(.title2.weight(.bold)).foregroundStyle(.ink).fixedSize(horizontal: false, vertical: true)
    }

    private func line(_ text: Text) -> some View {
        text.font(.subheadline).foregroundStyle(.muted).fixedSize(horizontal: false, vertical: true)
    }

    /// « perte 0,7 %/sem la semaine dernière », or « prise » for a gain, in ink, never judged.
    @ViewBuilder private func change(_ trend: TrendCardState) -> some View {
        if let loss = trend.lossPct {
            let figure = BodyText.percent(BodyText.number(abs(loss))) + String(localized: "/sem", table: "Corps")
            let words =
                loss < 0
                ? String(localized: "prise \(figure) la semaine dernière", table: "Corps")
                : String(localized: "perte \(figure) la semaine dernière", table: "Corps")
            Text(words)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.ink)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("trend-change")
        } else {
            line(Text("La perte par semaine apparaît après deux semaines complètes.", tableName: "Corps"))
        }
    }

    /// In range on a pill; out of it in grey words with the range, so the words carry it. On Ta
    /// tendance, with its « ? », it opens how the range is read.
    @ViewBuilder private func range(_ trend: TrendCardState) -> some View {
        if trend.inRange == true && pill == .hidden {
            EmptyView()
        } else if let explain, trend.inRange != nil {
            Button(action: explain) {
                HStack(spacing: 8) {
                    rangeWords(trend)
                    Image(systemName: "questionmark.circle")
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.muted)
                        .accessibilityHidden(true)
                }
                .frame(minHeight: 44)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityHint(Text("Comment c’est calculé", tableName: "Trend"))
            .accessibilityIdentifier("trend-range")
        } else {
            rangeWords(trend)
        }
    }

    @ViewBuilder private func rangeWords(_ trend: TrendCardState) -> some View {
        switch trend.inRange {
        case true?:
            RangePill(text: LocalizedStringKey(String(localized: "dans ta fourchette", table: "Corps")))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("trend-range")
        case false?:
            let low = trend.range.minPct.upToHundredths, high = BodyText.percent(trend.range.maxPct.upToHundredths)
            Text(String(localized: "hors de ta fourchette, \(low) à \(high)", table: "Corps"))
                .font(.footnote.weight(.semibold))
                .foregroundStyle(.muted)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("trend-range")
        case nil:
            EmptyView()
        }
    }
}

extension TrendSpan {
    /// S, M, A over the curve.
    var letter: String {
        switch self {
        case .week: String(localized: "S", table: "Corps")
        case .month: String(localized: "M", table: "Corps")
        case .year: String(localized: "A", table: "Corps")
        }
    }

    var name: String {
        switch self {
        case .week: String(localized: "Semaine", table: "Corps")
        case .month: String(localized: "Mois", table: "Corps")
        case .year: String(localized: "Année", table: "Corps")
        }
    }
}

/// Before the first weigh-in: the chart's place, kept, with its grid and one sentence.
struct EmptyChart: View {
    var body: some View {
        ZStack {
            VStack(spacing: 0) {
                ForEach(0..<4, id: \.self) { _ in
                    Divider().overlay(Color.line)
                    Spacer()
                }
            }
            VStack(spacing: 6) {
                Image(systemName: "chart.xyaxis.line").font(.title2).foregroundStyle(.bodyShade).accessibilityHidden(true)
                Text("Ta courbe commence à ta première pesée.", tableName: "Corps")
                    .font(.subheadline)
                    .foregroundStyle(.muted)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 12)
            .background(Color.surface)
        }
        .frame(height: 150)
        .accessibilityElement(children: .combine)
    }
}

