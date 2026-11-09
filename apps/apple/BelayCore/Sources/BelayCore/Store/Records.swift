import Foundation

// What the store takes and gives besides the contract's rows.

/// The session open on this device: which one, the slot it shows and when its rest ends. Local
/// only, never sent: the sets are what syncs. The pause, a running chrono and the values chosen
/// for the next set stay here too, so a relaunch shows them as they were; a row written before
/// they existed reads them as absent.
public struct ActiveSession: Codable, Sendable, Equatable {
  public var workoutId: String
  public var slotIndex: Int
  public var restEndsAt: String?
  /// Since when the session is paused; nil while it runs.
  public var pausedAt: String?
  public var chrono: Chrono?
  public var draft: SetDraft?

  public init(
    workoutId: String, slotIndex: Int, restEndsAt: String?, pausedAt: String? = nil,
    chrono: Chrono? = nil, draft: SetDraft? = nil
  ) {
    self.workoutId = workoutId
    self.slotIndex = slotIndex
    self.restEndsAt = restEndsAt
    self.pausedAt = pausedAt
    self.chrono = chrono
    self.draft = draft
  }
}

/// A place of a session: its slot and its position (warm-ups 0 to 2, work sets from 3).
public struct SetPlace: Codable, Sendable, Hashable {
  public var slotIndex: Int
  public var position: Int

  public init(slotIndex: Int, position: Int) {
    self.slotIndex = slotIndex
    self.position = position
  }
}

/// A timed set being held: the seconds it counts down from and its absolute end, so a relaunch
/// reads the right time left. Once stopped, `seconds` is the time held and `endsAt` the stop.
public struct Chrono: Codable, Sendable, Equatable {
  public var slotIndex: Int
  public var position: Int
  public var seconds: Int
  public var endsAt: String

  public init(slotIndex: Int, position: Int, seconds: Int, endsAt: String) {
    self.slotIndex = slotIndex
    self.position = position
    self.seconds = seconds
    self.endsAt = endsAt
  }

  public var place: SetPlace { SetPlace(slotIndex: slotIndex, position: position) }
}

/// The load and count chosen for the set at a place before it is logged; nil keeps the prefill.
/// A draft past the plan is a set the person added.
public struct SetDraft: Codable, Sendable, Equatable {
  public var slotIndex: Int
  public var position: Int
  public var weightKg: Double?
  public var count: Int?

  public init(slotIndex: Int, position: Int, weightKg: Double?, count: Int?) {
    self.slotIndex = slotIndex
    self.position = position
    self.weightKg = weightKg
    self.count = count
  }

  public var place: SetPlace { SetPlace(slotIndex: slotIndex, position: position) }
}

/// What a write does to the open session, in the same transaction.
public enum ActiveUpdate: Sendable, Equatable {
  case keep
  case clear
  case set(ActiveSession)
}

/// A queued change: its place in the queue, the bytes it is sent as, and what they say.
public struct OutboxEntry: Sendable, Equatable {
  public let id: Int64
  public let bytes: Data
  public let change: Change
}

/// A change the server refused: out of the queue, kept until the person has read about it.
public struct RejectedEntry: Sendable, Equatable {
  public let id: Int64
  public let change: Change
  /// As the server wrote it (see `Rejected`).
  public let reason: String
}

/// A set as a tick records it; the store makes it a creation, or a correction of the set already
/// at that place.
public struct SetInput: Sendable, Equatable {
  public var id: String
  public var workoutId: String
  public var slotIndex: Int
  public var position: Int
  public var exerciseId: String
  public var warmup: Bool
  public var values: SetValues
  public var doneAt: String

  public init(
    id: String, workoutId: String, slotIndex: Int, position: Int, exerciseId: String,
    warmup: Bool, values: SetValues, doneAt: String
  ) {
    self.id = id
    self.workoutId = workoutId
    self.slotIndex = slotIndex
    self.position = position
    self.exerciseId = exerciseId
    self.warmup = warmup
    self.values = values
    self.doneAt = doneAt
  }
}

/// A session the person asks to start.
public struct WorkoutStart: Sendable, Equatable {
  public var id: String
  public var at: String
  public var start: WorkoutChange.Start

  public init(id: String, at: String, start: WorkoutChange.Start) {
    self.id = id
    self.at = at
    self.start = start
  }

  public var change: WorkoutChange { WorkoutChange(id: id, at: at, edit: .start(start)) }
}

/// Why the store would not take a write.
public enum StoreError: Error, Sendable, Equatable {
  /// Outside the contract: the server would refuse it, and a refused change blocks the queue.
  case invalidChange
  /// An effort off the five floors.
  case invalidEffort
}
