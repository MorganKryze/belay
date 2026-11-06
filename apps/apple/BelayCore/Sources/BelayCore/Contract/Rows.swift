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
  public enum Mode: String, Codable, Sendable { case rotation, fixed }
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
