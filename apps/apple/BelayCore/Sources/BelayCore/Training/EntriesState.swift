import Foundation

// The states of the screens Corps pushes (Tes semaines, Apports, Compléments, Mensurations), each
// a pure function of the body entries and the local day.

// MARK: Tes semaines

/// One week of « Tes semaines »: its weigh-ins and loss, whether the loss sits in the range, the
/// annotations that fall in it and its average calories.
public struct WeekRow: Sendable, Equatable {
  public var summary: WeekSummary
  /// Nil while the week has no loss to judge.
  public var inRange: Bool?
  public var annotations: [AnnotationMark]
  /// The average of the week's days with calories, rounded as the web rounds it; nil when no day
  /// has any.
  public var kcalAvg: Double?

  /// The week still running, which reads « à suivre ».
  public var isCurrent: Bool { summary.status == .inProgress }
}

/// Every week from the first weigh-in's to today's, newest first.
public func weeks(_ body: BodyRead, now: Date, timeZone: TimeZone) -> [WeekRow] {
  let today = toISODate(now, timeZone: timeZone)
  let range = targetRange(body)
  let marks = annotationMarks(body)
  return weeklySummaries(weighings(body), today: today).map { week in
    WeekRow(
      summary: week, inRange: week.lossPct.map { inTargetRange($0, range) },
      annotations: marks.filter { $0.date >= week.start && $0.date <= week.end },
      kcalAvg: weeklyIntake(body.intake, weekStart: week.start).kcalAvg?.rounded())
  }
}

// MARK: Apports

/// Apports: today's totals against the tools' figures, and the days before.
public struct IntakeState: Sendable, Equatable {
  public var today: TodayIntake
  /// The day's expenditure by the Dépense énergétique tool; nil while the profile lacks its
  /// formula, birth year or height, or no weigh-in gives a weight.
  public var kcalFigure: Double?
  /// The Protéines tool's range; nil without a weigh-in.
  public var protein: ProteinRange?
  /// The range's middle, rounded to 5 g.
  public var proteinFigure: Double?
  /// The days before today with a total, newest first.
  public var previous: [IntakeRow]
}

/// What the tools open on from the entries, read on the local day: the profile, the 7-day
/// average or the last weigh-in, the last measures.
public func toolDefaults(_ body: BodyRead, now: Date, timeZone: TimeZone) -> ToolDefaults {
  let profile =
    body.profile
    ?? ProfileRow(
      formula: nil, formulaAt: nil, birthYear: nil, birthYearAt: nil, heightCm: nil,
      heightAt: nil)
  return toolDefaults(
    profile: profile, weighings: weighings(body), measures: body.measures,
    today: toISODate(now, timeZone: timeZone))
}

/// `pal` and `goal` are the ones chosen in Dépense énergétique and Protéines on this phone
/// (`ToolMemory.pal`, `.goal`), so Apports reads the figures those tools show.
public func intakeState(
  _ body: BodyRead, pal: Double, goal: ProteinGoal, now: Date, timeZone: TimeZone
) -> IntakeState {
  let today = toISODate(now, timeZone: timeZone)
  let tool = toolDefaults(body, now: now, timeZone: timeZone)
  var kcal: Double?
  var protein: ProteinRange?
  // `toolDefaults` keeps every value inside the tools' ranges, so neither tool can refuse it.
  if let weight = tool.weightKg?.value {
    if let formula = tool.formula?.value, let age = tool.ageYears?.value,
      let height = tool.heightCm?.value
    {
      let input = MifflinInput(formula: formula, ageYears: age, heightCm: height, weightKg: weight)
      kcal = try? dailyEnergy(input, pal: pal).dayKcal
    }
    protein = try? proteinRange(weight, goal: goal)
  }
  let day = body.intake.first { $0.date == today }
  return IntakeState(
    today: TodayIntake(kcal: day?.kcal, proteinG: day?.proteinG),
    kcalFigure: kcal, protein: protein,
    proteinFigure: protein.map { roundTo(($0.lowG + $0.highG) / 2, step: 5) },
    previous: body.intake.filter { $0.date < today }.sorted { $0.date > $1.date })
}

// MARK: Compléments

/// A supplement of the list and today's box.
public struct SupplementToday: Sendable, Equatable {
  public var id: String
  public var name: String
  public var kind: SupplementKind
  public var taken: Bool
  /// Creatine ticked today: the day of its course, 1 on the first; nil otherwise.
  public var creatineDay: Int?
}

/// The supplements still on the list, in its order, with today's boxes.
public func supplementsToday(_ body: BodyRead, now: Date, timeZone: TimeZone) -> [SupplementToday]
{
  let today = toISODate(now, timeZone: timeZone)
  let ticked = Set(body.logs.filter { $0.date == today && $0.taken }.map(\.supplementId))
  let course = creatineWindows(creatineDays(body), today: today)
    .first { $0.start <= today && today <= $0.end }
  return body.supplements.filter { !$0.removed }.map { s in
    let taken = ticked.contains(s.id)
    return SupplementToday(
      id: s.id, name: s.name, kind: s.kind, taken: taken,
      creatineDay: s.kind == .creatine && taken
        ? course.map { daysBetween($0.start, today) + 1 } : nil)
  }
}

/// Whole days from `a` to `b`, counted on UTC midnights as the body rules count them.
private func daysBetween(_ a: String, _ b: String) -> Int {
  var n = 0
  while addDays(a, n) < b { n += 1 }
  return n
}

// MARK: Mensurations

/// Mensurations: the last waist, its change since the first, its curve, and every day measured.
public struct MeasuresState: Sendable, Equatable {
  public var waist: LatestMeasure?
  public var first: LatestMeasure?
  /// The last waist minus the first, to 0.1 cm; nil with fewer than two.
  public var changeCm: Double?
  /// The waists by day.
  public var curve: [Point]
  /// The days measured up to today, newest first.
  public var history: [MeasureRow]
}

public func measuresState(_ body: BodyRead, now: Date, timeZone: TimeZone) -> MeasuresState {
  let today = toISODate(now, timeZone: timeZone)
  let past = body.measures.filter { $0.date <= today }.sorted { $0.date < $1.date }
  let curve = past.compactMap { m in m.waistCm.map { Point(date: m.date, value: $0) } }
  let waist = latestMeasures(past)[.waist]
  let first = curve.first.map { LatestMeasure(cm: $0.value, date: $0.date) }
  let change: Double? =
    if let waist, let first, curve.count > 1 { roundTo(waist.cm - first.cm, step: 0.1) } else {
      nil
    }
  return MeasuresState(
    waist: waist, first: first, changeCm: change, curve: curve, history: past.reversed())
}
