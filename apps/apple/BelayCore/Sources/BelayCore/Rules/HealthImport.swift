public import Foundation

// Weigh-ins read from Apple Health (a connected scale, the Health app itself) fill the days Belay
// has no weigh-in for, then sync like typed ones: the web's import rules, ported. They run after a
// landed sync only, so the phone holds what the other devices wrote. No clock, no storage.

/// A body-mass reading from Health, in ms since the epoch and kilograms. `syncId` is the sync
/// identifier the writing app gave it, if any: Belay's own carry `weighingSyncId`'s prefix.
public struct HealthSample: Codable, Sendable, Equatable {
  public var startedAt: Int64
  public var kg: Double
  public var syncId: String?

  public init(startedAt: Int64, kg: Double, syncId: String? = nil) {
    self.startedAt = startedAt
    self.kg = kg
    self.syncId = syncId
  }

  /// A weigh-in Belay wrote, from this phone or another of the person's: reading it back would
  /// count it twice.
  var isBelays: Bool { syncId?.hasPrefix(weighingSyncIdPrefix) ?? false }
}

/// A day the import filled: the `at` it wrote, which an edit in Belay changes, and the reading's
/// time, which an earlier reading may replace.
public struct Filled: Codable, Sendable, Equatable {
  public var at: String
  public var startedAt: Int64

  public init(at: String, startedAt: Int64) {
    self.at = at
    self.startedAt = startedAt
  }
}

/// Per local day from `fromDay` on, the earliest reading in Belay's range once rounded to 0.1 kg:
/// a reading outside 20 to 400 kg is no weigh-in of the person's.
public func earliestPerDay(_ samples: [HealthSample], fromDay: String, timeZone: TimeZone)
  -> [String: HealthSample]
{
  var days: [String: HealthSample] = [:]
  for s in samples {
    let kg = jsRound(s.kg * 10) / 10
    let date = toISODate(Date(ms: s.startedAt), timeZone: timeZone)
    guard isWeighingKg(kg), date >= fromDay else { continue }
    if let kept = days[date], kept.startedAt <= s.startedAt { continue }
    days[date] = HealthSample(startedAt: s.startedAt, kg: kg)
  }
  return days
}

/// The weigh-ins the import writes, by date: a day with no row gets its reading; a day this import
/// filled, untouched since, takes an earlier reading; anything the person did (a weigh-in typed
/// here or elsewhere, an edit, a deletion) stays. A filled weigh-in is stamped at the start of its
/// local day, or just after the import's own stamp it replaces, so a weigh-in typed for that day,
/// here or on a device still offline, is later and wins the merge.
public func importChoice(
  _ days: [String: HealthSample], rows: [String: WeightRow], filled: [String: Filled],
  today: String, now: Date, timeZone: TimeZone
) -> [WeightChange] {
  var changes: [WeightChange] = []
  for (date, reading) in days.sorted(by: { $0.key < $1.key }) {
    // A reading dated after today waits for its day; one days ahead is dropped like a value out
    // of range (`importWaits`).
    guard date <= today else { continue }
    let row = rows[date]
    let mine = filled[date]
    let replaces =
      if let row, row.weightKg != nil, let mine, mine.at == row.at,
        reading.startedAt < mine.startedAt
      { true } else { false }
    if row != nil && !replaces { continue }
    let at =
      if replaces, let mine, let ms = Instant.milliseconds(mine.at) {
        Instant.string(ms: ms + 1)
      } else {
        Instant.string(localDayStart(reading.startedAt, timeZone: timeZone))
      }
    let change = WeightChange(date: date, weightKg: reading.kg, at: at)
    guard isValid(.weight(change), now: now, timeZone: timeZone) else { continue }
    changes.append(change)
  }
  return changes
}

/// Whether a reading dated after today, within a day of the clock (a clock set ahead elsewhere),
/// waits for its day: Health is then read again from the same place until it comes.
func importWaits(_ days: [String: HealthSample], today: String, now: Date) -> Bool {
  let limit = Instant.milliseconds(now) + healthDay
  return days.contains { $0.key > today && $0.value.startedAt <= limit }
}

/// The local midnight of the day `ms` falls on.
private func localDayStart(_ ms: Int64, timeZone: TimeZone) -> Date {
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = timeZone
  return calendar.startOfDay(for: Date(ms: ms))
}

extension Date {
  init(ms: Int64) { self.init(timeIntervalSince1970: Double(ms) / 1000) }
}
