import BelayCore
import Charts
import SwiftUI
import UIKit

/// Ta tendance: the trend card with creatine's band, the annotations and the legend over the
/// curve, then the weeks and the annotations' list. The range opens how it is read.
struct TrendView: View {
    let corps: CorpsModel
    /// Pushes « Comment c’est calculé ».
    let open: (Route) -> Void
    @State private var sheet: AnnotationSheet.Target?

    var body: some View {
        @Bindable var corps = corps
        List {
            Section {
                TrendCard(
                    state: corps.state, series: corps.series, place: .trend, span: $corps.span,
                    explain: { open(.science(id: "target-rate")) })
            }
            .listRowBackground(Color.surface)
            WeeksView(
                weeks: corps.weekRows, range: corps.range, annotations: corps.annotations,
                add: { sheet = .add }, edit: { sheet = .edit($0) })
        }
        .belayList()
        .navigationTitle(Text("Ta tendance", tableName: "Trend"))
        .largeTitleOnly()
        .sheet(item: $sheet) { AnnotationSheet(corps: corps, target: $0) }
    }
}

extension AnnotationKind {
    /// The kinds a person can choose; a kind from a newer version is shown, never offered.
    static let chosen: [AnnotationKind] = [.deload, .dietBreak, .note]

    var name: String {
        switch self {
        case .deload: String(localized: "Semaine allégée", table: "Trend")
        case .dietBreak: String(localized: "Pause diète", table: "Trend")
        case .note: String(localized: "Note", table: "Trend")
        case .unknown: String(localized: "Annotation", table: "Trend")
        }
    }

    var symbol: String {
        switch self {
        case .deload: "arrow.down.right"
        case .dietBreak: "pause"
        case .note: "text.bubble"
        case .unknown: "bookmark"
        }
    }
}

/// The weigh-ins as pale points, the 7-day average as the body's line, the axis on the right in the
/// unit chosen. On Ta tendance creatine's courses lie under them as a band and each annotation
/// stands as a dotted line with its icon. A tap or a drag reads the day nearest to it.
struct WeightChart: View {
    let points: [BelayCore.Point]
    let average: [BelayCore.Point]
    let span: TrendSpan
    var creatine: [DateSpan] = []
    var annotations: [AnnotationMark] = []
    @State private var selected: Date?
    @ScaledMetric(relativeTo: .body) private var height: CGFloat = 200
    @Environment(\.dynamicTypeSize) private var typeSize

    /// The unit the curve and its axis read in.
    private var unit: WeightUnit { SetText.unit }

    /// A weight as the curve draws it, in the unit shown.
    private func shown(_ kg: Double) -> Double { weighingFromKg(kg, unit) }

    /// The values drawn, with a margin of about 0,4 kg above and below, to whole numbers of the unit.
    private var domain: ClosedRange<Double> {
        let values = (points + average).map { shown($0.value) }
        let margin = unit == .kg ? 0.4 : 1
        return ((values.min() ?? shown(79)) - margin).rounded(.down)...((values.max() ?? shown(82)) + margin).rounded(.up)
    }

    /// The weigh-in nearest to the selected place.
    private var picked: BelayCore.Point? {
        guard let selected else { return nil }
        return points.min { a, b in
            let da = BodyText.date(a.date).map { abs($0.timeIntervalSince(selected)) } ?? .infinity
            let db = BodyText.date(b.date).map { abs($0.timeIntervalSince(selected)) } ?? .infinity
            return da < db
        }
    }

    /// Midnight starting `iso`, so a band covers its days whole.
    private func dayStart(_ iso: String) -> Date? {
        BodyText.date(iso).map { Calendar.current.startOfDay(for: $0) }
    }

