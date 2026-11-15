import Foundation
import GRDB
import Synchronization
import Testing

@testable import BelayCore

// The body entries in the store: the version that adds them pulls everything again, each entry
// is written with its queued change or not at all, keyed as the server keys it, and sent once.

/// A clock the test moves by hand.
final class MovingClock: Sendable {
  private let value: Mutex<Date>
  init(_ start: Date) { value = Mutex(start) }
  var now: Date { value.withLock { $0 } }
  func move(minutes: Double) { value.withLock { $0 = $0.addingTimeInterval(minutes * 60) } }
}

@Suite struct StoreBodyTests {
  let store: AccountStore
  let clock = MovingClock(Fixture.t0)
  let body: BodyActions
  let day = "2026-11-05"

  init() throws {
    store = try AccountStore.inMemory(userId: "u1")
    let clock = clock
    body = BodyActions(store: store, now: { clock.now }, timeZone: Days.paris)
  }

  private func weightRow(_ date: String) throws -> WeightRow? {
    try store.writer.read { try BodyRows.weight($0, date: date) }
  }

  @Test func v4OpensV3StoreAndRestartsCursor() throws {
    let folder = try Fixture.folder()
    let origin = URL(string: "https://belay.example")!
    let w = Fixture.id()
    do {
      let old = try DatabaseQueue(
        path: AccountStore.fileURL(userId: "u1", origin: origin, in: folder).path)
      try Schema.migrator.migrate(old, upTo: "v3")
      try old.write { db in
        try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('cursor', '42')")
        try Rows.put(db, "workouts", id: w, Fixture.workoutRow(w))
      }
    }

    let opened = try AccountStore.open(userId: "u1", origin: origin, in: folder)
    #expect(try opened.cursor() == "0")
    #expect(try opened.history().workouts.map(\.id) == [w])
    #expect(try opened.body() == BodyRead.empty)
    try BodyActions(store: opened, now: { Fixture.t0 }, timeZone: Days.paris)
      .weigh(date: day, kg: 80.4)
    #expect(try opened.body().weights.map(\.weightKg) == [80.4])

    // Only the step itself restarts the pull: a later open keeps the cursor reached.
    try opened.applyServer(sent: [], response: Fixture.response(cursor: "7"))
    let again = try AccountStore.open(userId: "u1", origin: origin, in: folder)
    #expect(try again.cursor() == "7")
  }

  @Test func weighWritesRowAndQueueTogether() throws {
    try body.weigh(date: day, kg: 80.4)
    let change = WeightChange(date: day, weightKg: 80.4, at: Fixture.time(0))
    #expect(try store.body().weights == [WeightRow(date: day, weightKg: 80.4, at: Fixture.time(0))])
    #expect(try Fixture.changes(store) == [.weight(change)])
    let queued = try #require(try store.outbox(limit: nil).first)
    let json = { (data: Data) in try JSONDecoder().decode(JSONValue.self, from: data) }
    #expect(try json(queued.bytes) == json(ChangeJSON.encode(.weight(change))))

    try Fixture.refuseInserts(into: "outbox", in: store)
    #expect(throws: (any Error).self) { try body.weigh(date: "2026-11-06", kg: 80) }
    #expect(try store.body().weights.map(\.date) == [day])
    #expect(try store.outbox(limit: nil).count == 1)
  }

