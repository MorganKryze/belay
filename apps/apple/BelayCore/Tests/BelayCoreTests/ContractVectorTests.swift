import Foundation
import Testing

@testable import BelayCore

/// The cases the shared TypeScript rules computed (`pnpm vectors`), read from the test bundle.
private struct Vectors: Decodable {
  struct Range: Decodable {
    let min: Double
    let max: Double
    let step: Double?
  }
  struct SlotBounds: Decodable {
    let sets: Int
    let reps: Int
    let seconds: Int
    let restSec: Int
    let groupKey: Int
  }
  struct TSBounds: Decodable {
    let setKg: Range
    let reps: Range
    let seconds: Range
    let rirMax: Int
    let maxSlots: Int
    let maxPosition: Int
    let maxWarmups: Int
    let noteMax: Int
    let sessionNameMax: Int
    let planMaxBytes: Int
    let slot: SlotBounds
    let exerciseId: String
    let minTime: String
    let clockSlackMs: Int
    let maxChanges: Int
    let weighInKg: Range
    let measureCm: [String: Range]
    let intake: [String: Range]
    let annotationLabelMax: Int
    let minDate: String
  }
  /// The phone's clock and zone the verdicts were made with.
  struct Clock: Decodable {
    let now: String
    let zone: String
    let today: String
  }
  struct DayCase: Decodable {
    let now: String
    let today: String
    let tomorrow: String
  }
  struct MergeCase: Decodable {
    let name: String
    let stored: [String: String?]
    let now: String
    let changes: [String]
    let kept: [String]
  }
  struct ChangeCase: Decodable {
    let name: String
    let valid: Bool
    let json: String
  }
  struct NewerCase: Decodable {
    let incoming: String
    let existing: String?
    let newer: Bool
  }
  struct ClampCase: Decodable {
    let at: String
    let now: String
    let result: String
  }
  struct IdCase: Decodable {
    let id: String
    let valid: Bool
  }
  struct InstantCase: Decodable {
    let ms: Int64
    let iso: String
  }

  let bounds: TSBounds
  let clock: Clock
  let days: [DayCase]
  let changes: [ChangeCase]
  let mergeBody: [MergeCase]
  let bodyAnswer: String
  let isNewer: [NewerCase]
  let clampAt: [ClampCase]
  let ids: [IdCase]
  let instants: [InstantCase]

  static func load() throws -> Vectors {
    let url = try #require(
      Bundle.module.url(forResource: "contract", withExtension: "json", subdirectory: "Vectors"))
    return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
  }
}

private func date(ms: Int64) -> Date { Date(timeIntervalSince1970: Double(ms) / 1000) }
private let paris = TimeZone(identifier: "Europe/Paris")!
private func json(_ data: Data) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: data)
}
/// The value with every null member of an object left out.
private func withoutNulls(_ value: JSONValue) -> JSONValue {
  switch value {
  case .object(let members):
    .object(members.filter { $0.value != .null }.mapValues(withoutNulls))
  case .array(let items): .array(items.map(withoutNulls))
  default: value
  }
}

