import Foundation

// The rows the server sends back, for the kinds the native app keeps. Each field has its own
// time, the time it was last written, nil when it never was.

/// A session as stored. Its plan and start were written with the start: `planAt` and
/// `startedAtAt` stay nil until the session changes them.
public struct WorkoutRow: Codable, Sendable, Equatable {
  public var id: String
  public var sessionCode: String
  /// Absent from an older server.
  public var sessionId: Nullable<String>
  /// Absent: not kept with its start, so the session's current name shows.
  public var sessionName: Nullable<String>
  public var plan: [Slot]
  public var planAt: String?
  public var startedAt: String
  public var startedAtAt: String?
  /// Nil while the session is in progress.
  public var endedAt: String?
  public var endedAtAt: String?
  public var note: String?
  public var noteAt: String?
  /// Empty when never written.
  public var exerciseNotes: [String: String]
  public var exerciseNotesAt: String?
  public var removed: Bool
  public var removedAt: String?
  /// The plan as the server sent it, keys this build does not know included.
  var serverPlan = ServerPlan()

  /// The plan's JSON as the server sent it, while `plan` still reads the same from it: the server
  /// merges a plan as one field, so a plan the phone sends back unchanged must keep the keys a
  /// newer version wrote. Nil once the phone changed the plan, or for a plan it wrote itself.
  public var planJSON: Data? {
    guard let raw = serverPlan.json, let bytes = try? JSONEncoder().encode(raw),
      (try? JSONDecoder().decode([Slot].self, from: bytes)) == plan
    else { return nil }
    return bytes
  }
}

/// The server's plan carried beside the typed one. Equal whatever it holds: two rows are the same
/// row when their fields are, whichever bytes brought the plan.
struct ServerPlan: Sendable, Equatable {
  var json: JSONValue?

  static func == (_: ServerPlan, _: ServerPlan) -> Bool { true }
}

extension WorkoutRow {
  private enum CodingKeys: String, CodingKey {
    case id, sessionCode, sessionId, sessionName, plan, planAt, startedAt, startedAtAt, endedAt
    case endedAtAt, note, noteAt, exerciseNotes, exerciseNotesAt, removed, removedAt
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    id = try c.decode(String.self, forKey: .id)
    sessionCode = try c.decode(String.self, forKey: .sessionCode)
    sessionId = try c.decode(Nullable<String>.self, forKey: .sessionId)
    sessionName = try c.decode(Nullable<String>.self, forKey: .sessionName)
    plan = try c.decode([Slot].self, forKey: .plan)
    serverPlan = ServerPlan(json: try c.decode(JSONValue.self, forKey: .plan))
    planAt = try c.decodeIfPresent(String.self, forKey: .planAt)
    startedAt = try c.decode(String.self, forKey: .startedAt)
    startedAtAt = try c.decodeIfPresent(String.self, forKey: .startedAtAt)
    endedAt = try c.decodeIfPresent(String.self, forKey: .endedAt)
    endedAtAt = try c.decodeIfPresent(String.self, forKey: .endedAtAt)
    note = try c.decodeIfPresent(String.self, forKey: .note)
    noteAt = try c.decodeIfPresent(String.self, forKey: .noteAt)
    exerciseNotes = try c.decode([String: String].self, forKey: .exerciseNotes)
    exerciseNotesAt = try c.decodeIfPresent(String.self, forKey: .exerciseNotesAt)
    removed = try c.decode(Bool.self, forKey: .removed)
    removedAt = try c.decodeIfPresent(String.self, forKey: .removedAt)
  }

