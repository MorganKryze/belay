import Foundation

/// Any JSON value: what a queued change's bytes hold, compared or re-encoded as a value.
enum JSONValue: Codable, Sendable, Equatable {
  case null
  case bool(Bool)
  case number(Double)
  case string(String)
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: any Decoder) throws {
    let c = try decoder.singleValueContainer()
    // Bool before Double: the decoder reads neither one as the other.
    if c.decodeNil() {
      self = .null
    } else if let bool = try? c.decode(Bool.self) {
      self = .bool(bool)
    } else if let number = try? c.decode(Double.self) {
      self = .number(number)
    } else if let string = try? c.decode(String.self) {
      self = .string(string)
    } else if let array = try? c.decode([JSONValue].self) {
      self = .array(array)
    } else {
      self = .object(try c.decode([String: JSONValue].self))
    }
  }

  func encode(to encoder: any Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .null: try c.encodeNil()
    case .bool(let bool): try c.encode(bool)
    case .number(let number): try c.encode(number)
    case .string(let string): try c.encode(string)
    case .array(let array): try c.encode(array)
    case .object(let object): try c.encode(object)
    }
  }
}

/// A queued change as the bytes it was encoded to when it was written: a replay sends exactly
/// what the first try sent.
public struct RawChange: Encodable, Sendable, Equatable {
  public let bytes: Data

  public init(bytes: Data) { self.bytes = bytes }

  // For an encoder that builds a whole value; `SyncRequest.body()` sends the bytes themselves.
  public func encode(to encoder: any Encoder) throws {
    try JSONDecoder().decode(JSONValue.self, from: bytes).encode(to: encoder)
  }
}

/// The body of `POST /api/sync`.
public struct SyncRequest: Encodable, Sendable {
  /// The account whose queue this is: the server refuses it under any other session.
  public var account: String
  /// The server's sequence as text, "0" at first.
  public var cursor: String
  public var changes: [RawChange]

  public init(account: String, cursor: String, changes: [RawChange]) {
    self.account = account
    self.cursor = cursor
    self.changes = changes
  }

  /// The request's bytes, each change spliced in as it was stored rather than encoded again.
  public func body() throws -> Data {
    let encoder = JSONEncoder()
    var body = Data(#"{"account":"#.utf8)
    body += try encoder.encode(account)
    body += Data(#","cursor":"#.utf8)
    body += try encoder.encode(cursor)
    body += Data(#","changes":["#.utf8)
    for (i, change) in changes.enumerated() {
      if i > 0 { body += Data(",".utf8) }
      body += change.bytes
    }
    return body + Data("]}".utf8)
  }
}

/// A change the server could not take although its shape is valid: its place in the request and
/// why (`unknown`, `refused`, `unknown_exercise`, `too_many_sets`, `wrong_measure`,
/// `plan_shrank`). Kept as text, so a reason a newer server adds still reads.
public struct Rejected: Codable, Sendable, Equatable {
  public var index: Int
  public var reason: String
}

/// The server's answer, for the kinds the native app keeps; the other arrays are not read.
public struct SyncResponse: Decodable, Sendable {
  public var cursor: String
  public var workouts: [WorkoutRow]
  public var sets: [SetRow]
  /// Absent from an older server's answer.
  public var programs: [ProgramRow]?
  public var programSessions: [ProgramSessionRow]?
  public var programSlots: [ProgramSlotRow]?
  /// Nil when absent, or when no pointer was written since the cursor.
  public var activeProgram: ActiveProgramRow?
  public var activities: [ActivityRow]
  public var rejected: [Rejected]
  /// More rows were waiting: call again.
  public var hasMore: Bool
}