struct ContractVectorTests {
  @Test func validity() throws {
    let vectors = try Vectors.load()
    let ts = vectors.bounds
    #expect(Bounds.setKgMin == ts.setKg.min)
    #expect(Bounds.setKgMax == ts.setKg.max)
    #expect(Bounds.setKgStep == ts.setKg.step)
    #expect(ts.reps.min == 0 && Double(Bounds.repsMax) == ts.reps.max)
    #expect(ts.seconds.min == 0 && Double(Bounds.secondsMax) == ts.seconds.max)
    #expect(Bounds.rirMax == ts.rirMax)
    #expect(Bounds.maxSlots == ts.maxSlots)
    #expect(Bounds.maxPosition == ts.maxPosition)
    #expect(Bounds.maxWarmups == ts.maxWarmups)
    #expect(Bounds.noteMax == ts.noteMax)
    #expect(Bounds.sessionNameMax == ts.sessionNameMax)
    #expect(Bounds.planMaxBytes == ts.planMaxBytes)
    #expect(Bounds.slotSets == ts.slot.sets)
    #expect(Bounds.slotReps == ts.slot.reps)
    #expect(Bounds.slotSeconds == ts.slot.seconds)
    #expect(Bounds.slotRestSec == ts.slot.restSec)
    #expect(Bounds.groupKeyMax == ts.slot.groupKey)
    #expect(Bounds.maxChanges == ts.maxChanges)
    // The exercise id rule is ported by hand: a new shape there must be ported too.
    #expect(ts.exerciseId == "^(ds|belay):[a-z0-9-]{1,\(Bounds.exerciseNameMax)}$")
    #expect(Bounds.minTime == ts.minTime)
    #expect(Bounds.clockSlackMs == ts.clockSlackMs)

    #expect(Bounds.weighInKgMin == ts.weighInKg.min)
    #expect(Bounds.weighInKgMax == ts.weighInKg.max)
    #expect(Bounds.weighInKgStep == ts.weighInKg.step)
    for field in MeasureField.allCases {
      let range = try #require(ts.measureCm[field.rawValue])
      #expect(Bounds.measureCm(field) == range.min...range.max, "\(field)")
    }
    #expect(ts.measureCm.count == MeasureField.allCases.count)
    #expect(ts.intake["kcal"]?.min == 0 && ts.intake["protein"]?.min == 0)
    #expect(ts.intake["kcal"]?.max == Double(Bounds.kcalMax))
    #expect(ts.intake["protein"]?.max == Double(Bounds.proteinGMax))
    #expect(Bounds.annotationLabelMax == ts.annotationLabelMax)
    #expect(Bounds.minDate == ts.minDate)

    // The verdicts were made on one clock in one zone: the body entries are dated by its day.
    #expect(vectors.clock.zone == paris.identifier)
    let now = try #require(Instant.date(vectors.clock.now))
    for vector in vectors.changes {
      // A change the contract cannot even read is refused, as the TypeScript rule refuses it.
      let change = try? ChangeJSON.decode(Data(vector.json.utf8))
      let verdict = change.map { isValid($0, now: now, timeZone: paris) } ?? false
      #expect(verdict == vector.valid, "\(vector.name)")
    }
  }

  @Test func todayIsThePersonsDay() throws {
    for vector in try Vectors.load().days {
      let now = try #require(Instant.date(vector.now))
      let on = { (date: String) in
        isValid(.weight(WeightChange(date: date, weightKg: 80, at: vector.now)), now: now,
          timeZone: paris)
      }
      #expect(on(vector.today), "\(vector.now)")
      #expect(!on(vector.tomorrow), "\(vector.now)")
    }
  }

