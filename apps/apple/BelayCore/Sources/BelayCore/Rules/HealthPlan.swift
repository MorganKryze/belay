import Foundation

// Which sessions and weigh-ins Health should hold, from the phone's own data: Belay's rules for
// Apple Health, kept here so the Health writer only carries them out. No clock, no storage. The
// phone never sends the history, so only what is new since the switch went on, or already
// written, is eligible.

/// A session's key in the record, and its workout's sync identifier in Health, as the web's rule
/// and its writer have it: a session's id is unique, so it needs no account's tag.
public func sessionKey(_ id: String) -> String { "belay-session-\(id)" }

/// A weigh-in's key in the record: the record is the account's own, so it needs no owner.
public func weighingKey(_ date: String) -> String { "belay-weighing-\(date)" }

let weighingSyncIdPrefix = "belay-weighing-"

/// A weigh-in's sync identifier in Health, as the web app's writers give it: its day, tagged with
/// the account (`ownerOf`), so two accounts on one phone never replace each other's day.
public func weighingSyncId(owner: String, date: String) -> String {
  "\(weighingSyncIdPrefix)\(owner)-\(date)"
}

/// Health keeps one store for every app on the phone, and a weigh-in's sync identifier is its
/// day, so that one also carries this tag of the account's id. FNV-1a on 32 bits over UTF-16 units, as the web computes it: a clash
/// between the few accounts of one phone is a one in four billion chance.
public func ownerOf(_ userId: String) -> String {
  var hash: UInt32 = 0x811c_9dc5
  for unit in userId.utf16 {
    hash ^= UInt32(unit)
    hash = hash &* 0x0100_0193
  }
  let hex = String(hash, radix: 16)
  return String(repeating: "0", count: 8 - hex.count) + hex
}

// Times are milliseconds since the epoch in Int64: Int is 32 bits on the Watch.

/// What this phone knows Health holds for a session or a day: a workout or a weigh-in at the
/// values it wrote, a session skipped because another app's workout covers it, or one it removed.
/// The version is the last one written, so the next write is always greater.
public enum HealthWritten: Codable, Sendable, Equatable {
  case workout(version: Int64, startedAt: Int64, endedAt: Int64)
  case weighing(version: Int64, kg: Double)
  case skipped(version: Int64, startedAt: Int64, endedAt: Int64)
  case removed(version: Int64)

  private enum CodingKeys: String, CodingKey { case state, version, startedAt, endedAt, kg }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let version = try c.decode(Int64.self, forKey: .version)
    switch try c.decode(String.self, forKey: .state) {
    case "workout":
      self = .workout(
        version: version, startedAt: try c.decode(Int64.self, forKey: .startedAt),
        endedAt: try c.decode(Int64.self, forKey: .endedAt))
    case "skipped":
      self = .skipped(
        version: version, startedAt: try c.decode(Int64.self, forKey: .startedAt),
        endedAt: try c.decode(Int64.self, forKey: .endedAt))
    case "weighing": self = .weighing(version: version, kg: try c.decode(Double.self, forKey: .kg))
    case "removed": self = .removed(version: version)
    case let state:
      throw DecodingError.dataCorruptedError(
        forKey: .state, in: c, debugDescription: "not a written state: \(state)")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .workout(let version, let startedAt, let endedAt),
      .skipped(let version, let startedAt, let endedAt):
      try c.encode(self.isWorkout ? "workout" : "skipped", forKey: .state)
      try c.encode(version, forKey: .version)
      try c.encode(startedAt, forKey: .startedAt)
      try c.encode(endedAt, forKey: .endedAt)
    case .weighing(let version, let kg):
      try c.encode("weighing", forKey: .state)
      try c.encode(version, forKey: .version)
      try c.encode(kg, forKey: .kg)
    case .removed(let version):
      try c.encode("removed", forKey: .state)
      try c.encode(version, forKey: .version)
    }
  }

  public var version: Int64 {
    switch self {
    case .workout(let v, _, _), .skipped(let v, _, _), .weighing(let v, _), .removed(let v): v
    }
  }

  private var isWorkout: Bool { if case .workout = self { true } else { false } }
}

/// What Health is asked to do: write a session's workout or a day's weigh-in at a version, or
/// remove it. A weigh-in's `at` is its sample's time.
public enum HealthObject: Codable, Sendable, Equatable {
  case workout(id: String, startedAt: Int64, endedAt: Int64, version: Int64)
  case workoutRemoved(id: String)
  case weighing(owner: String, date: String, kg: Double, at: Int64, version: Int64)
  case weighingRemoved(owner: String, date: String)

