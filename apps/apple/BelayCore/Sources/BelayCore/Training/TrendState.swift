import Foundation

// The curve of Corps and Ta tendance, computed once per change of the entries rather than in the
// view: the weigh-ins, the 7-day average, creatine's band and the annotations over a span ending
// today.

/// S, M and A: 7, 30 and 365 days ending today, as the web's chart.
public enum TrendSpan: Sendable, CaseIterable {
  case week, month, year

  public var days: Int {
    switch self {
    case .week: 7
    case .month: 30
    case .year: 365
    }
  }
}

/// An annotation where the chart and the weeks place it.
public struct AnnotationMark: Sendable, Equatable {
  public var id: String
  public var date: String
  public var kind: AnnotationKind
  public var label: String?
}

/// One span's curve; each list is in date order, one point a day at most, so a year holds 365.
public struct TrendSeries: Sendable, Equatable {
  public var points: [Point]
  public var average: [Point]
  /// Creatine's courses, cut to the span.
  public var creatine: [DateSpan]
  public var annotations: [AnnotationMark]
}

/// The first days' chart: its days by name while the weigh-ins fit in one week, by date past it.
public func earlySpan(_ points: [Point]) -> TrendSpan {
  let dates = points.map(\.date)
  guard let first = dates.min(), let last = dates.max() else { return .week }
  return last <= addDays(first, TrendSpan.week.days - 1) ? .week : .month
}

public func trendSeries(_ body: BodyRead, span: TrendSpan, now: Date, timeZone: TimeZone)
  -> TrendSeries
{
  let today = toISODate(now, timeZone: timeZone)
  let from = addDays(today, 1 - span.days)
  let within = { (date: String) in date >= from && date <= today }
  let ws = weighings(body)
  let creatine = creatineWindows(creatineDays(body), today: today)
    .filter { $0.end >= from && $0.start <= today }
    .map { DateSpan(start: max($0.start, from), end: min($0.end, today)) }
  return TrendSeries(
    points: ws.filter { within($0.date) }.sorted { $0.date < $1.date }
      .map { Point(date: $0.date, value: $0.weightKg) },
    // Weigh-ins before the span still count for its first days.
    average: movingAverageSeries(ws, from: from, to: today)
      .map { Point(date: $0.date, value: $0.averageKg) },
    creatine: creatine,
    annotations: annotationMarks(body).filter { within($0.date) })
}

/// The days a creatine box was ticked, removed supplements' included: their courses still count.
func creatineDays(_ body: BodyRead) -> [String] {
  let creatine = Set(body.supplements.filter { $0.kind == .creatine }.map(\.id))
  return body.logs.filter { $0.taken && creatine.contains($0.supplementId) }.map(\.date)
}

/// The annotations in place, by day.
func annotationMarks(_ body: BodyRead) -> [AnnotationMark] {
  body.annotations.filter { !$0.removed }
    .sorted { ($0.date, $0.id) < ($1.date, $1.id) }
    .map { AnnotationMark(id: $0.id, date: $0.date, kind: $0.type, label: $0.label) }
}
