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
  case activeProgram(ActiveProgramChange)
  case weight(WeightChange)
  case measure(MeasureChange)
  case intake(IntakeChange)
  case supplementLog(SupplementLogChange)
  case annotation(AnnotationChange)
  case profile(ProfileChange)
  case target(TargetChange)
  case supplement(SupplementChange)
  case activity(ActivityChange)
  case steps(StepsChange)

  private enum Kind: String, Codable {
    case workout, set, activeProgram, weight, measure, intake, supplementLog, annotation
    case profile, target, supplement, activity, steps
  }
  private enum KindKey: String, CodingKey { case kind }

  public init(from decoder: any Decoder) throws {
    switch try decoder.container(keyedBy: KindKey.self).decode(Kind.self, forKey: .kind) {
    case .workout: self = .workout(try WorkoutChange(from: decoder))
    case .set: self = .set(try SetChange(from: decoder))
    case .activeProgram: self = .activeProgram(try ActiveProgramChange(from: decoder))
    case .weight: self = .weight(try WeightChange(from: decoder))
    case .measure: self = .measure(try MeasureChange(from: decoder))
    case .intake: self = .intake(try IntakeChange(from: decoder))
    case .supplementLog: self = .supplementLog(try SupplementLogChange(from: decoder))
    case .annotation: self = .annotation(try AnnotationChange(from: decoder))
    case .profile: self = .profile(try ProfileChange(from: decoder))
    case .target: self = .target(try TargetChange(from: decoder))
    case .supplement: self = .supplement(try SupplementChange(from: decoder))
    case .activity: self = .activity(try ActivityChange(from: decoder))
    case .steps: self = .steps(try StepsChange(from: decoder))
    }
  }

  public func encode(to encoder: any Encoder) throws {
    switch self {
    case .workout(let change): try change.encode(to: encoder)
    case .set(let change): try change.encode(to: encoder)
    case .activeProgram(let change): try change.encode(to: encoder)
    case .weight(let change): try change.encode(to: encoder)
    case .measure(let change): try change.encode(to: encoder)
    case .intake(let change): try change.encode(to: encoder)
    case .supplementLog(let change): try change.encode(to: encoder)
    case .annotation(let change): try change.encode(to: encoder)
    case .profile(let change): try change.encode(to: encoder)
    case .target(let change): try change.encode(to: encoder)
    case .supplement(let change): try change.encode(to: encoder)
    case .activity(let change): try change.encode(to: encoder)
    case .steps(let change): try change.encode(to: encoder)
    }
  }
}

/// The active program chosen, from `at` on; the server keeps the newer pointer.
public struct ActiveProgramChange: Codable, Sendable, Equatable {
  public var programId: String
  public var at: String

  public init(programId: String, at: String) {
    self.programId = programId
    self.at = at
  }

  private enum Keys: String, CodingKey { case kind, programId, at }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    programId = try c.decode(String.self, forKey: .programId)
    at = try c.decode(String.self, forKey: .at)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Keys.self)
    try c.encode("activeProgram", forKey: .kind)
    try c.encode(programId, forKey: .programId)
    try c.encode(at, forKey: .at)
  }

  /// The bytes JSON.stringify writes for it, its keys in the web's order: a keyed encoder does
  /// not keep the order keys were written in.
  fileprivate func json() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let id = String(decoding: try encoder.encode(programId), as: UTF8.self)
    let time = String(decoding: try encoder.encode(at), as: UTF8.self)
    return Data(#"{"kind":"activeProgram","programId":\#(id),"at":\#(time)}"#.utf8)
  }
}

/// The JSON a change is queued and sent as.
public enum ChangeJSON {
  /// The change's bytes, equal as JSON to what the web writes for it. The queue keeps these
  /// bytes and sends them as they are.
  public static func encode(_ change: Change) throws -> Data {
    if case .activeProgram(let pointer) = change { return try pointer.json() }
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
  case date, supplementId, taken, type, label
  case minPct, maxPct
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

// The body entries. Each is dated by the person's day, `YYYY-MM-DD`, and merged on its own key:
// a day, a day's field, a supplement's day, an annotation's field.

/// A day's weigh-in; nil deletes it.
public struct WeightChange: Codable, Sendable, Equatable, KeyedChange {
  public var date: String
  public var weightKg: Double?
  public var at: String

  public init(date: String, weightKg: Double?, at: String) {
    self.date = date
    self.weightKg = weightKg
    self.at = at
  }

  public var mergeKey: String { date }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    date = try c.decode(String.self, forKey: .date)
    weightKg = try c.decodeNullable(Double.self, forKey: .weightKg)
    at = try c.decode(String.self, forKey: .at)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("weight", forKey: .kind)
    try c.encode(date, forKey: .date)
    try c.encode(weightKg, forKey: .weightKg)
    try c.encode(at, forKey: .at)
  }
}

public enum MeasureField: String, Codable, Sendable, CaseIterable {
  case waist, neck, hip
}

/// One measure of a day, in centimetres; nil deletes it.
public struct MeasureChange: Codable, Sendable, Equatable, KeyedChange {
  public var date: String
  public var field: MeasureField
  public var value: Double?
  public var at: String

