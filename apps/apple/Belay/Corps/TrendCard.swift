import BelayCore
import Charts
import SwiftUI

/// The 7-day average, its last week and its range in words; on Corps the span and the curve under
/// them. The body's accent is the same for a loss and a gain, never red (R9).
struct TrendCard: View {
    enum Place { case corps, accueil }
    let state: CorpsState
    let series: TrendSeries
    let place: Place
    /// Corps's span over the curve; Accueil has no curve.
    var span: Binding<TrendSpan>? = nil
    /// « Ajouter une pesée », on Corps before the first weigh-in.
    var add: (() -> Void)? = nil

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
                line(Text("La moyenne apparaît dès 4 pesées sur 7 jours.", tableName: "Corps"))
                if place == .corps { WeightChart(points: points, average: [], span: .month) }
            case .usual(let trend):
                Figure(text: BodyText.number(trend.averageKg), value: trend.averageKg, unit: "kg")
                change(trend)
                range(trend)
                if place == .corps, let span {
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
                    WeightChart(points: series.points, average: series.average, span: span.wrappedValue)
                }
            }
        }
        .padding(.vertical, 10)
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
            let figure = "\(BodyText.number(abs(loss)))\u{202F}%/sem"
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

    /// In range on a pill; out of it in grey words with the range, so the words carry it.
    @ViewBuilder private func range(_ trend: TrendCardState) -> some View {
        switch trend.inRange {
        case true?:
            RangePill(text: LocalizedStringKey(String(localized: "dans ta fourchette", table: "Corps")))
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("trend-range")
        case false?:
            let bounds = "\(BodyText.percent(trend.range.minPct)) à \(BodyText.percent(trend.range.maxPct))\u{202F}%"
            Text(String(localized: "hors de ta fourchette, \(bounds)", table: "Corps"))
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

/// The weigh-ins as pale points, the 7-day average as the body's line, the axis on the right.
struct WeightChart: View {
    let points: [BelayCore.Point]
    let average: [BelayCore.Point]
    let span: TrendSpan
    @ScaledMetric(relativeTo: .body) private var height: CGFloat = 200
    @Environment(\.dynamicTypeSize) private var typeSize

    private var domain: ClosedRange<Double> {
        let values = (points + average).map(\.value)
        return ((values.min() ?? 79) - 0.4).rounded(.down)...((values.max() ?? 82) + 0.4).rounded(.up)
    }

    var body: some View {
        Chart {
            ForEach(points, id: \.date) { p in
                if let day = BodyText.date(p.date) {
                    PointMark(x: .value("Jour", day, unit: .day), y: .value("Pesée", p.value))
                        .symbolSize(span == .year ? 6 : span == .week ? 46 : 20)
                        .foregroundStyle(Color.bodyShade.opacity(0.35))
                }
            }
            ForEach(average, id: \.date) { p in
                if let day = BodyText.date(p.date) {
                    LineMark(x: .value("Jour", day, unit: .day), y: .value("Moyenne", p.value))
                        .interpolationMethod(.monotone)
                        .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                        .foregroundStyle(Color.bodyShade)
                }
            }
        }
        .chartYScale(domain: domain)
        .chartXAxis {
            switch span {
            case .week:
                AxisMarks(values: .stride(by: .day)) { _ in
                    AxisValueLabel(format: .dateTime.weekday(.abbreviated)).foregroundStyle(.muted)
                }
            case .month:
                AxisMarks(values: .stride(by: .day, count: 7)) { _ in
                    AxisGridLine().foregroundStyle(.line)
                    AxisValueLabel(format: .dateTime.day().month(.abbreviated)).foregroundStyle(.muted)
                }
            case .year:
                AxisMarks(values: .stride(by: .month, count: 2)) { _ in
                    AxisGridLine().foregroundStyle(.line)
                    AxisValueLabel(format: .dateTime.month(.abbreviated)).foregroundStyle(.muted)
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .trailing, values: .automatic(desiredCount: 4)) { _ in
                AxisGridLine().foregroundStyle(.line)
                AxisValueLabel().foregroundStyle(.muted)
            }
        }
        .frame(height: typeSize.isAccessibilitySize ? 220 : height)
        // As Santé does at the largest sizes: the chart's labels stop growing, so they never overlap.
        .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityIdentifier("trend-chart")
    }

    private var label: String {
        if let last = average.last {
            return String(localized: "Moyenne 7 jours et pesées, \(span.name.lowercased()), \(BodyText.kg(last.value))", table: "Corps")
        }
        return String(localized: "Tes pesées, \(span.name.lowercased())", table: "Corps")
    }
}
