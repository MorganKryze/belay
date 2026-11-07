import Foundation

// The programs as each account stores them, the rotation they give and the session that comes
// next in it.

/// A rotation stops at 26 sessions because a session done stores its letter as one capital.
public let maxRotation = 26

/// The rotation's letters, by place.
private let letters = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ").map(String.init)

/// The programs, the active one, the sessions placed in a program or set aside, and their slots.
public struct StoredPrograms: Codable, Sendable, Equatable {
  /// Nil, or a removed program: no rotation offered.
  public var activeId: String?
  /// When it became active; nil: since the start.
  public var activeAt: String?
  public var programs: [ProgramRow]
  public var sessions: [ProgramSessionRow]
  public var slots: [ProgramSlotRow]

  public init(
    activeId: String?, activeAt: String?, programs: [ProgramRow], sessions: [ProgramSessionRow],
    slots: [ProgramSlotRow]
  ) {
    self.activeId = activeId
    self.activeAt = activeAt
    self.programs = programs
    self.sessions = sessions
    self.slots = slots
  }
}

/// The starting program, the same for every account, as the shared rules build it.
public enum Seed {
  public static let programs: StoredPrograms = {
    // The file ships inside the package and its tests read it: unreadable, the build is broken.
    guard let url = Bundle.module.url(forResource: "seed", withExtension: "json") else {
      preconditionFailure("the starting program is missing")
    }
    do {
      return try JSONDecoder().decode(StoredPrograms.self, from: Data(contentsOf: url))
    } catch {
      preconditionFailure("the starting program does not read: \(error)")
    }
  }()
}

/// Stored rows win by id; every seed row the device lacks is read from the seed.
private func overlay<Row>(_ seed: [Row], _ stored: [Row], id: (Row) -> String) -> [Row] {
  let byId = Dictionary(stored.map { (id($0), $0) }, uniquingKeysWith: { _, last in last })
  let seedIds = Set(seed.map(id))
  return seed.map { byId[id($0)] ?? $0 } + stored.filter { !seedIds.contains(id($0)) }
}

/// The stored programs over the seed. The active pointer and its time travel together: with no
/// stored pointer (`absent`), the seed's.
public func withSeed(
  activeId: Nullable<String> = .absent, activeAt: String? = nil, programs: [ProgramRow] = [],
  sessions: [ProgramSessionRow] = [], slots: [ProgramSlotRow] = []
) -> StoredPrograms {
  let seed = Seed.programs
  let pointer: (String?, String?) =
    switch activeId {
    case .absent: (seed.activeId, seed.activeAt)
    case .null: (nil, activeAt)
    case .value(let id): (id, activeAt)
    }
  return StoredPrograms(
    activeId: pointer.0, activeAt: pointer.1,
    programs: overlay(seed.programs, programs, id: \.id),
    sessions: overlay(seed.sessions, sessions, id: \.id),
    slots: overlay(seed.slots, slots, id: \.id))
}

/// By position, then by id so every device reads two equal positions in the same order.
private func byPosition(_ a: (position: Int, id: String), _ b: (position: Int, id: String))
  -> Bool
{
  a.position != b.position ? a.position < b.position : precedes(a.id, b.id)
}

/// A rotation session as the screens start it: its slots, its no-climbing slots when it has
/// some, lettered by its place (`code`), with the session it comes from.
public struct LetteredTemplate: Codable, Sendable, Equatable {
  public var code: String
  public var slots: [Slot]
  /// The slots added at the end of the session in a week with no climbing.
  public var noClimbing: [Slot]?
  public var sessionId: String
  public var name: String?

  public init(
    code: String, slots: [Slot], noClimbing: [Slot]? = nil, sessionId: String, name: String?
  ) {
    self.code = code
    self.slots = slots
    self.noClimbing = noClimbing
    self.sessionId = sessionId
    self.name = name
  }
}

private func toSlot(_ s: ProgramSlotRow) -> Slot {
  Slot(
    exerciseId: s.exerciseId, sets: s.sets, repRange: s.repRange, rirTarget: s.rirTarget,
    restSec: s.restSec, warmupSets: s.warmupSets, isMain: s.isMain, groupKey: s.groupKey,
    measure: s.measure == .seconds ? .seconds : nil)
}

/// The active program's live sessions in order, each with its normal slots, then its
/// no-climbing slots. A session with no live normal slot cannot be started, so it is left out
/// and the letters close up; letters follow the place, A first, up to Z. No active program, or
/// a removed one, offers none.
public func rotationOf(_ p: StoredPrograms) -> [LetteredTemplate] {
  guard let active = p.programs.first(where: { $0.id == p.activeId && !$0.removed }) else {
    return []
  }
  let live = p.slots.filter { !$0.removed }.sorted {
    byPosition(($0.position, $0.id), ($1.position, $1.id))
  }
  let sessions = p.sessions.filter { $0.programId == active.id && !$0.removed }
    .sorted { byPosition(($0.position, $0.id), ($1.position, $1.id)) }
  let startable = sessions.compactMap { session -> LetteredTemplate? in
    let own = live.filter { $0.sessionId == session.id }
    let slots = own.filter { $0.rule == nil }.map(toSlot)
    if slots.isEmpty { return nil }
    let noClimbing = own.filter { $0.rule == .noClimbing }.map(toSlot)
    return LetteredTemplate(
      code: "", slots: slots, noClimbing: noClimbing.isEmpty ? nil : noClimbing,
      sessionId: session.id, name: session.name)
  }
  return startable.prefix(maxRotation).enumerated().map { i, template in
    var lettered = template
    lettered.code = letters[i]
    return lettered
  }
}

/// A session id a session recorded, nil when it recorded none (or an empty one).
func recordedSession(_ w: WorkoutRow) -> String? {
  guard let id = w.sessionId.value, !id.isEmpty else { return nil }
  return id
}

/// Whether a session done (or open) is this rotation session: by the session it recorded, or by
/// its letter when it recorded none. Letters follow the rotation, so a recorded id is the only
/// thing that survives a reorder.
func startedAs(_ w: WorkoutRow, _ t: LetteredTemplate) -> Bool {
  if let id = recordedSession(w) { return id == t.sessionId }
  return w.sessionCode == t.code
}

/// The session after the last one finished, found as `startedAs` says; the first when there is
/// none, or when that session is not in the rotation. One that recorded its session counts
/// whenever it was started, so switching back to a program resumes where it stopped; one recorded
/// by letter only counts since the program became active, as a letter names another session
/// elsewhere.
public func nextInRotation(
  _ workouts: [WorkoutRow], rotation: [LetteredTemplate], activeAt: String?
)
  -> LetteredTemplate?
{
  if rotation.isEmpty { return nil }
  // Times compared as instants: the pointer's time comes from the server, a start from the
  // phone. Two starts at the same instant: the greater id, so every device picks the same one.
  let since = activeAt.map(parsedMs) ?? -.infinity
  var last: WorkoutRow?
  for w in workouts {
    if w.endedAt == nil || w.removed
      || (recordedSession(w) == nil && parsedMs(w.startedAt) < since)
    {
      continue
    }
    let ahead = last.map { parsedMs(w.startedAt) - parsedMs($0.startedAt) } ?? 1
    if ahead > 0 || (ahead == 0 && last.map { precedes($0.id, w.id) } == true) { last = w }
  }
  let at = last.flatMap { last in rotation.firstIndex { startedAs(last, $0) } } ?? -1
  return rotation[(at + 1) % rotation.count]
}