  /// The body kinds, one test each: every case of the kind reads as that kind, gets the
  /// TypeScript verdict, encodes back to the same JSON, and merges as the shared merge does.
  @Test(arguments: ["weight", "measure", "intake", "supplementLog", "annotation"])
  func bodyKind(_ kind: String) throws {
    let vectors = try Vectors.load()
    let now = try #require(Instant.date(vectors.clock.now))
    let cases = vectors.changes.filter {
      $0.name.hasPrefix("\(kind): ") || $0.name.hasPrefix("\(kind) removed: ")
    }
    try #require(cases.count >= 7)
    for vector in cases {
      let change = try? ChangeJSON.decode(Data(vector.json.utf8))
      if vector.valid {
        let read = try #require(change, "\(vector.name)")
        #expect(Self.kind(of: read) == kind, "\(vector.name)")
        #expect(try json(ChangeJSON.encode(read)) == json(Data(vector.json.utf8)), "\(vector.name)")
      }
      let verdict = change.map { isValid($0, now: now, timeZone: paris) } ?? false
      #expect(verdict == vector.valid, "\(vector.name)")
    }

    let merges = vectors.mergeBody.filter { $0.name.hasPrefix("\(kind): ") }
    try #require(merges.count >= 2)
    for vector in merges {
      let changes = try vector.changes.map { try ChangeJSON.decode(Data($0.utf8)) }
      let stored = vector.stored.compactMapValues { $0 }
      let at = try #require(Instant.date(vector.now))
      let kept = try Self.merged(changes, stored: stored, now: at)
      #expect(
        try kept.map { try json(ChangeJSON.encode($0)) }
          == vector.kept.map { try json(Data($0.utf8)) }, "\(vector.name)")
    }
  }

  private static func kind(of change: Change) -> String {
    switch change {
    case .weight: "weight"
    case .measure: "measure"
    case .intake: "intake"
    case .supplementLog: "supplementLog"
    case .annotation: "annotation"
    case .workout: "workout"
    case .set: "set"
    case .activeProgram: "activeProgram"
    }
  }

  /// A batch of one kind through the merge, typed as that kind.
  private static func merged(_ changes: [Change], stored: [String: String], now: Date) throws
    -> [Change]
  {
    func run<C: KeyedChange>(_ pick: (Change) -> C?, _ wrap: (C) -> Change) throws -> [Change] {
      let typed = changes.compactMap(pick)
      try #require(typed.count == changes.count, "one kind per batch")
      return mergeFields(stored: stored, changes: typed, now: now).map(wrap)
    }
    switch changes.first {
    case .weight:
      return try run({ if case .weight(let c) = $0 { c } else { nil } }, Change.weight)
    case .measure:
      return try run({ if case .measure(let c) = $0 { c } else { nil } }, Change.measure)
    case .intake:
      return try run({ if case .intake(let c) = $0 { c } else { nil } }, Change.intake)
    case .supplementLog:
      return try run(
        { if case .supplementLog(let c) = $0 { c } else { nil } }, Change.supplementLog)
    case .annotation:
      return try run({ if case .annotation(let c) = $0 { c } else { nil } }, Change.annotation)
    default:
      Issue.record("not a body kind")
      return []
    }
  }

  @Test func readsTheBodyRows() throws {
    let answer = Data(try Vectors.load().bodyAnswer.utf8)
    let response = try JSONDecoder().decode(SyncResponse.self, from: answer)
    guard case .object(let source) = try json(answer) else {
      Issue.record("not an object")
      return
    }
    // Each row encodes back to the server's, its unwritten values left out rather than null.
    func same<T: Encodable>(_ rows: T?, _ key: String) throws {
      let encoded = try json(JSONEncoder().encode(rows))
      #expect(encoded == withoutNulls(source[key] ?? .null), "\(key)")
    }
    try same(response.weights, "weights")
    try same(response.measures, "measures")
    try same(response.intake, "intake")
    try same(response.supplements, "supplements")
    try same(response.supplementLogs, "supplementLogs")
    try same(response.annotations, "annotations")
    try same(response.target, "target")
    try same(response.profile, "profile")
    #expect(response.weights?.last?.weightKg == nil)
    #expect(response.supplements?.first?.kind == .creatine)
    #expect(response.annotations?.first?.type == .dietBreak)
    #expect(response.profile?.formula == .male)
    #expect(response.target?.at == nil)
  }

  @Test func readsBodyValuesANewerServerAdds() throws {
    let answer = """
      {"cursor":"46","workouts":[],"sets":[],"activities":[],"rejected":[],"hasMore":false,
      "supplements":[{"id":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f06","name":"Magnésium",
      "nameAt":"2026-11-06T09:30:00.123Z","kind":"mineral","removed":false,"removedAt":null}],
      "annotations":[{"id":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f07","date":"2026-11-06",
      "type":"travel","label":null,"fieldsAt":"2026-11-06T09:30:00.123Z","removed":false,
      "removedAt":null}],"target":null,
      "profile":{"formula":"other","formulaAt":null,"birthYear":null,"birthYearAt":null,
      "heightCm":null,"heightAt":null}}
      """
    let response = try JSONDecoder().decode(SyncResponse.self, from: Data(answer.utf8))
    #expect(response.supplements?.first?.kind == .unknown("mineral"))
    #expect(response.annotations?.first?.type == .unknown("travel"))
    #expect(response.profile?.formula == .unknown("other"))
    #expect(response.target == nil)
    // An older answer without the body rows still reads.
    #expect(response.weights == nil && response.measures == nil)
    // The phone never writes a type it does not know.
    let note = AnnotationChange(
      id: "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f07", at: "2026-11-06T09:30:00.123Z",
      edit: .fields(date: "2026-11-06", type: .unknown("travel"), label: nil))
    #expect(!isValid(.annotation(note), now: Date(), timeZone: paris))
  }

  @Test func encodesLikeTypeScript() throws {
    let vectors = try Vectors.load()
    for vector in vectors.changes {
      let bytes = Data(vector.json.utf8)
      guard let change = try? ChangeJSON.decode(bytes) else {
        #expect(!vector.valid, "an accepted change does not decode: \(vector.name)")
        continue
      }
      let encoded = try ChangeJSON.encode(change)
      // Parsed values, so key order does not count, but every key, null and number does.
      #expect(try json(encoded) == json(bytes), "\(vector.name)")
      #expect(try ChangeJSON.decode(encoded) == change, "\(vector.name)")
    }
  }

  /// The active program's cases, which the phone queues as the very bytes the web writes.
  private func activeProgramCases() throws -> [Vectors.ChangeCase] {
    let cases = try Vectors.load().changes.filter { $0.name.hasPrefix("activeProgram:") }
    try #require(cases.count >= 10)
    return cases
  }

  @Test func activeProgramEncodesLikeTypeScript() throws {
    for vector in try activeProgramCases() where vector.valid {
      let change = try ChangeJSON.decode(Data(vector.json.utf8))
      guard case .activeProgram(let pointer) = change else {
        Issue.record("not read as an active program: \(vector.name)")
        continue
      }
      // Byte for byte, key order included: the queue sends what it holds as it is.
      let text = String(decoding: try ChangeJSON.encode(change), as: UTF8.self)
      #expect(text == vector.json, "\(vector.name)")
      let built = ActiveProgramChange(programId: pointer.programId, at: pointer.at)
      #expect(try ChangeJSON.encode(.activeProgram(built)) == Data(vector.json.utf8))
    }
  }

  @Test func activeProgramValidity() throws {
    // Its time is any change's: never held to the clock, so a phone ahead of the server, or a
    // pointer from 1899, gets the verdict the web gives.
    let clocks = [date(ms: 0), date(ms: 1_793_957_400_123), date(ms: 4_102_444_800_000)]
    for vector in try activeProgramCases() {
      let change = try? ChangeJSON.decode(Data(vector.json.utf8))
      for now in clocks {
        let verdict = change.map { isValid($0, now: now, timeZone: paris) } ?? false
        #expect(verdict == vector.valid, "\(vector.name)")
      }
    }
  }

  @Test func instants() throws {
    for vector in try Vectors.load().instants {
      #expect(Instant.string(date(ms: vector.ms)) == vector.iso, "\(vector.ms)")
      #expect(Instant.date(vector.iso) == date(ms: vector.ms), "\(vector.iso)")
    }
    // Below a millisecond the time is cut, as a JavaScript Date holds whole milliseconds.
    #expect(Instant.string(Date(timeIntervalSince1970: 1.0009)) == "1970-01-01T00:00:01.000Z")
  }

  @Test func uuidv7Format() throws {
    for vector in try Vectors.load().ids {
      #expect(isId(vector.id) == vector.valid, "\(vector.id)")
    }
    let at = date(ms: 1_793_957_400_123)
    let id = UUIDv7.make(at: at)
    #expect(isId(id))
    #expect(id.dropFirst(14).first == "7")
    let hex = id.replacingOccurrences(of: "-", with: "")
    #expect(Int64(hex.prefix(12), radix: 16) == 1_793_957_400_123)
    #expect(UUIDv7.make(at: at) != id)
  }

  @Test func merge() throws {
    let vectors = try Vectors.load()
    for vector in vectors.isNewer {
      #expect(
        BelayCore.isNewer(vector.incoming, vector.existing) == vector.newer,
        "\(vector.incoming) over \(vector.existing ?? "nothing")")
    }
    for vector in vectors.clampAt {
      let now = try #require(Instant.date(vector.now))
      #expect(BelayCore.clampAt(vector.at, now: now) == vector.result, "\(vector.at)")
    }
  }

  @Test func syncMessages() throws {
    let vectors = try Vectors.load()
    let raw = vectors.changes.filter(\.valid).prefix(2).map { RawChange(bytes: Data($0.json.utf8)) }
    let request = SyncRequest(
      account: "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f99", cursor: "42", changes: Array(raw))
    let body = try request.body()
    // Each change goes out as the bytes it was stored as, not re-encoded.
    for change in raw {
      #expect(body.range(of: change.bytes) != nil)
    }
    #expect(try json(body) == json(JSONEncoder().encode(request)))
    #expect(
      try json(body)
        == .object([
          "account": .string(request.account), "cursor": .string("42"),
          "changes": .array(raw.map { try json($0.bytes) }),
        ]))

    let answer = """
      {"cursor":"43","weights":[],"workouts":[{"id":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f00",
      "sessionCode":"A","plan":[],"planAt":null,"startedAt":"2026-11-06T09:29:00.123Z",
      "startedAtAt":null,"endedAt":null,"endedAtAt":null,"note":null,"noteAt":null,
      "exerciseNotes":{},"exerciseNotesAt":null,"removed":false,"removedAt":null}],
      "sets":[],"activities":[{"id":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f03","date":"2026-11-05",
      "type":"climbing","durationMin":90,"cardioType":null,"climbStyle":null,"climbRuns":null,
      "climbGrade":null,"climbColor":null,"fieldsAt":"2026-11-05T20:00:00.000Z","removed":false,
      "removedAt":null}],"target":null,"profile":null,"rejected":[{"index":0,"reason":"unknown"}],
      "hasMore":true}
      """
    let response = try JSONDecoder().decode(SyncResponse.self, from: Data(answer.utf8))
    #expect(response.cursor == "43")
    #expect(response.workouts.first?.sessionName == .absent)
    #expect(response.programs == nil && response.activeProgram == nil)
    #expect(response.activities.first?.kind == "climbing")
    #expect(response.rejected.first?.reason == "unknown")
    #expect(response.hasMore)
  }

  @Test func readsValuesANewerServerAdds() throws {
    let slot = """
      {"exerciseId":"belay:barbell-hip-thrust","sets":3,"repRange":[8,12],"rirTarget":[1,2],
      "restSec":120,"warmupSets":2,"isMain":true,"groupKey":null,"measure":"kg","rule":"rest"}
      """
    let answer = """
      {"cursor":"44","workouts":[{"id":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f00","sessionCode":"A",
      "plan":[\(slot)],"planAt":null,"startedAt":"2026-11-06T09:29:00.123Z","startedAtAt":null,
      "endedAt":null,"endedAtAt":null,"note":null,"noteAt":null,"exerciseNotes":{},
      "exerciseNotesAt":null,"removed":false,"removedAt":null}],"sets":[],
      "programs":[{"id":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f04","name":null,"nameAt":null,
      "schedule":{"mode":"weekly","days":[]},"scheduleAt":null,"removed":false,"removedAt":null}],
      "programSlots":[{"id":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f05",
      "sessionId":"019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f01","position":0,"positionAt":null,
      "exerciseId":"belay:barbell-hip-thrust","measure":"kg","exerciseAt":null,"repRange":[8,12],
      "repsAt":null,"sets":3,"setsAt":null,"rirTarget":[1,2],"rirAt":null,"restSec":120,
      "restAt":null,"warmupSets":2,"warmupsAt":null,"isMain":true,"mainAt":null,"groupKey":null,
      "groupAt":null,"rule":"rest","ruleAt":null,"removed":false,"removedAt":null}],
      "activities":[],"rejected":[],"hasMore":false}
      """
    // One value this build does not know must not make the whole answer unreadable, or nothing
    // would sync again until the app is updated.
    let response = try JSONDecoder().decode(SyncResponse.self, from: Data(answer.utf8))
    let read = try #require(response.workouts.first?.plan.first)
    #expect(read.measure == .unknown("kg") && read.rule == .unknown("rest"))
    #expect(response.programs?.first?.schedule.mode == .unknown("weekly"))
    #expect(response.programSlots?.first?.measure == .unknown("kg"))
    #expect(response.programSlots?.first?.rule == .unknown("rest"))
    // Kept as read, so the row stored is the server's.
    #expect(try json(JSONEncoder().encode(read)) == json(Data(slot.utf8)))
    // Known values still read as themselves.
    #expect(Measure(rawValue: "seconds") == .seconds)
    #expect(SlotRule(rawValue: "no_climbing") == .noClimbing)
    #expect(Schedule.Mode(rawValue: "fixed") == .fixed)

    // The phone never writes one: the shared rules refuse it, and so would the server.
    var known = read
    known.measure = nil
    known.rule = nil
    let at = "2026-11-06T09:30:00.123Z"
    let id = "019a5a3c-7b2e-7d41-9c3f-2b8e4d6a1f00"
    #expect(
      isValid(
        .workout(.init(id: id, at: at, edit: .plan([known]))), now: Date(), timeZone: paris))
    var measure = known
    measure.measure = .unknown("kg")
    #expect(
      !isValid(
        .workout(.init(id: id, at: at, edit: .plan([measure]))), now: Date(), timeZone: paris))
    var rule = known
    rule.rule = .unknown("rest")
    #expect(
      !isValid(
        .workout(.init(id: id, at: at, edit: .plan([rule]))), now: Date(), timeZone: paris))
  }
}