    var body: some View {
        Chart {
            band
            marks
            weighIns
            line
            pickedRule
        }
        // A tap reads the day under it; a press then a drag moves along the curve, and the day read
        // stays once the finger lifts. UIKit's long press, as SwiftUI's own gestures here took the list's swipes.
        .chartOverlay { proxy in
            GeometryReader { geometry in
                let pick = { (x: CGFloat) in
                    guard let plot = proxy.plotFrame else { return }
                    selected = proxy.value(atX: x - geometry[plot].origin.x, as: Date.self)
                }
                Rectangle().fill(.clear).contentShape(.rect)
                    .onTapGesture { pick($0.x) }
                    .gesture(PressThenDrag { pick($0.x) })
            }
        }
        .sensoryFeedback(.selection, trigger: picked?.date)
        .onChange(of: span) { selected = nil }
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
        .padding(.top, annotations.isEmpty ? 0 : 6)
        .accessibilityElement()
        .accessibilityLabel(label)
        .accessibilityValue(picked.map { reading($0, BodyText.spoken) } ?? String(localized: "\(points.count) pesées", table: "Trend"))
        .accessibilityIdentifier("trend-chart")
    }

    /// Creatine's courses, under everything.
    @ChartContentBuilder private var band: some ChartContent {
        ForEach(creatine, id: \.start) { course in
            if let start = dayStart(course.start), let end = dayStart(addDays(course.end, 1)) {
                RectangleMark(xStart: .value("Début", start), xEnd: .value("Fin", end))
                    .foregroundStyle(Color.intakeTint.opacity(0.7))
            }
        }
    }

    /// Each annotation, a dotted line with its icon.
    @ChartContentBuilder private var marks: some ChartContent {
        ForEach(annotations, id: \.id) { mark in
            if let day = BodyText.date(mark.date) {
                RuleMark(x: .value("Jour", day, unit: .day))
                    .foregroundStyle(Color.restShade)
                    .lineStyle(StrokeStyle(lineWidth: 1.5, dash: [3, 3]))
                    .annotation(position: .top, alignment: .center, spacing: 2) {
                        Image(systemName: mark.kind.symbol)
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(.restShade)
                            .padding(4)
                            .background(Color.restTint, in: .circle)
                    }
            }
        }
    }

    /// Smaller as the span holds more days.
    private var pointSize: CGFloat {
        switch span {
        case .week: 46
        case .month: 20
        case .year: 6
        }
    }

    /// The day's weigh-ins, pale.
    @ChartContentBuilder private var weighIns: some ChartContent {
        ForEach(points, id: \.date) { p in
            if let day = BodyText.date(p.date) {
                PointMark(x: .value("Jour", day, unit: .day), y: .value("Pesée", shown(p.value)))
                    .symbolSize(pointSize)
                    .foregroundStyle(Color.chartDay)
            }
        }
    }

    /// The 7-day average.
    @ChartContentBuilder private var line: some ChartContent {
        ForEach(average, id: \.date) { p in
            if let day = BodyText.date(p.date) {
                LineMark(x: .value("Jour", day, unit: .day), y: .value("Moyenne", shown(p.value)))
                    .interpolationMethod(.monotone)
                    .lineStyle(StrokeStyle(lineWidth: 3, lineCap: .round, lineJoin: .round))
                    .foregroundStyle(Color.bodyShade)
            }
        }
    }

    /// The day read, a rule with its figures above.
    @ChartContentBuilder private var pickedRule: some ChartContent {
        if let picked, let day = BodyText.date(picked.date) {
            RuleMark(x: .value("Jour", day, unit: .day))
                .foregroundStyle(.muted)
                .annotation(position: .top, overflowResolution: .init(x: .fit(to: .chart), y: .disabled)) {
                    Text(reading(picked, BodyText.weight))
                        .font(.footnote.weight(.medium))
                        .monospacedDigit()
                        .foregroundStyle(.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.track, in: .rect(cornerRadius: 10))
                }
        }
    }

    /// « mardi 10 nov. · Pesée 79,9 kg · Moyenne 7 j 80,1 kg », in the unit chosen, each weight written by
    /// `weight`: with the symbol on screen, the unit as a word to VoiceOver.
    private func reading(_ point: BelayCore.Point, _ weight: (Double) -> String) -> String {
        let day = BodyText.date(point.date)?.formatted(.dateTime.weekday(.wide).day().month(.abbreviated)) ?? point.date
        let weighed = weight(point.value)
        if let mean = average.first(where: { $0.date == point.date }) {
            return String(localized: "\(day) · Pesée \(weighed) · Moyenne 7 j \(weight(mean.value))", table: "Trend")
        }
        return String(localized: "\(day) · Pesée \(weighed)", table: "Trend")
    }