  public init(date: String, field: MeasureField, value: Double?, at: String) {
    self.date = date
    self.field = field
    self.value = value
    self.at = at
  }

  public var mergeKey: String { "\(date)|\(field.rawValue)" }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    date = try c.decode(String.self, forKey: .date)
    field = try c.decode(MeasureField.self, forKey: .field)
    value = try c.decodeNullable(Double.self, forKey: .value)
    at = try c.decode(String.self, forKey: .at)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("measure", forKey: .kind)
    try c.encode(date, forKey: .date)
    try c.encode(field, forKey: .field)
    try c.encode(value, forKey: .value)
    try c.encode(at, forKey: .at)
  }
}

public enum IntakeField: String, Codable, Sendable, CaseIterable {
  case kcal, protein
}

/// One total of a day's intake, in whole kilocalories or grams of protein; nil deletes it.
public struct IntakeChange: Codable, Sendable, Equatable, KeyedChange {
  public var date: String
  public var field: IntakeField
  public var value: Int?
  public var at: String

  public init(date: String, field: IntakeField, value: Int?, at: String) {
    self.date = date
    self.field = field
    self.value = value
    self.at = at
  }

  public var mergeKey: String { "\(date)|\(field.rawValue)" }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    date = try c.decode(String.self, forKey: .date)
    field = try c.decode(IntakeField.self, forKey: .field)
    value = try c.decodeNullable(Int.self, forKey: .value)
    at = try c.decode(String.self, forKey: .at)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("intake", forKey: .kind)
    try c.encode(date, forKey: .date)
    try c.encode(field, forKey: .field)
    try c.encode(value, forKey: .value)
    try c.encode(at, forKey: .at)
  }
}

/// A supplement's box of the day, ticked or unticked.
public struct SupplementLogChange: Codable, Sendable, Equatable, KeyedChange {
  public var supplementId: String
  public var date: String
  public var taken: Bool
  public var at: String

  public init(supplementId: String, date: String, taken: Bool, at: String) {
    self.supplementId = supplementId
    self.date = date
    self.taken = taken
    self.at = at
  }

  public var mergeKey: String { "\(supplementId)|\(date)" }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    supplementId = try c.decode(String.self, forKey: .supplementId)
    date = try c.decode(String.self, forKey: .date)
    taken = try c.decode(Bool.self, forKey: .taken)
    at = try c.decode(String.self, forKey: .at)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("supplementLog", forKey: .kind)
    try c.encode(supplementId, forKey: .supplementId)
    try c.encode(date, forKey: .date)
    try c.encode(taken, forKey: .taken)
    try c.encode(at, forKey: .at)
  }
}

/// A mark on the weight chart (see `Measure` for `unknown`).
public enum AnnotationKind: RawRepresentable, Codable, Sendable, Hashable {
  case deload, dietBreak, note
  /// A type this version does not know, as the server wrote it.
  case unknown(String)

  public init(rawValue: String) {
    switch rawValue {
    case "deload": self = .deload
    case "diet_break": self = .dietBreak
    case "note": self = .note
    default: self = .unknown(rawValue)
    }
  }

  public var rawValue: String {
    switch self {
    case .deload: "deload"
    case .dietBreak: "diet_break"
    case .note: "note"
    case .unknown(let raw): raw
    }
  }
}

/// An annotation: its day, type and label change together; its removal on its own.
public struct AnnotationChange: Codable, Sendable, Equatable, KeyedChange {
  public var id: String
  public var at: String
  public var edit: Edit

  public enum Edit: Sendable, Equatable {
    /// Nil: no label.
    case fields(date: String, type: AnnotationKind, label: String?)
    case removed(Bool)
  }

  public init(id: String, at: String, edit: Edit) {
    self.id = id
    self.at = at
    self.edit = edit
  }

