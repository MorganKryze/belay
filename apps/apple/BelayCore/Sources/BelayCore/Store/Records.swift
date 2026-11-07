import Foundation

// What the store takes and gives besides the contract's rows.

/// The session open on this device: which one, the slot it shows and when its rest ends. Local
/// only, never sent: the sets are what syncs.
public struct ActiveSession: Codable, Sendable, Equatable {
  public var workoutId: String
  public var slotIndex: Int
  public var restEndsAt: String?

  public init(workoutId: String, slotIndex: Int, restEndsAt: String?) {
    self.workoutId = workoutId
    self.slotIndex = slotIndex
    self.restEndsAt = restEndsAt
  }
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
}