  /// The day's measures and its intake are each one write with their queued changes: a refused
  /// second queue entry leaves neither field written nor queued.
  @Test func multiFieldEntriesWriteAllOrNothing() throws {
    try Fixture.refuseInserts(
      into: "outbox", in: store, when: "(SELECT count(*) FROM main.outbox) >= 1")
    #expect(throws: (any Error).self) {
      try body.intake(date: day, kcal: .set(1800), protein: .set(120))
    }
    #expect(try store.body().intake.isEmpty)
    #expect(throws: (any Error).self) {
      try body.measure(date: day, waist: .set(85), neck: .set(38), hip: .keep)
    }
    #expect(try store.body().measures.isEmpty)
    #expect(try store.outbox(limit: nil).isEmpty)
  }

  @Test func theDayIsThePersonsToday() throws {
    // 23:30 UTC on the 6th is already the 7th in Paris.
    clock.move(minutes: 14 * 60 + 30)
    try body.weigh(date: "2026-11-07", kg: 80)
    let utc = BodyActions(store: store, now: { [clock] in clock.now }, timeZone: .gmt)
    #expect(throws: StoreError.invalidChange) { try utc.weigh(date: "2026-11-07", kg: 79.9) }
    #expect(throws: StoreError.invalidChange) { try body.weigh(date: "2026-11-08", kg: 80) }
    #expect(throws: StoreError.invalidChange) { try body.weigh(date: day, kg: 80.05) }
    #expect(try store.body().weights.map(\.weightKg) == [80])
    #expect(try Fixture.changes(store).count == 1)
  }

  @Test func oneWeighInPerDay() throws {
    try body.weigh(date: day, kg: 80.4)
    clock.move(minutes: 1)
    try body.weigh(date: day, kg: 80.2)
    #expect(try store.body().weights == [WeightRow(date: day, weightKg: 80.2, at: Fixture.time(1))])
    #expect(try Fixture.changes(store).count == 2)
  }

  @Test func deleteWritesNull() throws {
    try body.weigh(date: day, kg: 80.4)
    clock.move(minutes: 1)
    try body.deleteWeight(date: day)
    #expect(try store.body().weights.isEmpty)
    // The day stays, empty, so the deletion outranks an older weigh-in from elsewhere.
    #expect(try weightRow(day) == WeightRow(date: day, weightKg: nil, at: Fixture.time(1)))
    #expect(
      try Fixture.changes(store).last
        == .weight(WeightChange(date: day, weightKg: nil, at: Fixture.time(1))))

    // A day with no weigh-in has nothing to delete.
    try body.deleteWeight(date: "2026-11-04")
    try body.deleteWeight(date: day)
    #expect(try Fixture.changes(store).count == 2)
  }

  @Test func measureKeepsUntypedFields() throws {
    try body.measure(date: day, waist: .set(85), neck: .clear, hip: .clear)
    #expect(
      try Fixture.changes(store) == [
        .measure(MeasureChange(date: day, field: .waist, value: 85, at: Fixture.time(0)))
      ])
    clock.move(minutes: 1)
    try body.measure(date: day, waist: .set(84.5), neck: .set(38), hip: .clear)
    #expect(
      try store.body().measures == [
        MeasureRow(
          date: day, waistCm: 84.5, waistAt: Fixture.time(1), neckCm: 38, neckAt: Fixture.time(1),
          hipCm: nil, hipAt: nil)
      ])
    #expect(try Fixture.changes(store).count == 3)

    // Saved again with the neck emptied: only the neck is written, as a deletion.
    clock.move(minutes: 1)
    try body.measure(date: day, waist: .set(84.5), neck: .clear, hip: .clear)
    #expect(
      try Fixture.changes(store).last
        == .measure(MeasureChange(date: day, field: .neck, value: nil, at: Fixture.time(2))))
    #expect(try Fixture.changes(store).count == 4)
    let row = try #require(try store.body().measures.first)
    #expect(row.waistCm == 84.5 && row.waistAt == Fixture.time(1))
    #expect(row.neckCm == nil && row.neckAt == Fixture.time(2))

    #expect(throws: StoreError.invalidChange) {
      try body.measure(date: day, waist: .set(39.9), neck: .clear, hip: .clear)
    }
  }

  @Test func intakeIsDayTotal() throws {
    try body.intake(date: day, kcal: .set(1800), protein: .set(120))
    clock.move(minutes: 1)
    try body.intake(date: day, kcal: .set(2100), protein: .set(120))
    #expect(
      try store.body().intake == [
        IntakeRow(
          date: day, kcal: 2100, kcalAt: Fixture.time(1), proteinG: 120,
          proteinAt: Fixture.time(0))
      ])
    #expect(try Fixture.changes(store).count == 3)
    #expect(throws: StoreError.invalidChange) {
      try body.intake(date: day, kcal: .set(10_001), protein: .clear)
    }
  }

  /// A field the sheet left as it opened is not written: a value another device wrote since
  /// the sheet read the day stays, while the fields typed land.
  @Test func untouchedFieldKeepsAnotherDevicesValue() throws {
    try body.intake(date: day, kcal: .set(1800), protein: .set(120))
    try body.measure(date: day, waist: .set(85), neck: .set(38), hip: .clear)
    var answer = Fixture.response()
    answer.intake = [
      IntakeRow(
        date: day, kcal: 1800, kcalAt: Fixture.time(0), proteinG: 135, proteinAt: Fixture.time(2))
    ]
    answer.measures = [
      MeasureRow(
        date: day, waistCm: 85, waistAt: Fixture.time(0), neckCm: 39, neckAt: Fixture.time(2),
        hipCm: nil, hipAt: nil)
    ]
    try store.applyServer(sent: try store.outbox(limit: nil), response: answer)
    clock.move(minutes: 3)
    let queued = try Fixture.changes(store).count

    try body.intake(date: day, kcal: .set(2000), protein: .keep)
    try body.measure(date: day, waist: .set(84.5), neck: .keep, hip: .keep)
    #expect(try store.body().intake.first?.proteinG == 135)
    #expect(try store.body().intake.first?.kcal == 2000)
    #expect(try store.body().measures.first?.neckCm == 39)
    #expect(try store.body().measures.first?.waistCm == 84.5)
    #expect(try Fixture.changes(store).count == queued + 2, "only the typed fields are queued")
  }

  @Test func takeTwiceSameDayOneLog() throws {
    let creatine = Fixture.id(20)
    try body.take(supplementId: creatine, date: day, taken: true)
    clock.move(minutes: 1)
    try body.take(supplementId: creatine, date: day, taken: true)
    #expect(
      try store.body().logs == [
        SupplementLogRow(supplementId: creatine, date: day, taken: true, at: Fixture.time(0))
      ])
    #expect(try Fixture.changes(store).count == 1)

    try body.take(supplementId: creatine, date: day, taken: false)
    #expect(try store.body().logs.isEmpty)
    #expect(
      try Fixture.changes(store).last
        == .supplementLog(
          SupplementLogChange(
            supplementId: creatine, date: day, taken: false, at: Fixture.time(1))))
  }

  @Test func annotationEditAndRemove() throws {
    let id = Fixture.id(30)
    try body.annotate(AnnotationInput(id: id, date: day, type: .deload, label: "Semaine légère"))
    clock.move(minutes: 1)
    try body.annotate(AnnotationInput(id: id, date: "2026-11-04", type: .note, label: nil))
    #expect(
      try store.body().annotations == [
        AnnotationRow(
          id: id, date: "2026-11-04", type: .note, label: nil, fieldsAt: Fixture.time(1),
          removed: false, removedAt: nil)
      ])

    clock.move(minutes: 1)
    try body.removeAnnotation(id: id)
    #expect(try store.body().annotations.isEmpty)
    #expect(
      try Fixture.changes(store).last
        == .annotation(AnnotationChange(id: id, at: Fixture.time(2), edit: .removed(true))))
    // Removed already: nothing more to write.
    try body.removeAnnotation(id: id)
    #expect(try Fixture.changes(store).count == 3)
    #expect(throws: BodyError.noSuchAnnotation) { try body.removeAnnotation(id: Fixture.id(31)) }
    #expect(throws: StoreError.invalidChange) {
      try body.annotate(
        AnnotationInput(
          id: Fixture.id(32), date: day, type: .note, label: String(repeating: "a", count: 81)))
    }
  }

  // As the web's undo: saving a removed annotation brings it back, not a change no screen shows.
  @Test func annotatingARemovedAnnotationRestoresIt() throws {
    let id = Fixture.id(30)
    try body.annotate(AnnotationInput(id: id, date: day, type: .note, label: "x"))
    clock.move(minutes: 1)
    try body.removeAnnotation(id: id)
    clock.move(minutes: 1)
    try body.annotate(AnnotationInput(id: id, date: day, type: .note, label: "x"))
    #expect(try store.body().annotations.map(\.id) == [id])
    #expect(
      try Fixture.changes(store).last
        == .annotation(AnnotationChange(id: id, at: Fixture.time(2), edit: .removed(false))))

    clock.move(minutes: 1)
    try body.removeAnnotation(id: id)
    clock.move(minutes: 1)
    try body.annotate(AnnotationInput(id: id, date: day, type: .deload, label: nil))
    #expect(try store.body().annotations.map(\.type) == [.deload])
    #expect(
      try Fixture.changes(store).suffix(2) == [
        .annotation(AnnotationChange(id: id, at: Fixture.time(4), edit: .removed(false))),
        .annotation(
          AnnotationChange(
            id: id, at: Fixture.time(4), edit: .fields(date: day, type: .deload, label: nil))),
      ])
  }

  @Test func aRefusedEntryGoesUnlessRewritten() throws {
    try body.weigh(date: day, kg: 80.4)
    try body.take(supplementId: Fixture.id(20), date: day, taken: true)
    try body.annotate(AnnotationInput(id: Fixture.id(30), date: day, type: .note, label: "x"))
    try body.measure(date: day, waist: .set(85), neck: .clear, hip: .clear)
    try body.intake(date: day, kcal: .set(2000), protein: .clear)
    let sent = try store.outbox(limit: nil)
    try store.applyServer(
      sent: sent,
      response: Fixture.response(
        rejected: sent.indices.map { Rejected(index: $0, reason: "refused") }))
    #expect(try store.body() == BodyRead.empty)
    #expect(try store.rejected().count == 5)
  }

  @Test func aRefusedMeasureFieldGoesAloneWhileStillTheLastWrite() throws {
    try body.measure(date: day, waist: .set(85), neck: .set(38), hip: .set(95))
    let sent = try store.outbox(limit: nil)
    clock.move(minutes: 1)
    try body.measure(date: day, waist: .set(85), neck: .set(37), hip: .set(95))
    // The waist and the first neck are refused; the hip went through.
    try store.applyServer(
      sent: sent,
      response: Fixture.response(rejected: [
        Rejected(index: 0, reason: "refused"), Rejected(index: 1, reason: "refused"),
      ]))
    #expect(
      try store.body().measures == [
        MeasureRow(
          date: day, waistCm: nil, waistAt: nil, neckCm: 37, neckAt: Fixture.time(1), hipCm: 95,
          hipAt: Fixture.time(0))
      ])
  }

  @Test func aQueuedMeasureFieldWeighsOnlyAgainstItsOwnField() throws {
    clock.move(minutes: 5)
    try body.measure(date: day, waist: .clear, neck: .set(38), hip: .clear)

    // Another device wrote the waist later and the neck earlier than this queued neck.
    var answer = Fixture.response()
    answer.measures = [
      MeasureRow(
        date: day, waistCm: 85, waistAt: Fixture.time(7), neckCm: 39, neckAt: Fixture.time(3),
        hipCm: nil, hipAt: nil)
    ]
    try store.applyServer(sent: [], response: answer)
    #expect(
      try store.body().measures == [
        MeasureRow(
          date: day, waistCm: 85, waistAt: Fixture.time(7), neckCm: 38, neckAt: Fixture.time(5),
          hipCm: nil, hipAt: nil)
      ])

    answer.measures = [
      MeasureRow(
        date: day, waistCm: 85, waistAt: Fixture.time(7), neckCm: 40, neckAt: Fixture.time(9),
        hipCm: nil, hipAt: nil)
    ]
    try store.applyServer(sent: [], response: answer)
    #expect(try store.body().measures == answer.measures)
  }

  @Test func aQueuedIntakeMergesByTime() throws {
    clock.move(minutes: 5)
    try body.intake(date: day, kcal: .set(2100), protein: .clear)

    var older = Fixture.response()
    older.intake = [
      IntakeRow(
        date: day, kcal: 1800, kcalAt: Fixture.time(3), proteinG: 120, proteinAt: Fixture.time(3))
    ]
    try store.applyServer(sent: [], response: older)
    #expect(
      try store.body().intake == [
        IntakeRow(
          date: day, kcal: 2100, kcalAt: Fixture.time(5), proteinG: 120,
          proteinAt: Fixture.time(3))
      ])

    var newer = Fixture.response()
    newer.intake = [
      IntakeRow(
        date: day, kcal: 2400, kcalAt: Fixture.time(7), proteinG: 120, proteinAt: Fixture.time(3))
    ]
    try store.applyServer(sent: [], response: newer)
    #expect(try store.body().intake == newer.intake)
  }

  @Test func aQueuedRemovalOutranksALaterEditOfTheFields() throws {
    let id = Fixture.id(30)
    try body.annotate(AnnotationInput(id: id, date: day, type: .note, label: "x"))
    try store.applyServer(sent: try store.outbox(limit: nil), response: Fixture.response())
    clock.move(minutes: 2)
    try body.removeAnnotation(id: id)

    // The label was edited elsewhere after the removal: the two fields merge on their own.
    var answer = Fixture.response()
    answer.annotations = [
      AnnotationRow(
        id: id, date: day, type: .note, label: "y", fieldsAt: Fixture.time(3), removed: false,
        removedAt: nil)
    ]
    try store.applyServer(sent: [], response: answer)
    #expect(try store.body().annotations.isEmpty)
    #expect(
      try store.writer.read { try BodyRows.annotation($0, id: id) }
        == AnnotationRow(
          id: id, date: day, type: .note, label: "y", fieldsAt: Fixture.time(3), removed: true,
          removedAt: Fixture.time(2)))
  }

  @Test func theBodyRowsReceivedAreStored() throws {
    let supplement = SupplementRow(
      id: Fixture.id(20), name: "Créatine", nameAt: Fixture.time(0), kind: .creatine,
      removed: false, removedAt: nil)
    let log = SupplementLogRow(
      supplementId: supplement.id, date: day, taken: true, at: Fixture.time(0))
    let target = TargetRow(minPct: 0.5, maxPct: 1, at: Fixture.time(0))
    let profile = ProfileRow(
      formula: .male, formulaAt: Fixture.time(0), birthYear: 1990, birthYearAt: Fixture.time(0),
      heightCm: 180, heightAt: Fixture.time(0))
    let (kept, removed) = (Fixture.id(31), Fixture.id(32))
    var response = Fixture.response(cursor: "3")
    response.weights = [
      WeightRow(date: day, weightKg: 80.4, at: Fixture.time(0)),
      WeightRow(date: "2026-11-04", weightKg: 80.8, at: Fixture.time(0)),
      WeightRow(date: "2026-11-03", weightKg: nil, at: Fixture.time(0)),
    ]
    response.measures = [
      MeasureRow(
        date: day, waistCm: 85, waistAt: Fixture.time(0), neckCm: nil, neckAt: nil, hipCm: nil,
        hipAt: nil)
    ]
    response.intake = [
      IntakeRow(date: day, kcal: 2000, kcalAt: Fixture.time(0), proteinG: nil, proteinAt: nil)
    ]
    response.supplements = [supplement]
    response.supplementLogs = [log]
    response.annotations = [
      AnnotationRow(
        id: kept, date: day, type: .dietBreak, label: nil, fieldsAt: Fixture.time(0),
        removed: false, removedAt: nil),
      AnnotationRow(
        id: removed, date: day, type: .note, label: "x", fieldsAt: Fixture.time(0),
        removed: true, removedAt: Fixture.time(1)),
    ]
    response.target = target
    response.profile = profile
    try store.applyServer(sent: [], response: response)

    let read = try store.body()
    #expect(read.weights.map(\.date) == ["2026-11-04", day])
    #expect(read.measures == response.measures)
    #expect(read.intake == response.intake)
    #expect(read.supplements == [supplement])
    #expect(read.logs == [log])
    #expect(read.annotations.map(\.id) == [kept])
    #expect(read.target == target)
    #expect(read.profile == profile)
  }

  @Test func offlineSentOnce() async throws {
    try body.weigh(date: day, kg: 80.4)
    let echoed = WeightRow(date: day, weightKg: 80.4, at: Fixture.time(0))
    var answer = Fixture.response(cursor: "8")
    answer.weights = [echoed]
    let echo = answer
    let transport = ScriptedTransport { _, i in i == 0 ? .offline : .ok(echo) }
    let engine = SyncEngine(userId: "u1", store: store, transport: transport, onLanded: {})

    await engine.sync()
    #expect(try Fixture.changes(store).count == 1)
    #expect(try store.cursor() == "0")
    #expect(try store.body().weights == [echoed])

    await engine.sync()
    await engine.sync()
    let requests = await transport.requests
    // The offline attempt never reached the server; the next one took it, and nothing after.
    #expect(requests.count == 3)
    #expect(requests[0].changes.count == 1 && requests[1].changes == requests[0].changes)
    #expect(requests[2].changes.isEmpty)
    #expect(try store.outbox(limit: nil).isEmpty)
    #expect(try store.cursor() == "8")
    #expect(try store.body().weights == [echoed])
  }
}

extension BodyRead {
  static let empty = BodyRead(
    weights: [], measures: [], intake: [], supplements: [], logs: [], annotations: [],
    target: nil, profile: nil)
}
