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
  let changes: [ChangeCase]
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
private func json(_ data: Data) throws -> JSONValue {
  try JSONDecoder().decode(JSONValue.self, from: data)
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
    // The exercise id rule is ported by hand: a new shape there must be ported too.
    #expect(ts.exerciseId == "^(ds|belay):[a-z0-9-]{1,\(Bounds.exerciseNameMax)}$")
    #expect(Bounds.minTime == ts.minTime)
    #expect(Bounds.clockSlackMs == ts.clockSlackMs)

    // Validity reads no clock for these two kinds; any time gives the same verdict.
    let now = Date()
    for vector in vectors.changes {
      // A change the contract cannot even read is refused, as the TypeScript rule refuses it.
      let change = try? ChangeJSON.decode(Data(vector.json.utf8))
      let verdict = change.map { isValid($0, now: now) } ?? false
      #expect(verdict == vector.valid, "\(vector.name)")
    }
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
    #expect(isValid(.workout(.init(id: id, at: at, edit: .plan([known]))), now: Date()))
    var measure = known
    measure.measure = .unknown("kg")
    #expect(!isValid(.workout(.init(id: id, at: at, edit: .plan([measure]))), now: Date()))
    var rule = known
    rule.rule = .unknown("rest")
    #expect(!isValid(.workout(.init(id: id, at: at, edit: .plan([rule]))), now: Date()))
  }
}
