import Foundation
import GRDB
import Testing

@testable import BelayCore

// What the store does with the server's answer: all of it in one transaction, the queue's own
// later writes kept on top of the rows received.

@Suite struct StoreServerTests {
  let store: AccountStore
  let w = Fixture.id()

  init() throws {
    store = try AccountStore.inMemory(userId: "u1")
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
  }

  private func note(_ text: String?, at minutes: Double) -> Change {
    .workout(WorkoutChange(id: w, at: Fixture.time(minutes), edit: .note(text)))
  }

  private func row() throws -> WorkoutRow? {
    try store.history().workouts.first { $0.id == w }
  }

  @Test func theSentEntriesLeaveTheQueue() throws {
    try store.recordChanges([note("a", at: 1)], active: .keep)
    let sent = try store.outbox(limit: nil)
    try store.recordChanges([note("b", at: 2)], active: .keep)

    try store.applyServer(sent: sent, response: Fixture.response())
    #expect(try Fixture.changes(store) == [note("b", at: 2)])
  }

  /// The batch counts only what this build can send: a later build's entry neither takes a place
  /// nor leaves the queue.
  @Test func theBatchSkipsAnUnreadableEntryAndKeepsIt() throws {
    let unreadable = Data(#"{"kind":"weighIn","id":"x"}"#.utf8)
    try store.writer.write { db in
      try db.execute(sql: "DELETE FROM outbox")
      try db.execute(sql: "INSERT INTO outbox (bytes) VALUES (?)", arguments: [unreadable])
    }
    try store.recordChanges([note("a", at: 1)], active: .keep)

    let batch = try store.syncBatch(limit: 1).entries
    #expect(batch.map(\.change) == [note("a", at: 1)])
    try store.applyServer(sent: batch, response: Fixture.response())
    let queued = try store.writer.read { db in
      try Data.fetchAll(db, sql: "SELECT bytes FROM outbox")
    }
    #expect(queued == [unreadable])
  }

  @Test func aRefusalIsTracedAndReverted() throws {
    let set = try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: Fixture.active(w))
    let sent = try store.outbox(limit: nil)

    try store.applyServer(
      sent: sent,
      response: Fixture.response(rejected: [Rejected(index: 1, reason: "unknown_exercise")]))
    #expect(try store.history().sets.isEmpty)
    let rejected = try store.rejected()
    #expect(rejected.map(\.change) == [.set(set)])
    #expect(rejected.map(\.reason) == ["unknown_exercise"])
    #expect(try store.outbox(limit: nil).isEmpty)
  }

  @Test func twoRefusalsOfOneSessionAreRevertedInOrder() throws {
    let ended = Change.workout(
      WorkoutChange(id: w, at: Fixture.time(2), edit: .ended(Fixture.time(2))))
    try store.recordChanges([note("a", at: 1), ended], active: .keep)
    let sent = try store.outbox(limit: nil)

    try store.applyServer(
      sent: sent,
      response: Fixture.response(rejected: [
        Rejected(index: 1, reason: "refused"), Rejected(index: 2, reason: "unknown"),
      ]))
    let session = try #require(try row())
    #expect(session.note == nil && session.noteAt == nil)
    #expect(session.endedAt == nil && session.endedAtAt == nil)
    #expect(try store.rejected().map(\.reason) == ["refused", "unknown"])
    #expect(try store.rejected().map(\.change) == [note("a", at: 1), ended])
  }

  @Test func aRefusedChangeKeepsALaterLocalEdit() throws {
    try store.recordChanges([note("a", at: 1), note("b", at: 2)], active: .keep)
    let sent = try store.outbox(limit: nil)

    try store.applyServer(
      sent: sent, response: Fixture.response(rejected: [Rejected(index: 1, reason: "refused")]))
    let session = try #require(try row())
    #expect(session.note == "b" && session.noteAt == Fixture.time(2))
    #expect(try store.rejected().map(\.change) == [note("a", at: 1)])
  }

