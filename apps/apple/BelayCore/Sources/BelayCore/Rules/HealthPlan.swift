import Foundation

// Which sessions Health should hold, from the phone's own data: Belay's rules for Apple Health,
// kept here so the Health writer only carries them out. No clock, no storage. Only sessions:
// weigh-ins and sending the history come later, so history stays at "no" and only sessions
// ended after the switch went on, or already written, are eligible.

/// A session's key in the record, and its workout's sync identifier in Health, as the web's rule
/// and its writer have it: a session's id is unique, so it needs no account's tag.
public func sessionKey(_ id: String) -> String { "belay-session-\(id)" }

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

/// What this phone knows Health holds for a session: a workout at the values it wrote, one
/// skipped because another app's workout covers it, or one it removed. The version is the last
/// one written, so the next write is always greater.
public enum HealthWritten: Codable, Sendable, Equatable {
  case workout(version: Int64, startedAt: Int64, endedAt: Int64)
  case skipped(version: Int64, startedAt: Int64, endedAt: Int64)
  case removed(version: Int64)

  private enum CodingKeys: String, CodingKey { case state, version, startedAt, endedAt }

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
    case .removed(let version):
      try c.encode("removed", forKey: .state)
      try c.encode(version, forKey: .version)
    }
  }

  public var version: Int64 {
    switch self {
    case .workout(let v, _, _), .skipped(let v, _, _), .removed(let v): v
    }
  }

  private var isWorkout: Bool { if case .workout = self { true } else { false } }
}

/// What Health is asked to do: write a session's workout at a version, or remove it.
public enum HealthObject: Codable, Sendable, Equatable {
  case workout(id: String, startedAt: Int64, endedAt: Int64, version: Int64)
  case workoutRemoved(id: String)

  private enum CodingKeys: String, CodingKey { case kind, id, startedAt, endedAt, version }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    let id = try c.decode(String.self, forKey: .id)
    switch try c.decode(String.self, forKey: .kind) {
    case "workout":
      self = .workout(
        id: id, startedAt: try c.decode(Int64.self, forKey: .startedAt),
        endedAt: try c.decode(Int64.self, forKey: .endedAt),
        version: try c.decode(Int64.self, forKey: .version))
    case "workoutRemoved": self = .workoutRemoved(id: id)
    case let kind:
      throw DecodingError.dataCorruptedError(
        forKey: .kind, in: c, debugDescription: "not a session object: \(kind)")
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
    }
  }
}

/// The phone's data and Health's state, as the plan reads them. Times in ms since the epoch.
public struct HealthPlanInput: Sendable {
  public var workouts: [WorkoutRow]
  public var sets: [SetRow]
  /// The Santé switch.
  public var on: Bool
  /// When the switch went on; nil, no session is new since.
  public var turnedOnAt: Int64?
  /// By `sessionKey`.
  public var written: [String: HealthWritten]
  /// Whether iOS lets the app write workouts.
  public var allowed: Bool
  public var now: Int64
  /// `ownerOf` the account's id.
  public var owner: String

  public init(
    workouts: [WorkoutRow], sets: [SetRow], on: Bool, turnedOnAt: Int64?,
    written: [String: HealthWritten], allowed: Bool, now: Int64, owner: String
  ) {
    self.workouts = workouts
    self.sets = sets
    self.on = on
    self.turnedOnAt = turnedOnAt
    self.written = written
    self.allowed = allowed
    self.now = now
    self.owner = owner
  }
}

/// What Health takes: times from 1899-12-31 in UTC (08:00 on 1900-01-01, the earliest day Belay
/// keeps, east of UTC) to a day past the phone's clock, a workout of a day at most. A batch with
/// one object outside these is refused whole.
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

/// Always above the last version this phone wrote, even with a clock set back; otherwise the
/// latest time written on the row, which every device derives alike from the merged data.
public func versionOf(latest: Int64, last: Int64?) -> Int64 { max(latest, (last ?? 0) + 1) }

/// Every write and removal that would bring Health in line with the phone's sessions, in the
/// order the rows come.
public func planHealth(_ input: HealthPlanInput) -> [HealthObject] {
  guard input.on, input.allowed else { return [] }
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
