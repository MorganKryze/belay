import Foundation

/// A field the web may leave out, write as null, or write with a value: three different things
/// to the server (an older phone's start has no session name; null means it had none).
public enum Nullable<Wrapped: Sendable & Equatable>: Sendable, Equatable {
  case absent
  case null
  case value(Wrapped)

  /// The value, nil when absent or null.
  public var value: Wrapped? {
    if case .value(let wrapped) = self { return wrapped }
    return nil
  }
}

extension Nullable: Encodable where Wrapped: Encodable {
  // Only reached when present: the keyed overload below leaves an absent value out.
  public func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    if case .value(let wrapped) = self { try c.encode(wrapped) } else { try c.encodeNil() }
  }
}

extension Nullable: Decodable where Wrapped: Decodable {
  public init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    self = c.decodeNil() ? .null : .value(try c.decode(Wrapped.self))
  }
}

// Synthesized coding picks these for a Nullable property, so a missing key reads as absent and
// an absent value writes no key.
extension KeyedDecodingContainer {
  func decode<T: Decodable>(_ type: Nullable<T>.Type, forKey key: Key) throws -> Nullable<T> {
    guard contains(key) else { return .absent }
    return try decodeNil(forKey: key) ? .null : .value(decode(T.self, forKey: key))
  }
}

extension KeyedEncodingContainer {
  mutating func encode<T: Encodable>(_ value: Nullable<T>, forKey key: Key) throws {
    switch value {
    case .absent: return
    case .null: try encodeNil(forKey: key)
    case .value(let wrapped): try encode(wrapped, forKey: key)
    }
  }
}

/// One change the phone queues and sends to `/api/sync`, for the kinds the native app writes.
public enum Change: Codable, Sendable, Equatable {
  case workout(WorkoutChange)
  case set(SetChange)

  private enum Kind: String, Codable { case workout, set }
  private enum KindKey: String, CodingKey { case kind }

  public init(from decoder: any Decoder) throws {
    switch try decoder.container(keyedBy: KindKey.self).decode(Kind.self, forKey: .kind) {
    case .workout: self = .workout(try WorkoutChange(from: decoder))
    case .set: self = .set(try SetChange(from: decoder))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .workout(let change): try change.encode(to: encoder)
    case .set(let change): try change.encode(to: encoder)
    }
  }
}

/// The JSON a change is queued and sent as.
public enum ChangeJSON {
  /// The change's bytes, equal as JSON to what the web writes for it. The queue keeps these
  /// bytes and sends them as they are.
  public static func encode(_ change: Change) throws -> Data {
    let encoder = JSONEncoder()
    // JSON.stringify leaves "/" alone; ids of the library are not made of it, but notes may be.
    encoder.outputFormatting = [.withoutEscapingSlashes]
    return try encoder.encode(change)
  }

  public static func decode(_ data: Data) throws -> Change {
    try JSONDecoder().decode(Change.self, from: data)
  }
}

/// The keys of every change; each kind reads the ones its field carries.
private enum Key: String, CodingKey {
  case kind, id, field, at, value
  case sessionCode, sessionId, sessionName, plan, startedAt
  case workoutId, slotIndex, position, exerciseId, warmup, weightKg, reps, seconds, rir, doneAt
}

private func unknownField(_ field: String, _ c: KeyedDecodingContainer<Key>) -> DecodingError {
  .dataCorruptedError(forKey: .field, in: c, debugDescription: "no field \(field) in the contract")
}

/// A session: its start carries the code, plan and start time, written once; every other field
/// is merged on its own.
public struct WorkoutChange: Codable, Sendable, Equatable {
  public var id: String
  public var at: String
  public var edit: Edit

  public struct Start: Sendable, Equatable {
    public var sessionCode: String
    /// The program session it came from; absent from an older phone's start.
    public var sessionId: Nullable<String>
    /// That session's name on the day: null when it had none, absent from an older phone.
    public var sessionName: Nullable<String>
    public var plan: [Slot]
    public var startedAt: String

    public init(
      sessionCode: String, sessionId: Nullable<String>, sessionName: Nullable<String>,
      plan: [Slot], startedAt: String
    ) {
      self.sessionCode = sessionCode
      self.sessionId = sessionId
      self.sessionName = sessionName
      self.plan = plan
      self.startedAt = startedAt
    }
  }

  public enum Edit: Sendable, Equatable {
    case start(Start)
    case plan([Slot])
    case startedAt(String)
    /// Nil reopens the session.
    case ended(String?)
    /// Nil clears the note.
    case note(String?)
    /// By slot index, "0" to "29".
    case exerciseNotes([String: String])
    case removed(Bool)
  }