  @Test func aRefusedStartTakesItsSessionAway() throws {
    let sent = try store.outbox(limit: nil)
    try store.applyServer(
      sent: sent, response: Fixture.response(rejected: [Rejected(index: 0, reason: "refused")]))
    #expect(try row() == nil)
    // Nothing is left to resume.
    #expect(try store.activeSession() == nil)
  }

  @Test func aRefusedSetRemovalPutsTheSetBack() throws {
    let set = try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: Fixture.active(w))
    try store.applyServer(sent: try store.outbox(limit: nil), response: Fixture.response())
    let removal = Change.set(
      SetChange(id: set.id, workoutId: w, at: Fixture.time(2), edit: .removed(true)))
    try store.recordChanges([removal], active: .keep)
    #expect(try store.history().sets.first?.removed == true)

    try store.applyServer(
      sent: try store.outbox(limit: nil),
      response: Fixture.response(rejected: [Rejected(index: 0, reason: "refused")]))
    let back = try #require(try store.history().sets.first)
    #expect(!back.removed && back.removedAt == nil)
  }

  @Test func aRefusedSessionRemovalPutsTheSessionBack() throws {
    try store.applyServer(sent: try store.outbox(limit: nil), response: Fixture.response())
    let removal = Change.workout(WorkoutChange(id: w, at: Fixture.time(2), edit: .removed(true)))
    try store.recordChanges([removal], active: .keep)
    #expect(try row()?.removed == true)

    try store.applyServer(
      sent: try store.outbox(limit: nil),
      response: Fixture.response(rejected: [Rejected(index: 0, reason: "refused")]))
    let back = try #require(try row())
    #expect(!back.removed && back.removedAt == nil)
  }

  @Test func theRowsReceivedAreStored() throws {
    let other = Fixture.id(5)
    let set = SetRow(
      id: Fixture.id(6), workoutId: other, slotIndex: 0, position: 3,
      exerciseId: Fixture.slot.exerciseId, warmup: false, weightKg: 40, reps: 10, seconds: nil,
      rir: 1, doneAt: Fixture.time(6), fieldsAt: Fixture.time(6), removed: false, removedAt: nil)
    let program = ProgramRow(
      id: Fixture.id(7), name: "Mine", nameAt: Fixture.time(7),
      schedule: Schedule(mode: .rotation, days: [nil, nil, nil, nil, nil, nil, nil]),
      scheduleAt: nil, removed: false, removedAt: nil)
    let session = ProgramSessionRow(
      id: Fixture.id(8), name: "Push", nameAt: nil, programId: program.id, position: 0,
      placeAt: nil, removed: false, removedAt: nil)
    let slot = ProgramSlotRow(
      id: Fixture.id(9), sessionId: session.id, position: 0, positionAt: nil,
      exerciseId: Fixture.slot.exerciseId, measure: nil, exerciseAt: nil, repRange: [8, 12],
      repsAt: nil, sets: 3, setsAt: nil, rirTarget: [1, 2], rirAt: nil, restSec: 120, restAt: nil,
      warmupSets: 1, warmupsAt: nil, isMain: true, mainAt: nil, groupKey: nil, groupAt: nil,
      rule: nil, ruleAt: nil, removed: false, removedAt: nil)
    let activity = try JSONDecoder().decode(
      ActivityRow.self,
      from: Data(
        #"{"id":"\#(Fixture.id(10))","date":"2026-11-05","type":"climbing","removed":false}"#.utf8))
    let response = Fixture.response(
      cursor: "43", workouts: [Fixture.workoutRow(other, startedAt: 5, ended: Fixture.time(30))],
      sets: [set], programs: [program], programSessions: [session], programSlots: [slot],
      activeProgram: ActiveProgramRow(programId: program.id, at: Fixture.time(7)),
      activities: [activity])

    try store.applyServer(sent: [], response: response)
    let history = try store.history()
    #expect(
      history.workouts.contains(Fixture.workoutRow(other, startedAt: 5, ended: Fixture.time(30))))
    #expect(history.sets == [set])
    let programs = try store.programs()
    #expect(programs.activeId == program.id && programs.activeAt == Fixture.time(7))
    #expect(programs.programs.contains(program))
    #expect(programs.sessions.contains(session))
    #expect(programs.slots.contains(slot))
    #expect(try store.activities() == [activity])
    #expect(try store.cursor() == "43")
  }

  @Test func aSessionPlanKeepsWhatTheServerSentAsSent() throws {
    let other = Fixture.id(5)
    // A key this build does not know: sending the plan back must not drop it.
    let answer = """
      {"cursor":"2","workouts":[{"id":"\(other)","sessionCode":"A","plan":[{"exerciseId":
      "belay:back-squat","sets":3,"repRange":[8,12],"rirTarget":[1,2],"restSec":120,
      "warmupSets":0,"isMain":true,"groupKey":null,"tempo":"3-1-1","loadKg":72.5}],"planAt":null,
      "startedAt":"\(Fixture.time(5))","startedAtAt":null,"endedAt":null,"endedAtAt":null,
      "note":null,"noteAt":null,"exerciseNotes":{},"exerciseNotesAt":null,"removed":false,
      "removedAt":null}],"sets":[],"activities":[],"rejected":[],"hasMore":false}
      """
    try store.applyServer(
      sent: [], response: JSONDecoder().decode(SyncResponse.self, from: Data(answer.utf8)))

    let stored = try #require(try store.history().workouts.first { $0.id == other })
    #expect(stored.plan == [Fixture.slot])
    let plan = try #require(stored.planJSON)
    let slots = try JSONDecoder().decode([JSONValue].self, from: plan)
    guard case .object(let slot) = slots.first else {
      Issue.record("no slot")
      return
    }
    #expect(slot["tempo"] == .string("3-1-1"))
    #expect(slot["loadKg"] == .number(72.5))
    // A whole number stays whole, as JSON.stringify writes it.
    let text = String(decoding: plan, as: UTF8.self)
    #expect(text.contains(#""sets":3,"#) || text.contains(#""sets":3}"#))

    // A plan the phone changed is its own: the server's copy no longer stands for it.
    var changed = stored
    changed.plan[0].sets = 4
    #expect(changed.planJSON == nil)
  }

  @Test func aQueuedChangeNewerThanAReceivedRowIsAppliedAgain() throws {
    try store.recordChanges([note("mine", at: 2)], active: .keep)
    let theirs = Fixture.workoutRow(w, note: "theirs", noteAt: Fixture.time(1))

    try store.applyServer(sent: [], response: Fixture.response(workouts: [theirs]))
    let session = try #require(try row())
    #expect(session.note == "mine" && session.noteAt == Fixture.time(2))
    #expect(try store.outbox(limit: nil).count == 2)
  }

  @Test func aQueuedChangeOlderThanAReceivedRowIsNot() throws {
    try store.recordChanges([note("mine", at: 1)], active: .keep)
    let theirs = Fixture.workoutRow(w, note: "theirs", noteAt: Fixture.time(2))

    try store.applyServer(sent: [], response: Fixture.response(workouts: [theirs]))
    #expect(try row()?.note == "theirs")
  }

  @Test func theOpenSessionGoesWhenTheServerShowsItEnded() throws {
    #expect(try store.activeSession() == Fixture.active(w))
    try store.applyServer(
      sent: [],
      response: Fixture.response(workouts: [Fixture.workoutRow(w, ended: Fixture.time(40))]))
    #expect(try store.activeSession() == nil)
  }

  @Test func theOpenSessionGoesWhenTheServerShowsItRemoved() throws {
    try store.applyServer(
      sent: [], response: Fixture.response(workouts: [Fixture.workoutRow(w, removed: true)]))
    #expect(try store.activeSession() == nil)
  }

  @Test func theOpenSessionStaysWhileTheServerShowsItOpen() throws {
    let sent = try store.outbox(limit: nil)
    try store.applyServer(sent: sent, response: Fixture.response(workouts: [Fixture.workoutRow(w)]))
    #expect(try store.activeSession() == Fixture.active(w))
  }

  @Test func theCursorIsSaved() throws {
    #expect(try store.cursor() == "0")
    try store.applyServer(sent: [], response: Fixture.response(cursor: "43"))
    #expect(try store.cursor() == "43")
  }

  @Test func aThrowRollsTheWholeAnswerBack() throws {
    let sent = try store.outbox(limit: nil)
    try Fixture.refuseInserts(into: "meta", in: store)
    let other = Fixture.id(5)

    #expect(throws: (any Error).self) {
      try store.applyServer(
        sent: sent,
        response: Fixture.response(
          cursor: "9",
          workouts: [Fixture.workoutRow(other), Fixture.workoutRow(w, ended: Fixture.time(9))],
          rejected: [Rejected(index: 0, reason: "refused")]))
    }
    #expect(try store.outbox(limit: nil).map(\.bytes) == sent.map(\.bytes))
    #expect(try store.history().workouts.map(\.id) == [w])
    #expect(try row()?.endedAt == nil)
    #expect(try store.rejected().isEmpty)
    #expect(try store.activeSession() == Fixture.active(w))
    #expect(try store.cursor() == "0")
  }

  @Test func kindsTheStoreDoesNotKeepAreIgnored() throws {
    let answer = """
      {"cursor":"5","weights":[{"date":"2026-11-05","weightKg":80,"at":"\(Fixture.time(0))"}],
      "measures":[],"intake":[],"supplements":[],"supplementLogs":[],"annotations":[],
      "steps":[{"date":"2026-11-05","steps":1200,"stepsAt":"\(Fixture.time(0))"}],
      "workouts":[],"sets":[],"activities":[],"target":null,"profile":null,"rejected":[],
      "hasMore":false}
      """
    try store.applyServer(
      sent: [], response: JSONDecoder().decode(SyncResponse.self, from: Data(answer.utf8)))
    #expect(try store.cursor() == "5")
    let tables = try store.writer.read { db in
      try String.fetchAll(db, sql: "SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    #expect(!tables.contains("weights") && !tables.contains("steps"))
  }

  /// The store keeps a row as this build reads it. A later build that reads a new field of a kept
  /// kind finds it missing from every row stored before, so its migration must pull them again.
  @Test func aFieldThisBuildDoesNotReadIsNotKept() throws {
    let other = Fixture.id(5)
    let set = Fixture.id(6)
    let answer = """
      {"cursor":"3","workouts":[{"id":"\(other)","sessionCode":"A","plan":[],"planAt":null,
      "startedAt":"\(Fixture.time(5))","startedAtAt":null,"endedAt":null,"endedAtAt":null,
      "note":null,"noteAt":null,"exerciseNotes":{},"exerciseNotesAt":null,"removed":false,
      "removedAt":null,"feeling":4}],"sets":[{"id":"\(set)","workoutId":"\(other)",
      "slotIndex":0,"position":0,"exerciseId":"belay:back-squat","warmup":false,"weightKg":40,
      "reps":10,"seconds":null,"rir":null,"doneAt":"\(Fixture.time(6))",
      "fieldsAt":"\(Fixture.time(6))","removed":false,"removedAt":null,"side":"left"}],
      "activities":[],"rejected":[],"hasMore":false}
      """
    try store.applyServer(
      sent: [], response: JSONDecoder().decode(SyncResponse.self, from: Data(answer.utf8)))

    let (workout, setRow) = try store.writer.read { db in
      (
        try Data.fetchOne(db, sql: "SELECT row FROM workouts WHERE id = ?", arguments: [other]),
        try Data.fetchOne(db, sql: "SELECT row FROM sets WHERE id = ?", arguments: [set])
      )
    }
    guard case .object(let w) = try JSONDecoder().decode(JSONValue.self, from: #require(workout)),
      case .object(let s) = try JSONDecoder().decode(JSONValue.self, from: #require(setRow))
    else {
      Issue.record("a stored row is not an object")
      return
    }
    #expect(w["feeling"] == nil)
    #expect(s["side"] == nil)
    // A null the server wrote may come back left out: reads take both as no value.
    #expect(s["seconds"] == nil && s["rir"] == nil)
  }
}
