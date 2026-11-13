import Foundation

// Corps's state and its « Aujourd'hui » rows: pure functions of the body entries and the local
// day, so Corps and Accueil draw the same figures, and the Watch can read them. The words live
// with the screens; these carry the values and counts they say.

/// A day's value on a chart: a weigh-in, an average or a waist.
public struct Point: Sendable, Equatable {
  public var date: String
  public var value: Double

  public init(date: String, value: Double) {
    self.date = date
    self.value = value
  }
}

/// The trend once the 7-day average shows: the latest average, the last complete week's loss
/// (positive when losing; nil until two complete weeks follow each other), and whether that loss,
/// as shown to the tenth, sits in the person's range.
public struct TrendCardState: Sendable, Equatable {
  public var averageKg: Double
  public var lossPct: Double?
  /// Nil while there is no loss to judge.
  public var inRange: Bool?
  public var range: TargetRange
}

public enum CorpsState: Sendable, Equatable {
  /// At least 4 weigh-ins in the last 7 days.
  case usual(TrendCardState)
  /// Fewer: `count` is how many more the average needs, 1 to 4; `points` the month's weigh-ins.
  case early(count: Int, points: [Point])
  /// No weigh-in yet.
  case first
}

/// Today's weigh-in, and whether the Health import filled it and nobody changed it since.
public struct TodayWeighIn: Sendable, Equatable {
  public var kg: Double?
  public var fromHealth: Bool
}

/// The latest day measured up to today: its waist, else its neck, else its hips, as the web says.
public struct LastMeasure: Sendable, Equatable {
  public var field: MeasureField
  public var cm: Double
  public var date: String
}

/// Today's intake totals, each nil until typed.
public struct TodayIntake: Sendable, Equatable {
  public var kcal: Int?
  public var proteinG: Int?
}

/// Today's boxes ticked out of the supplements still on the list.
public struct TodaySupplements: Sendable, Equatable {
  public var taken: Int
  public var total: Int
}

/// The rows of « Aujourd'hui », on Corps and on Accueil.
public struct TodayRows: Sendable, Equatable {
  public var weighIn: TodayWeighIn
  /// Nil before any measure.
  public var measures: LastMeasure?
  public var intake: TodayIntake
  public var supplements: TodaySupplements
}

/// The weigh-ins as the body rules count them.
func weighings(_ body: BodyRead) -> [Weighing] {
  body.weights.compactMap { w in w.weightKg.map { Weighing(date: w.date, weightKg: $0) } }
}

/// The person's range, or the default before one is written.
func targetRange(_ body: BodyRead) -> TargetRange {
  body.target.map { TargetRange(minPct: $0.minPct, maxPct: $0.maxPct) } ?? defaultTarget
}

public func corpsState(_ body: BodyRead, health: HealthSettings, now: Date, timeZone: TimeZone)
  -> (CorpsState, TodayRows)
{
  let today = toISODate(now, timeZone: timeZone)
  return (
    trendState(body, today: today, now: now, timeZone: timeZone), todayRows(body, health, today)
  )
}

private func trendState(_ body: BodyRead, today: String, now: Date, timeZone: TimeZone)
  -> CorpsState
{
  let ws = weighings(body)
  if ws.isEmpty { return .first }
  // A weigh-in dated after today, after a time zone change, waits for its day.
  let weekAgo = addDays(today, -6)
  let recent = ws.filter { $0.date >= weekAgo && $0.date <= today }.count
  guard recent >= minWeighings, let average = latestMovingAverage(ws, today: today) else {
    let points = trendSeries(body, span: .month, now: now, timeZone: timeZone).points
    return .early(count: minWeighings - recent, points: points)
  }
  let range = targetRange(body)
  let lossPct = weeklySummaries(ws, today: today).first { $0.status != .inProgress }?.lossPct
  return .usual(
    TrendCardState(
      averageKg: average.averageKg, lossPct: lossPct,
      inRange: lossPct.map { inTargetRange($0, range) }, range: range))
}

private func todayRows(_ body: BodyRead, _ health: HealthSettings, _ today: String) -> TodayRows {
  let weight = body.weights.first { $0.date == today }
  let fromHealth = weight.map { health.filled[today]?.at == $0.at } ?? false
  let lastDay = body.measures.filter { $0.date <= today }.max { $0.date < $1.date }
  let measure = lastDay.flatMap { m in
    MeasureField.allCases.lazy.compactMap { field in
      m[field].cm.map { LastMeasure(field: field, cm: $0, date: m.date) }
    }.first
  }
  let intake = body.intake.first { $0.date == today }
  let listed = body.supplements.filter { !$0.removed }
  let ticked = Set(body.logs.filter { $0.date == today && $0.taken }.map(\.supplementId))
  return TodayRows(
    weighIn: TodayWeighIn(kg: weight?.weightKg, fromHealth: fromHealth),
    measures: measure,
    intake: TodayIntake(kcal: intake?.kcal, proteinG: intake?.proteinG),
    supplements: TodaySupplements(
      taken: listed.filter { ticked.contains($0.id) }.count, total: listed.count))
}