  public init(id: String, at: String, edit: Edit) {
    self.id = id
    self.at = at
    self.edit = edit
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    id = try c.decode(String.self, forKey: .id)
    at = try c.decode(String.self, forKey: .at)
    let field = try c.decode(String.self, forKey: .field)
    switch field {
    case "start":
      edit = .start(
        Start(
          sessionCode: try c.decode(String.self, forKey: .sessionCode),
          sessionId: try c.decode(Nullable<String>.self, forKey: .sessionId),
          sessionName: try c.decode(Nullable<String>.self, forKey: .sessionName),
          plan: try c.decode([Slot].self, forKey: .plan),
          startedAt: try c.decode(String.self, forKey: .startedAt)))
    case "plan": edit = .plan(try c.decode([Slot].self, forKey: .value))
    case "startedAt": edit = .startedAt(try c.decode(String.self, forKey: .value))
    case "ended": edit = .ended(try c.decodeNullable(String.self, forKey: .value))
    case "note": edit = .note(try c.decodeNullable(String.self, forKey: .value))
    case "exerciseNotes": edit = .exerciseNotes(try c.decode([String: String].self, forKey: .value))
    case "removed": edit = .removed(try c.decode(Bool.self, forKey: .value))
    default: throw unknownField(field, c)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("workout", forKey: .kind)
    try c.encode(id, forKey: .id)
    switch edit {
    case .start(let start):
      try c.encode("start", forKey: .field)
      try c.encode(start.sessionCode, forKey: .sessionCode)
      try c.encode(start.sessionId, forKey: .sessionId)
      try c.encode(start.sessionName, forKey: .sessionName)
      try c.encode(start.plan, forKey: .plan)
      try c.encode(start.startedAt, forKey: .startedAt)
    case .plan(let plan):
      try c.encode("plan", forKey: .field)
      try c.encode(plan, forKey: .value)
    case .startedAt(let time):
      try c.encode("startedAt", forKey: .field)
      try c.encode(time, forKey: .value)
    case .ended(let time):
      try c.encode("ended", forKey: .field)
      try c.encode(time, forKey: .value)
    case .note(let note):
      try c.encode("note", forKey: .field)
      try c.encode(note, forKey: .value)
    case .exerciseNotes(let notes):
      try c.encode("exerciseNotes", forKey: .field)
      try c.encode(notes, forKey: .value)
    case .removed(let removed):
      try c.encode("removed", forKey: .field)
      try c.encode(removed, forKey: .value)
    }
    try c.encode(at, forKey: .at)
  }
}

/// A set's load, count and RIR, which change together. It counts repetitions or seconds, never
/// both.
public struct SetValues: Sendable, Equatable {
  /// Added load for a bodyweight exercise; 0 for none.
  public var weightKg: Double
  /// Nil for a timed set.
  public var reps: Int?
  /// Null for a set in repetitions; absent from a set queued before timed sets existed.
  public var seconds: Nullable<Int>
  /// 4 means "4 or more"; nil for a warm-up or a timed set.
  public var rir: Int?

  public init(weightKg: Double, reps: Int?, seconds: Nullable<Int>, rir: Int?) {
    self.weightKg = weightKg
    self.reps = reps
    self.seconds = seconds
    self.rir = rir
  }

  fileprivate init(_ c: KeyedDecodingContainer<Key>) throws {
    weightKg = try c.decode(Double.self, forKey: .weightKg)
    reps = try c.decodeNullable(Int.self, forKey: .reps)
    seconds = try c.decode(Nullable<Int>.self, forKey: .seconds)
    rir = try c.decodeNullable(Int.self, forKey: .rir)
  }

  fileprivate func encode(_ c: inout KeyedEncodingContainer<Key>) throws {
    try c.encode(weightKg, forKey: .weightKg)
    try c.encode(reps, forKey: .reps)
    try c.encode(seconds, forKey: .seconds)
    try c.encode(rir, forKey: .rir)
  }
}

/// A set: created once with everything; then its values change together, or it goes.
public struct SetChange: Codable, Sendable, Equatable {
  public var id: String
  public var workoutId: String
  public var at: String
  public var edit: Edit

  public struct Create: Sendable, Equatable {
    public var slotIndex: Int
    /// Warm-ups 0 to 2, work set k at 3 + k.
    public var position: Int
    /// The exercise really done.
    public var exerciseId: String
    public var warmup: Bool
    public var values: SetValues
    public var doneAt: String

    public init(
      slotIndex: Int, position: Int, exerciseId: String, warmup: Bool, values: SetValues,
      doneAt: String
    ) {
      self.slotIndex = slotIndex
      self.position = position
      self.exerciseId = exerciseId
      self.warmup = warmup
      self.values = values
      self.doneAt = doneAt
    }
  }

  public enum Edit: Sendable, Equatable {
    case create(Create)
    case values(SetValues)
    case removed(Bool)
  }

  public init(id: String, workoutId: String, at: String, edit: Edit) {
    self.id = id
    self.workoutId = workoutId
    self.at = at
    self.edit = edit
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    id = try c.decode(String.self, forKey: .id)
    workoutId = try c.decode(String.self, forKey: .workoutId)
    at = try c.decode(String.self, forKey: .at)
    let field = try c.decode(String.self, forKey: .field)
    switch field {
    case "create":
      edit = .create(
        Create(
          slotIndex: try c.decode(Int.self, forKey: .slotIndex),
          position: try c.decode(Int.self, forKey: .position),
          exerciseId: try c.decode(String.self, forKey: .exerciseId),
          warmup: try c.decode(Bool.self, forKey: .warmup),
          values: try SetValues(c),
          doneAt: try c.decode(String.self, forKey: .doneAt)))
    case "values": edit = .values(try SetValues(c))
    case "removed": edit = .removed(try c.decode(Bool.self, forKey: .value))
    default: throw unknownField(field, c)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("set", forKey: .kind)
    try c.encode(id, forKey: .id)
    try c.encode(workoutId, forKey: .workoutId)
    switch edit {
    case .create(let create):
      try c.encode("create", forKey: .field)
      try c.encode(create.slotIndex, forKey: .slotIndex)
      try c.encode(create.position, forKey: .position)
      try c.encode(create.exerciseId, forKey: .exerciseId)
      try c.encode(create.warmup, forKey: .warmup)
      try create.values.encode(&c)
      try c.encode(create.doneAt, forKey: .doneAt)
    case .values(let values):
      try c.encode("values", forKey: .field)
      try values.encode(&c)
    case .removed(let removed):
      try c.encode("removed", forKey: .field)
      try c.encode(removed, forKey: .value)
    }
    try c.encode(at, forKey: .at)
  }
}
