import Foundation

/// How an exercise is counted when it is not in repetitions.
public enum Measure: String, Codable, Sendable, Hashable {
  case seconds
}

/// A rule a program adds to a slot.
public enum SlotRule: String, Codable, Sendable, Hashable {
  /// Added by session C's rule, the week with no climbing.
  case noClimbing = "no_climbing"
}

/// One exercise of a session's plan. In a group (the same `groupKey` on consecutive slots) the
/// rest of the group's last slot follows each round.
public struct Slot: Codable, Sendable, Hashable {
  public var exerciseId: String
  public var sets: Int
  /// In the exercise's measure: repetitions, or seconds for a timed exercise. Two numbers.
  public var repRange: [Int]
  public var rirTarget: [Int]
  public var restSec: Int
  public var warmupSets: Int
  public var isMain: Bool
  /// Always written, null when the slot is in no group.
  public var groupKey: String?
  /// Left out of the JSON for a slot counted in repetitions.
  public var measure: Measure?
  public var rule: SlotRule?
  /// Added during the session; left out otherwise, never false.
  public var added: Bool?
  /// Left out for this session, or put back (false).
  public var skipped: Bool?

  public init(
    exerciseId: String, sets: Int, repRange: [Int], rirTarget: [Int], restSec: Int,
    warmupSets: Int, isMain: Bool, groupKey: String?, measure: Measure? = nil,
    rule: SlotRule? = nil, added: Bool? = nil, skipped: Bool? = nil
  ) {
    self.exerciseId = exerciseId
    self.sets = sets
    self.repRange = repRange
    self.rirTarget = rirTarget
    self.restSec = restSec
    self.warmupSets = warmupSets
    self.isMain = isMain
    self.groupKey = groupKey
    self.measure = measure
    self.rule = rule
    self.added = added
    self.skipped = skipped
  }

  private enum CodingKeys: String, CodingKey {
    case exerciseId, sets, repRange, rirTarget, restSec, warmupSets, isMain, groupKey, measure
    case rule, added, skipped
  }

  // The web tells a missing key from a null one: `groupKey` must be there, null or not, and the
  // optional fields are left out rather than null.
  public init(from decoder: any Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    exerciseId = try c.decode(String.self, forKey: .exerciseId)
    sets = try c.decode(Int.self, forKey: .sets)
    repRange = try c.decode([Int].self, forKey: .repRange)
    rirTarget = try c.decode([Int].self, forKey: .rirTarget)
    restSec = try c.decode(Int.self, forKey: .restSec)
    warmupSets = try c.decode(Int.self, forKey: .warmupSets)
    isMain = try c.decode(Bool.self, forKey: .isMain)
    groupKey = try c.decodeNullable(String.self, forKey: .groupKey)
    measure = try c.decodeUnlessAbsent(Measure.self, forKey: .measure)
    rule = try c.decodeUnlessAbsent(SlotRule.self, forKey: .rule)
    added = try c.decodeUnlessAbsent(Bool.self, forKey: .added)
    skipped = try c.decodeUnlessAbsent(Bool.self, forKey: .skipped)
  }

  public func encode(to encoder: any Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(exerciseId, forKey: .exerciseId)
    try c.encode(sets, forKey: .sets)
    try c.encode(repRange, forKey: .repRange)
    try c.encode(rirTarget, forKey: .rirTarget)
    try c.encode(restSec, forKey: .restSec)
    try c.encode(warmupSets, forKey: .warmupSets)
    try c.encode(isMain, forKey: .isMain)
    try c.encode(groupKey, forKey: .groupKey)
    try c.encodeIfPresent(measure, forKey: .measure)
    try c.encodeIfPresent(rule, forKey: .rule)
    try c.encodeIfPresent(added, forKey: .added)
    try c.encodeIfPresent(skipped, forKey: .skipped)
  }
}

extension KeyedDecodingContainer {
  /// A value whose key must be there, holding null or a value.
  func decodeNullable<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
    guard contains(key) else {
      throw DecodingError.keyNotFound(
        key, .init(codingPath: codingPath, debugDescription: "written as null, never left out"))
    }
    return try decodeNil(forKey: key) ? nil : decode(T.self, forKey: key)
  }

  /// A value left out when it has none, never written as null.
  func decodeUnlessAbsent<T: Decodable>(_ type: T.Type, forKey key: Key) throws -> T? {
    contains(key) ? try decode(T.self, forKey: key) : nil
  }
}
