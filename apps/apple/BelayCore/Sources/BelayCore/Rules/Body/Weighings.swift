// The weigh-ins' 7-day average and their weeks, ported from the shared rules.

/// One day's weigh-in.
public struct Weighing: Codable, Sendable, Equatable {
  public var date: String
  public var weightKg: Double

  public init(date: String, weightKg: Double) {
    self.date = date
    self.weightKg = weightKg
  }
}

/// A day's 7-day average.
public struct DayAverage: Codable, Sendable, Equatable {
  public var date: String
  public var averageKg: Double
}

/// A heuristic: a week, or a 7-day window, says something from 4 weigh-ins on.
public let minWeighings = 4

/// 20.0 to 400.0 kg in steps of 0.1 kg; the tolerance absorbs binary noise such as 79.8 × 10.
public func isWeighingKg(_ value: Double) -> Bool {
  let tenths = value * 10
  return value.isFinite && value >= Bounds.weighInKgMin && value <= Bounds.weighInKgMax
    && abs(tenths - jsRound(tenths)) < 1e-6
}

/// By date, two of the same day kept in their order, as the web's stable sort leaves them: the
/// order a mean adds its values in can move its last digit.
private func byDate(_ ws: [Weighing]) -> [Weighing] {
  ws.enumerated()
    .sorted { ($0.element.date, $0.offset) < ($1.element.date, $1.offset) }
    .map(\.element)
}

private func mean(_ values: [Double]) -> Double {
  values.reduce(0, +) / Double(values.count)
}

/// The 7-day average of every day from `from` to `to`, on the days whose window [day − 6, day]
/// holds at least 4 weigh-ins. Weigh-ins before `from` count for the first days.
public func movingAverageSeries(_ ws: [Weighing], from: String, to: String) -> [DayAverage] {
  let sorted = byDate(ws)
  var out: [DayAverage] = []
  var lo = 0
  var hi = 0
  var day = from
  while day <= to {
    while hi < sorted.count && sorted[hi].date <= day { hi += 1 }
    let start = addDays(day, -6)
    while lo < hi && sorted[lo].date < start { lo += 1 }
    if hi - lo >= minWeighings {
      out.append(DayAverage(date: day, averageKg: mean(sorted[lo..<hi].map(\.weightKg))))
    }
    day = addDays(day, 1)
  }
  return out
}

/// The average of the weigh-ins in [on − 6 days, on]; nil with fewer than 4.
public func movingAverage7(_ ws: [Weighing], on day: String) -> Double? {
  movingAverageSeries(ws, from: day, to: day).first?.averageKg
}

/// The most recent day, up to `today`, that has a 7-day average.
public func latestMovingAverage(_ ws: [Weighing], today: String) -> DayAverage? {
  guard let head = ws.first else { return nil }
  let first = ws.reduce(head.date) { $1.date < $0 ? $1.date : $0 }
  return movingAverageSeries(ws, from: first, to: today).last
}

/// One ISO week of weigh-ins.
public struct WeekSummary: Codable, Sendable, Equatable {
  public enum Status: String, Codable, Sendable {
    case inProgress = "in_progress"
    case valid, insufficient
  }

  /// Monday.
  public var start: String
  /// Sunday.
  public var end: String
  public var count: Int
  public var status: Status
  /// The mean of a valid week; for a week in progress, the running mean of its weigh-ins so far
  /// (nil before the first); nil for an insufficient week.
  public var averageKg: Double?
  /// (average of the week before − this week's) / the week before's × 100, positive when losing;
  /// nil unless both weeks are valid.
  public var lossPct: Double?
}

/// Every ISO week from the first weigh-in to the week of `today`, most recent first. The week
/// holding `today` is in progress: never valid, never part of a loss. A weigh-in dated after
/// `today` (a time zone change) lands in a week in progress too.
public func weeklySummaries(_ ws: [Weighing], today: String) -> [WeekSummary] {
  guard !ws.isEmpty else { return [] }
  let current = isoWeekStart(today)
  var byWeek: [String: [Double]] = [:]
  for w in ws { byWeek[isoWeekStart(w.date), default: []].append(w.weightKg) }
  let starts = (Array(byWeek.keys) + [current]).sorted()
  var out: [WeekSummary] = []
  var previous: WeekSummary?
  var start = starts[0]
  while start <= starts[starts.count - 1] {
    let kgs = byWeek[start] ?? []
    let status: WeekSummary.Status =
      start >= current ? .inProgress : kgs.count >= minWeighings ? .valid : .insufficient
    let averageKg =
      status == .valid || (status == .inProgress && !kgs.isEmpty) ? mean(kgs) : nil
    // A loss compares two complete weeks only: a running average never enters it.
    let before = previous?.status == .valid ? previous?.averageKg : nil
    var lossPct: Double?
    if status == .valid, let averageKg, let before { lossPct = (before - averageKg) / before * 100 }
    let week = WeekSummary(
      start: start, end: addDays(start, 6), count: kgs.count, status: status,
      averageKg: averageKg, lossPct: lossPct)
    out.append(week)
    previous = week
    start = addDays(start, 7)
  }
  return out.reversed()
}