  /// As the server writes a row: unwritten times as null, the server's plan as it came.
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(id, forKey: .id)
    try c.encode(sessionCode, forKey: .sessionCode)
    try c.encode(sessionId, forKey: .sessionId)
    try c.encode(sessionName, forKey: .sessionName)
    if planJSON != nil, let raw = serverPlan.json {
      try c.encode(raw, forKey: .plan)
    } else {
      try c.encode(plan, forKey: .plan)
    }
    try c.encode(planAt, forKey: .planAt)
    try c.encode(startedAt, forKey: .startedAt)
    try c.encode(startedAtAt, forKey: .startedAtAt)
    try c.encode(endedAt, forKey: .endedAt)
    try c.encode(endedAtAt, forKey: .endedAtAt)
    try c.encode(note, forKey: .note)
    try c.encode(noteAt, forKey: .noteAt)
    try c.encode(exerciseNotes, forKey: .exerciseNotes)
    try c.encode(exerciseNotesAt, forKey: .exerciseNotesAt)
    try c.encode(removed, forKey: .removed)
    try c.encode(removedAt, forKey: .removedAt)
  }
}

/// One set as done; its exercise is the one really done.
public struct SetRow: Codable, Sendable, Equatable {
  public var id: String
  public var workoutId: String
  public var slotIndex: Int
  public var position: Int
  public var exerciseId: String
  public var warmup: Bool
  public var weightKg: Double
  public var reps: Int?
  public var seconds: Int?
  public var rir: Int?
  public var doneAt: String
  public var fieldsAt: String
  public var removed: Bool
  public var removedAt: String?
}

/// When a program's sessions come: in turn, or on fixed days of the week.
public struct Schedule: Codable, Sendable, Equatable {
  public enum Mode: RawRepresentable, Codable, Sendable, Hashable {
    case rotation, fixed
    /// A mode this version does not know, as the server wrote it (see `Measure`).
    case unknown(String)

    public init(rawValue: String) {
      switch rawValue {
      case "rotation": self = .rotation
      case "fixed": self = .fixed
      default: self = .unknown(rawValue)
      }
    }

    public var rawValue: String {
      switch self {
      case .rotation: "rotation"
      case .fixed: "fixed"
      case .unknown(let raw): raw
      }
    }
  }
  public var mode: Mode
  /// A session id or nil per day, Monday first.
  public var days: [String?]
}

public struct ProgramRow: Codable, Sendable, Equatable {
  public var id: String
  public var name: String?
  public var nameAt: String?
  public var schedule: Schedule
  public var scheduleAt: String?
  public var removed: Bool
  public var removedAt: String?
}

public struct ActiveProgramRow: Codable, Sendable, Equatable {
  public var programId: String
  public var at: String?
}

/// A session of a program, or set aside (no program), at its position there.
public struct ProgramSessionRow: Codable, Sendable, Equatable {
  public var id: String
  public var name: String?
  public var nameAt: String?
  public var programId: String?
  public var position: Int
  public var placeAt: String?
  public var removed: Bool
  public var removedAt: String?
}

public struct ProgramSlotRow: Codable, Sendable, Equatable {
  public var id: String
  public var sessionId: String
  public var position: Int
  public var positionAt: String?
  public var exerciseId: String
  /// Nil: counted in repetitions.
  public var measure: Measure?
  public var exerciseAt: String?
  public var repRange: [Int]
  public var repsAt: String?
  public var sets: Int
  public var setsAt: String?
  public var rirTarget: [Int]
  public var rirAt: String?
  public var restSec: Int
  public var restAt: String?
  public var warmupSets: Int
  public var warmupsAt: String?
  public var isMain: Bool
  public var mainAt: String?
  public var groupKey: String?
  public var groupAt: String?
  public var rule: SlotRule?
  public var ruleAt: String?
  public var removed: Bool
  public var removedAt: String?
}

/// An activity, only what the plan reads: a climbing day leaves session C's climbing rule out.
public struct ActivityRow: Codable, Sendable, Equatable {
  public var id: String
  /// The local day, `YYYY-MM-DD`.
  public var date: String
  /// `cardio` or `climbing`.
  public var kind: String
  public var removed: Bool

  private enum CodingKeys: String, CodingKey {
    case id, date
    case kind = "type"
    case removed
  }
}