  private enum CodingKeys: String, CodingKey {
    case kind, id, startedAt, endedAt, version, owner, date, kg, at
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    switch try c.decode(String.self, forKey: .kind) {
    case "workout":
      self = .workout(
        id: try c.decode(String.self, forKey: .id),
        startedAt: try c.decode(Int64.self, forKey: .startedAt),
        endedAt: try c.decode(Int64.self, forKey: .endedAt),
        version: try c.decode(Int64.self, forKey: .version))
    case "workoutRemoved": self = .workoutRemoved(id: try c.decode(String.self, forKey: .id))
    case "weighing":
      self = .weighing(
        owner: try c.decode(String.self, forKey: .owner),
        date: try c.decode(String.self, forKey: .date), kg: try c.decode(Double.self, forKey: .kg),
        at: try c.decode(Int64.self, forKey: .at),
        version: try c.decode(Int64.self, forKey: .version))
    case "weighingRemoved":
      self = .weighingRemoved(
        owner: try c.decode(String.self, forKey: .owner),
        date: try c.decode(String.self, forKey: .date))
    case let kind:
      throw DecodingError.dataCorruptedError(
        forKey: .kind, in: c, debugDescription: "not a Health object: \(kind)")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .workout(let id, let startedAt, let endedAt, let version):
      try c.encode("workout", forKey: .kind)
      try c.encode(id, forKey: .id)
      try c.encode(startedAt, forKey: .startedAt)
      try c.encode(endedAt, forKey: .endedAt)
      try c.encode(version, forKey: .version)
    case .workoutRemoved(let id):
      try c.encode("workoutRemoved", forKey: .kind)
      try c.encode(id, forKey: .id)
    case .weighing(let owner, let date, let kg, let at, let version):
      try c.encode("weighing", forKey: .kind)
      try c.encode(owner, forKey: .owner)
      try c.encode(date, forKey: .date)
      try c.encode(kg, forKey: .kg)
      try c.encode(at, forKey: .at)
      try c.encode(version, forKey: .version)
    case .weighingRemoved(let owner, let date):
      try c.encode("weighingRemoved", forKey: .kind)
      try c.encode(owner, forKey: .owner)
      try c.encode(date, forKey: .date)
    }
  }
}

/// The phone's data and Health's state, as the plan reads them. Times in ms since the epoch.
public struct HealthPlanInput: Sendable {
  public var workouts: [WorkoutRow]
  public var sets: [SetRow]
  /// A nil weight is a deleted day.
  public var weights: [WeightRow]
  /// The Santé switch.
  public var on: Bool
  /// When the switch went on; nil, no session is new since.
  public var turnedOnAt: Int64?
  /// By `sessionKey` and `weighingKey`.
  public var written: [String: HealthWritten]
  /// Whether iOS lets the app write workouts.
  public var allowed: Bool
  /// Whether iOS lets the app write body mass.
  public var allowedWeighIns: Bool
  public var now: Int64
  /// `ownerOf` the account's id.
  public var owner: String
  /// Where the person is: a weigh-in's day and the switch's day are read there.
  public var timeZone: TimeZone

  public init(
    workouts: [WorkoutRow], sets: [SetRow], on: Bool, turnedOnAt: Int64?,
    written: [String: HealthWritten], allowed: Bool, now: Int64, owner: String,
    weights: [WeightRow] = [], allowedWeighIns: Bool = false,
    timeZone: TimeZone = .current
  ) {
    self.workouts = workouts
    self.sets = sets
    self.weights = weights
    self.on = on
    self.turnedOnAt = turnedOnAt
    self.written = written
    self.allowed = allowed
    self.allowedWeighIns = allowedWeighIns
    self.now = now
    self.owner = owner
    self.timeZone = timeZone
  }
}

/// What Health takes: times from 1899-12-31 in UTC (08:00 on 1900-01-01, the earliest day Belay
/// keeps, east of UTC) to a day past the phone's clock, a workout of a day at most, a weigh-in of
/// 20 to 400 kg. A batch with one object outside these is refused whole.
public let healthEarliest: Int64 = -2_209_075_200_000
public let healthDay: Int64 = 86_400_000

private func isTime(_ t: Int64, now: Int64) -> Bool { t >= healthEarliest && t <= now + healthDay }

/// A session Health can hold: ended, still there, at least one set still there, and ending after
/// it starts (a workout needs a span). Nil for one in progress, removed or empty, and for a time
/// the phone cannot read, which only a server or contract at fault sends: that one session is
/// left out, as the web's NaN leaves it, rather than every run stopping on it.
public func finishedSpan(_ w: WorkoutRow, liveSets: Int) -> (startedAt: Int64, endedAt: Int64)? {
  guard let endedAt = w.endedAt, !w.removed, liveSets != 0,
    let start = Instant.milliseconds(w.startedAt), let end = Instant.milliseconds(endedAt)
  else { return nil }
  return end > start ? (start, end) : nil
}