  public var mergeKey: String {
    switch edit {
    case .fields: "\(id)|fields"
    case .removed: "\(id)|removed"
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    id = try c.decode(String.self, forKey: .id)
    at = try c.decode(String.self, forKey: .at)
    let field = try c.decode(String.self, forKey: .field)
    switch field {
    case "fields":
      edit = .fields(
        date: try c.decode(String.self, forKey: .date),
        type: try c.decode(AnnotationKind.self, forKey: .type),
        label: try c.decodeNullable(String.self, forKey: .label))
    case "removed": edit = .removed(try c.decode(Bool.self, forKey: .value))
    default: throw unknownField(field, c)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("annotation", forKey: .kind)
    try c.encode(id, forKey: .id)
    switch edit {
    case .fields(let date, let type, let label):
      try c.encode("fields", forKey: .field)
      try c.encode(date, forKey: .date)
      try c.encode(type, forKey: .type)
      try c.encode(label, forKey: .label)
    case .removed(let removed):
      try c.encode("removed", forKey: .field)
      try c.encode(removed, forKey: .value)
    }
    try c.encode(at, forKey: .at)
  }
}

// The kinds written from the settings and the tools: the profile, the loss range, the list of
// supplements, the activities and the day's steps.

/// One fact of the profile; nil clears it (« Effacer »). Each fact merges on its own.
public struct ProfileChange: Codable, Sendable, Equatable, KeyedChange {
  public var at: String
  public var edit: Edit

  public enum Edit: Sendable, Equatable {
    case formula(ProfileFormula?)
    case birthYear(Int?)
    /// In whole centimetres.
    case height(Int?)
  }

  public init(at: String, edit: Edit) {
    self.at = at
    self.edit = edit
  }

  public var mergeKey: String {
    switch edit {
    case .formula: "formula"
    case .birthYear: "birthYear"
    case .height: "height"
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    at = try c.decode(String.self, forKey: .at)
    let field = try c.decode(String.self, forKey: .field)
    switch field {
    case "formula": edit = .formula(try c.decodeNullable(ProfileFormula.self, forKey: .value))
    case "birthYear": edit = .birthYear(try c.decodeNullable(Int.self, forKey: .value))
    case "height": edit = .height(try c.decodeNullable(Int.self, forKey: .value))
    default: throw unknownField(field, c)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("profile", forKey: .kind)
    try c.encode(mergeKey, forKey: .field)
    switch edit {
    case .formula(let formula): try c.encode(formula, forKey: .value)
    case .birthYear(let year): try c.encode(year, forKey: .value)
    case .height(let cm): try c.encode(cm, forKey: .value)
    }
    try c.encode(at, forKey: .at)
  }
}

/// The loss range: both bounds travel together under one time, as they constrain each other.
public struct TargetChange: Codable, Sendable, Equatable, KeyedChange {
  public var minPct: Double
  public var maxPct: Double
  public var at: String

  public init(minPct: Double, maxPct: Double, at: String) {
    self.minPct = minPct
    self.maxPct = maxPct
    self.at = at
  }

  public var mergeKey: String { "target" }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    minPct = try c.decode(Double.self, forKey: .minPct)
    maxPct = try c.decode(Double.self, forKey: .maxPct)
    at = try c.decode(String.self, forKey: .at)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("target", forKey: .kind)
    try c.encode(minPct, forKey: .minPct)
    try c.encode(maxPct, forKey: .maxPct)
    try c.encode(at, forKey: .at)
  }
}

/// A supplement of the list, by the id the phone gave it: its name, or its removal. The server
/// creates it from its first name.
public struct SupplementChange: Codable, Sendable, Equatable, KeyedChange {
  public var id: String
  public var at: String
  public var edit: Edit

  public enum Edit: Sendable, Equatable {
    case name(String)
    case removed(Bool)
  }

  public init(id: String, at: String, edit: Edit) {
    self.id = id
    self.at = at
    self.edit = edit
  }

  public var mergeKey: String {
    switch edit {
    case .name: "\(id)|name"
    case .removed: "\(id)|removed"
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    id = try c.decode(String.self, forKey: .id)
    at = try c.decode(String.self, forKey: .at)
    let field = try c.decode(String.self, forKey: .field)
    switch field {
    case "name": edit = .name(try c.decode(String.self, forKey: .value))
    case "removed": edit = .removed(try c.decode(Bool.self, forKey: .value))
    default: throw unknownField(field, c)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("supplement", forKey: .kind)
    try c.encode(id, forKey: .id)
    switch edit {
    case .name(let name):
      try c.encode("name", forKey: .field)
      try c.encode(name, forKey: .value)
    case .removed(let removed):
      try c.encode("removed", forKey: .field)
      try c.encode(removed, forKey: .value)
    }
    try c.encode(at, forKey: .at)
  }
}

/// An activity's block: its type and fields, written together. A cardio type for cardio only,
/// the climbing fields for climbing only, a grade or a colour but not both (`isActivityFields`).
/// Values are the contract's words (`Bounds.activityKinds` and the lists beside it).
public struct ActivityFields: Codable, Sendable, Equatable {
  /// `cardio` or `climbing`.
  public var type: String
  public var durationMin: Int
  public var cardioType: String?
  public var climbStyle: String?
  public var climbRuns: Int?
  public var climbGrade: String?
  public var climbColor: String?

  public init(
    type: String, durationMin: Int, cardioType: String? = nil, climbStyle: String? = nil,
    climbRuns: Int? = nil, climbGrade: String? = nil, climbColor: String? = nil
  ) {
    self.type = type
    self.durationMin = durationMin
    self.cardioType = cardioType
    self.climbStyle = climbStyle
    self.climbRuns = climbRuns
    self.climbGrade = climbGrade
    self.climbColor = climbColor
  }

  fileprivate init(_ c: KeyedDecodingContainer<ActivityKey>) throws {
    type = try c.decode(String.self, forKey: .type)
    durationMin = try c.decode(Int.self, forKey: .durationMin)
    cardioType = try c.decodeNullable(String.self, forKey: .cardioType)
    climbStyle = try c.decodeNullable(String.self, forKey: .climbStyle)
    climbRuns = try c.decodeNullable(Int.self, forKey: .climbRuns)
    climbGrade = try c.decodeNullable(String.self, forKey: .climbGrade)
    climbColor = try c.decodeNullable(String.self, forKey: .climbColor)
  }

  // Every key written, null included, as the contract asks for each.
  fileprivate func encode(_ c: inout KeyedEncodingContainer<ActivityKey>) throws {
    try c.encode(type, forKey: .type)
    try c.encode(durationMin, forKey: .durationMin)
    try c.encode(cardioType, forKey: .cardioType)
    try c.encode(climbStyle, forKey: .climbStyle)
    try c.encode(climbRuns, forKey: .climbRuns)
    try c.encode(climbGrade, forKey: .climbGrade)
    try c.encode(climbColor, forKey: .climbColor)
  }
}

private enum ActivityKey: String, CodingKey {
  case kind, id, field, date, at, value
  case type, durationMin, cardioType, climbStyle, climbRuns, climbGrade, climbColor
}

/// An activity: its day and block travel together, its removal on its own.
public struct ActivityChange: Codable, Sendable, Equatable, KeyedChange {
  public var id: String
  public var at: String
  public var edit: Edit

  public enum Edit: Sendable, Equatable {
    case fields(date: String, ActivityFields)
    case removed(Bool)
  }

  public init(id: String, at: String, edit: Edit) {
    self.id = id
    self.at = at
    self.edit = edit
  }

  public var mergeKey: String {
    switch edit {
    case .fields: "\(id)|fields"
    case .removed: "\(id)|removed"
    }
  }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: ActivityKey.self)
    id = try c.decode(String.self, forKey: .id)
    at = try c.decode(String.self, forKey: .at)
    let field = try c.decode(String.self, forKey: .field)
    switch field {
    case "fields":
      edit = .fields(date: try c.decode(String.self, forKey: .date), try ActivityFields(c))
    case "removed": edit = .removed(try c.decode(Bool.self, forKey: .value))
    default:
      throw DecodingError.dataCorruptedError(
        forKey: .field, in: c, debugDescription: "no field \(field) in the contract")
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: ActivityKey.self)
    try c.encode("activity", forKey: .kind)
    try c.encode(id, forKey: .id)
    switch edit {
    case .fields(let date, let fields):
      try c.encode("fields", forKey: .field)
      try c.encode(date, forKey: .date)
      try fields.encode(&c)
    case .removed(let removed):
      try c.encode("removed", forKey: .field)
      try c.encode(removed, forKey: .value)
    }
    try c.encode(at, forKey: .at)
  }
}

/// A day's steps; nil deletes them.
public struct StepsChange: Codable, Sendable, Equatable, KeyedChange {
  public var date: String
  public var value: Int?
  public var at: String

  public init(date: String, value: Int?, at: String) {
    self.date = date
    self.value = value
    self.at = at
  }

  public var mergeKey: String { date }

  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: Key.self)
    date = try c.decode(String.self, forKey: .date)
    value = try c.decodeNullable(Int.self, forKey: .value)
    at = try c.decode(String.self, forKey: .at)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: Key.self)
    try c.encode("steps", forKey: .kind)
    try c.encode(date, forKey: .date)
    try c.encode(value, forKey: .value)
    try c.encode(at, forKey: .at)
  }
}