    private var label: String {
        if let last = average.last {
            return String(localized: "Moyenne 7 jours et pesées, \(span.name.lowercased()), \(BodyText.spoken(last.value))", table: "Corps")
        }
        return String(localized: "Tes pesées, \(span.name.lowercased())", table: "Corps")
    }
}

/// The legend under Ta tendance's curve: each mark named in words, creatine's with its days.
struct ChartLegend: View {
    let series: TrendSeries

    private struct Item: Identifiable {
        let id: String
        let sign: AnyView
        let words: String
        let label: String
    }

    private var items: [Item] {
        var items = [
            Item(
                id: "legend-day", sign: AnyView(Circle().fill(Color.chartDay).frame(width: 8, height: 8)),
                words: String(localized: "Pesée du jour", table: "Trend"),
                label: String(localized: "Pesée du jour", table: "Trend")),
            Item(
                id: "legend-average", sign: AnyView(Capsule().fill(Color.bodyShade).frame(width: 18, height: 3)),
                words: String(localized: "Moyenne 7 jours", table: "Corps"),
                label: String(localized: "Moyenne 7 jours", table: "Corps")),
        ]
        if !series.creatine.isEmpty {
            let days = series.creatine.map { course in
                let start = BodyText.date(course.start)?.formatted(.dateTime.day().month(.wide)) ?? course.start
                let end = BodyText.date(course.end)?.formatted(.dateTime.day().month(.wide)) ?? course.end
                return String(localized: "du \(start) au \(end)", table: "Trend")
            }
            items.append(
                Item(
                    id: "legend-creatine",
                    sign: AnyView(RoundedRectangle(cornerRadius: 2).fill(Color.intakeTint).frame(width: 14, height: 10)),
                    words: String(localized: "Créatine", table: "Trend"),
                    label: String(localized: "Créatine, \(days.formatted(.list(type: .and)))", table: "Trend")))
        }
        if !series.annotations.isEmpty {
            items.append(
                Item(
                    id: "legend-annotation",
                    sign: AnyView(
                        Image(systemName: "arrow.down.right").font(.caption2.weight(.bold)).foregroundStyle(.restShade)),
                    words: String(localized: "Annotation", table: "Trend"),
                    label: String(localized: "\(series.annotations.count) annotations", table: "Trend")))
        }
        return items
    }

    var body: some View {
        let items = items
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 14) { ForEach(items) { cell($0) } }
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 6) {
                ForEach(Array(stride(from: 0, to: items.count, by: 2)), id: \.self) { i in
                    GridRow {
                        cell(items[i])
                        if i + 1 < items.count { cell(items[i + 1]) }
                    }
                }
            }
            VStack(alignment: .leading, spacing: 6) { ForEach(items) { cell($0) } }
        }
        .font(.footnote)
        .foregroundStyle(.muted)
    }

    private func cell(_ item: Item) -> some View {
        HStack(spacing: 6) {
            item.sign.frame(width: 18).accessibilityHidden(true)
            Text(item.words).fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.label)
        .accessibilityIdentifier(item.id)
    }
}

/// A press held a quarter of a second, then followed as it moves: UIKit's long press, which gives
/// way to the list's scroll when the finger moves first.
private struct PressThenDrag: UIGestureRecognizerRepresentable {
    let moved: @MainActor (CGPoint) -> Void

    func makeUIGestureRecognizer(context: Context) -> UILongPressGestureRecognizer {
        let press = UILongPressGestureRecognizer()
        press.minimumPressDuration = 0.25
        return press
    }

    func handleUIGestureRecognizerAction(_ recognizer: UILongPressGestureRecognizer, context: Context) {
        if recognizer.state == .began || recognizer.state == .changed { moved(context.converter.localLocation) }
    }
}