/// The import stamps a weigh-in at the start of its day, and each earlier reading that replaces
/// it moves that stamp on by 1 ms (`importChoice`). Such a day is already in Health as the scale's
/// own sample, whichever device or app imported it; once the person changes it, its time moves off
/// the stamp and it goes to Health like a typed one. A second holds far more replacements than a
/// day has readings, and nobody types a weigh-in in the first second of a day.
public let importStampMs: Int64 = 1000

func isImportStamp(_ r: WeightRow, timeZone: TimeZone) -> Bool {
  let parts = r.date.split(separator: "-").compactMap { Int($0) }
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = timeZone
  guard parts.count == 3, let at = Instant.milliseconds(r.at),
    let start = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
  else { return false }
  let offset = at - Instant.milliseconds(start)
  return offset >= 0 && offset < importStampMs
}

/// Always above the last version this phone wrote, even with a clock set back; otherwise the
/// latest time written on the row, which every device derives alike from the merged data.
public func versionOf(latest: Int64, last: Int64?) -> Int64 { max(latest, (last ?? 0) + 1) }

/// A weigh-in has a day and no time: 08:00 on that day where the person is, or now when that is
/// earlier, so no sample is ever in the future.
public func sampleTime(_ date: String, now: Int64, timeZone: TimeZone) -> Int64 {
  let parts = date.split(separator: "-").compactMap { Int($0) }
  var calendar = Calendar(identifier: .gregorian)
  calendar.timeZone = timeZone
  guard parts.count == 3,
    let eight = calendar.date(
      from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 8))
  else { return now }
  return min(Instant.milliseconds(eight), now)
}

/// Every write and removal that would bring Health in line with the phone's sessions and
/// weigh-ins, in the order the rows come: sessions first, then weigh-ins.
public func planHealth(_ input: HealthPlanInput) -> [HealthObject] {
  guard input.on else { return [] }
  return (input.allowed ? planWorkouts(input) : [])
    + (input.allowedWeighIns ? planWeighIns(input) : [])
}

private func planWeighIns(_ input: HealthPlanInput) -> [HealthObject] {
  let fromDay =
    input.turnedOnAt.map { toISODate(Date(ms: $0), timeZone: input.timeZone) } ?? "9999-12-31"
  var objects: [HealthObject] = []
  for r in input.weights where !isImportStamp(r, timeZone: input.timeZone) {
    let kept = input.written[weighingKey(r.date)]
    let at = sampleTime(r.date, now: input.now, timeZone: input.timeZone)
    if let kg = r.weightKg, kg >= Bounds.weighInKgMin, kg <= Bounds.weighInKgMax,
      isTime(at, now: input.now)
    {
      if r.date < fromDay && kept == nil { continue }
      if case .weighing(_, kg) = kept { continue }
      let latest = Instant.milliseconds(r.at) ?? 0
      objects.append(
        .weighing(
          owner: input.owner, date: r.date, kg: kg, at: at,
          version: versionOf(latest: latest, last: kept?.version)))
    } else if case .weighing = kept {
      objects.append(.weighingRemoved(owner: input.owner, date: r.date))
    }
  }
  return objects
}

private func planWorkouts(_ input: HealthPlanInput) -> [HealthObject] {
  let from = input.turnedOnAt ?? .max
  var live: [String: Int] = [:]
  for s in input.sets where !s.removed { live[s.workoutId, default: 0] += 1 }
  var objects: [HealthObject] = []
  for w in input.workouts {
    let kept = input.written[sessionKey(w.id)]
    let finished = finishedSpan(w, liveSets: live[w.id] ?? 0)
    // Ahead of the phone's clock, most likely a clock set back: it waits for the clock, and the
    // one Health holds stays as it is.
    if let finished, finished.endedAt > input.now + healthDay { continue }
    // One Health would refuse is no session for it: left out, or removed if it was written.
    if let span = finished, isTime(span.startedAt, now: input.now),
      isTime(span.endedAt, now: input.now), span.endedAt - span.startedAt <= healthDay
    {
      // Eligible: new since the switch went on, and always what this phone already wrote, so
      // its edits follow.
      if span.endedAt < from && kept == nil { continue }
      switch kept {
      case .workout(_, span.startedAt, span.endedAt), .skipped(_, span.startedAt, span.endedAt):
        continue
      default: break
      }
      let latest = [w.startedAt, w.startedAtAt, w.endedAt, w.endedAtAt, w.removedAt]
        .compactMap { $0.flatMap(Instant.milliseconds) }.max() ?? 0
      objects.append(
        .workout(
          id: w.id, startedAt: span.startedAt, endedAt: span.endedAt,
          version: versionOf(latest: latest, last: kept?.version)))
    } else if case .workout = kept {
      objects.append(.workoutRemoved(id: w.id))
    }
  }
  return objects
}
