import Foundation
import GRDB
import Testing

@testable import BelayCore

// What the store does with what the phone records: each write whole or not at all, the queue in
// the order written, and the sessions the shared rules open and close.

/// Records the tests build, around one time so every `at` is canonical.
enum Fixture {
  static let t0 = Instant.date("2026-11-06T09:00:00.000Z")!

  static func time(_ minutes: Double, from base: Date = t0) -> String {
    Instant.string(base.addingTimeInterval(minutes * 60))
  }

  static func id(_ minutes: Double = 0) -> String {
    UUIDv7.make(at: t0.addingTimeInterval(minutes * 60))
  }

  static let slot = Slot(
    exerciseId: "belay:back-squat", sets: 3, repRange: [8, 12], rirTarget: [1, 2], restSec: 120,
    warmupSets: 0, isMain: true, groupKey: nil)

  static func start(
    _ id: String, at minutes: Double = 0, sessionId: Nullable<String> = .absent
  ) -> WorkoutStart {
    WorkoutStart(
      id: id, at: time(minutes),
      start: .init(
        sessionCode: "A", sessionId: sessionId, sessionName: .absent, plan: [slot],
        startedAt: time(minutes)))
  }

  static func set(
    _ workoutId: String, position: Int = 3, kg: Double = 60, reps: Int = 8, at minutes: Double = 1
  ) -> SetInput {
    SetInput(
      id: id(minutes), workoutId: workoutId, slotIndex: 0, position: position,
      exerciseId: slot.exerciseId, warmup: false,
      values: SetValues(weightKg: kg, reps: reps, seconds: .null, rir: 2), doneAt: time(minutes))
  }

  static func active(_ workoutId: String) -> ActiveSession {
    ActiveSession(workoutId: workoutId, slotIndex: 0, restEndsAt: nil)
  }

  /// A session as the server holds it, open unless `ended` says when it ended.
  static func workoutRow(
    _ id: String, startedAt minutes: Double = 0, ended: String? = nil, removed: Bool = false,
    note: String? = nil, noteAt: String? = nil
  ) -> WorkoutRow {
    WorkoutRow(
      id: id, sessionCode: "A", sessionId: .absent, sessionName: .absent, plan: [slot],
      planAt: nil, startedAt: time(minutes), startedAtAt: nil, endedAt: ended,
      endedAtAt: ended, note: note, noteAt: noteAt, exerciseNotes: [:], exerciseNotesAt: nil,
      removed: removed, removedAt: removed ? time(minutes) : nil)
  }

  static func response(
    cursor: String = "1", workouts: [WorkoutRow] = [], sets: [SetRow] = [],
    programs: [ProgramRow]? = nil, programSessions: [ProgramSessionRow]? = nil,
    programSlots: [ProgramSlotRow]? = nil, activeProgram: ActiveProgramRow? = nil,
    activities: [ActivityRow] = [], rejected: [Rejected] = []
  ) -> SyncResponse {
    SyncResponse(
      cursor: cursor, workouts: workouts, sets: sets, programs: programs,
      programSessions: programSessions, programSlots: programSlots, activeProgram: activeProgram,
      activities: activities, rejected: rejected, hasMore: false)
  }

  /// Makes SQLite refuse every insert into `table`, as a full disk or a crash mid-write would
  /// stop it, so a test sees what a failed write leaves behind.
  static func refuseInserts(into table: String, in store: AccountStore, when: String = "1")
    throws
  {
    try store.writer.write { db in
      try db.execute(
        sql: """
          CREATE TEMP TRIGGER refuse_\(table) BEFORE INSERT ON main.\(table) WHEN \(when)
          BEGIN SELECT RAISE(ABORT, 'refused by the test'); END
          """)
    }
  }

  static func changes(_ store: AccountStore) throws -> [Change] {
    try store.outbox(limit: nil).map(\.change)
  }

  static func folder() throws -> URL {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("store-tests-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }
}

@Suite struct StoreLocalTests {
  let store: AccountStore

  init() throws {
    store = try AccountStore.inMemory(userId: "u1")
  }

  @Test func aSetIsWrittenWithItsChangeAndTheOpenSession() throws {
    let w = Fixture.id()
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    let active = ActiveSession(workoutId: w, slotIndex: 0, restEndsAt: Fixture.time(3))
    let change = try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: active)

    guard case .create = change.edit else {
      Issue.record("not a creation")
      return
    }
    #expect(try store.history().sets.map(\.id) == [change.id])
    #expect(try Fixture.changes(store).last == .set(change))
    #expect(try store.activeSession() == active)
    // The queued bytes are the change's encoding; the encoder's key order varies from one call
    // to the next, so they compare as JSON.
    let queued = try #require(try store.outbox(limit: nil).last)
    let json = { (data: Data) in try JSONDecoder().decode(JSONValue.self, from: data) }
    #expect(try json(queued.bytes) == json(ChangeJSON.encode(.set(change))))
  }

  @Test func aSetWhoseQueueEntryFailsLeavesNothing() throws {
    let w = Fixture.id()
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    try Fixture.refuseInserts(into: "outbox", in: store)
    let moved = ActiveSession(workoutId: w, slotIndex: 1, restEndsAt: Fixture.time(3))

    #expect(throws: (any Error).self) {
      try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: moved)
    }
    #expect(try store.history().sets.isEmpty)
    #expect(try store.activeSession() == Fixture.active(w))
    #expect(try store.outbox(limit: nil).count == 1)
  }

  @Test func aChangeWhoseQueueEntryFailsLeavesNothing() throws {
    try Fixture.refuseInserts(into: "outbox", in: store)
    let w = Fixture.id()
    let start = Fixture.start(w).change
    #expect(throws: (any Error).self) {
      try store.recordChanges([.workout(start)], active: .set(Fixture.active(w)))
    }
    #expect(try store.history().workouts.isEmpty)
    #expect(try store.activeSession() == nil)
  }

  @Test func aSetAtATakenPlaceCorrectsIt() throws {
    let w = Fixture.id()
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    let first = try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: Fixture.active(w))
    let second = try store.recordSet(
      Fixture.set(w, kg: 62.5, reps: 6, at: 2), at: Fixture.time(2), active: Fixture.active(w))

    #expect(second.id == first.id)
    #expect(
      second.edit == .values(SetValues(weightKg: 62.5, reps: 6, seconds: .null, rir: 2)))
    let sets = try store.history().sets
    #expect(sets.count == 1)
    #expect(sets.first?.weightKg == 62.5 && sets.first?.reps == 6)
    #expect(sets.first?.fieldsAt == Fixture.time(2))
    #expect(try store.outbox(limit: nil).count == 3)
  }

  @Test func aSetAtThePlaceOfARemovedOneIsANewSet() throws {
    let w = Fixture.id()
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    let first = try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: Fixture.active(w))
    try store.recordChanges(
      [.set(SetChange(id: first.id, workoutId: w, at: Fixture.time(2), edit: .removed(true)))],
      active: .keep)
    let again = try store.recordSet(
      Fixture.set(w, kg: 70, at: 3), at: Fixture.time(3), active: Fixture.active(w))

    #expect(again.id != first.id)
    guard case .create = again.edit else {
      Issue.record("not a creation")
      return
    }
    let live = try store.history().sets.filter { !$0.removed }
    #expect(live.map(\.id) == [again.id])
    #expect(live.first?.weightKg == 70)
  }

  @Test func theRestMovesAndEndsInPlaceQueueingNothing() throws {
    let w = Fixture.id()
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    let active = ActiveSession(workoutId: w, slotIndex: 1, restEndsAt: Fixture.time(3))
    _ = try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: active)
    let queued = try store.outbox(limit: nil).count

    #expect(try store.moveRest(of: w, to: Fixture.time(3.5)))
    #expect(
      try store.activeSession()
        == ActiveSession(workoutId: w, slotIndex: 1, restEndsAt: Fixture.time(3.5)))
    #expect(try store.moveRest(of: w, to: nil))
    #expect(try store.activeSession() == ActiveSession(workoutId: w, slotIndex: 1, restEndsAt: nil))
    // The rest is this device's own: the server holds no rest, so nothing is sent.
    #expect(try store.outbox(limit: nil).count == queued)
  }

  @Test func theRestOfAnotherSessionIsLeftAlone() throws {
    let w = Fixture.id()
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    #expect(try store.moveRest(of: Fixture.id(1), to: Fixture.time(3)) == false)
    #expect(try store.activeSession() == Fixture.active(w))
  }

  @Test func aSecondStartTakesUpTheOneOpenHere() throws {
    let first = Fixture.id()
    #expect(try store.startWorkout(Fixture.start(first), now: Fixture.t0) == first)
    try store.recordChanges(
      [], active: .set(ActiveSession(workoutId: first, slotIndex: 2, restEndsAt: nil)))
    let second = Fixture.id(1)

    #expect(try store.startWorkout(Fixture.start(second, at: 1), now: Fixture.t0) == first)
    #expect(try store.history().workouts.map(\.id) == [first])
    #expect(try store.outbox(limit: nil).count == 1)
    // Already held here: its place in the session stays.
    #expect(try store.activeSession()?.slotIndex == 2)
  }

  @Test func aSecondStartTakesUpTheOneOpenElsewhere() throws {
    let synced = Fixture.id()
    try store.applyServer(
      sent: [], response: Fixture.response(workouts: [Fixture.workoutRow(synced)]))

    #expect(try store.startWorkout(Fixture.start(Fixture.id(1), at: 1), now: Fixture.t0) == synced)
    #expect(try store.outbox(limit: nil).isEmpty)
    #expect(try store.activeSession() == Fixture.active(synced))
  }

  @Test func aStartClosesTheForgottenOneInTheSameWrite() throws {
    let old = Fixture.id()
    _ = try store.startWorkout(Fixture.start(old), now: Fixture.t0)
    let set = try store.recordSet(
      Fixture.set(old), at: Fixture.time(1), active: Fixture.active(old))
    let later = Fixture.t0.addingTimeInterval(7 * 3600)
    let next = UUIDv7.make(at: later)
    var asked = Fixture.start(next)
    asked.at = Instant.string(later)
    asked.start.startedAt = Instant.string(later)

    // The new session's row cannot be written: the old one must stay as it was.
    try Fixture.refuseInserts(into: "workouts", in: store, when: "NEW.id = '\(next)'")
    #expect(throws: (any Error).self) { try store.startWorkout(asked, now: later) }
    #expect(try store.history().workouts.first { $0.id == old }?.endedAt == nil)
    #expect(try store.outbox(limit: nil).count == 2)
    try store.writer.write { try $0.execute(sql: "DROP TRIGGER temp.refuse_workouts") }

    #expect(try store.startWorkout(asked, now: later) == next)
    guard case .create(let created) = set.edit else {
      Issue.record("not a creation")
      return
    }
    let workouts = try store.history().workouts
    #expect(workouts.first { $0.id == old }?.endedAt == created.doneAt)
    let queued = try Fixture.changes(store)
    #expect(queued.count == 4)
    #expect(
      queued[2]
        == .workout(WorkoutChange(id: old, at: Instant.string(later), edit: .ended(created.doneAt)))
    )
    #expect(queued[3] == .workout(asked.change))
    #expect(try store.activeSession() == Fixture.active(next))
  }

  @Test func closeForgottenEndsASessionAtItsLastSet() throws {
    let w = Fixture.id()
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    _ = try store.recordSet(Fixture.set(w, at: 1), at: Fixture.time(1), active: Fixture.active(w))
    _ = try store.recordSet(
      Fixture.set(w, position: 4, at: 4), at: Fixture.time(4), active: Fixture.active(w))

    #expect(try !store.closeForgotten(now: Fixture.t0.addingTimeInterval(3600)))
    #expect(try store.outbox(limit: nil).count == 3)

    let later = Fixture.t0.addingTimeInterval(7 * 3600)
    #expect(try store.closeForgotten(now: later))
    #expect(try store.history().workouts.first?.endedAt == Fixture.time(4))
    #expect(
      try Fixture.changes(store).last
        == .workout(WorkoutChange(id: w, at: Instant.string(later), edit: .ended(Fixture.time(4)))))
    #expect(try store.activeSession() == nil)
  }

  @Test func closeForgottenRemovesOnlyAnEmptySessionHeldHere() throws {
    let held = Fixture.id()
    let synced = Fixture.id(1)
    try store.applyServer(
      sent: [], response: Fixture.response(workouts: [Fixture.workoutRow(synced, startedAt: 1)]))
    // Started here after the synced one's start: this device holds it.
    try store.recordChanges(
      [.workout(Fixture.start(held, at: 2).change)], active: .set(Fixture.active(held)))

    #expect(try store.closeForgotten(now: Fixture.t0.addingTimeInterval(7 * 3600)))
    let workouts = try store.history().workouts
    #expect(workouts.first { $0.id == held }?.removed == true)
    // Its sets may simply not have arrived here yet.
    #expect(workouts.first { $0.id == synced }?.removed == false)
    #expect(try store.activeSession() == nil)
    #expect(try Fixture.changes(store).count == 2)
  }

  @Test func theQueueKeepsItsOrderAcrossAReopen() throws {
    let folder = try Fixture.folder()
    let origin = URL(string: "https://belay.example.org")!
    let w = Fixture.id()
    var written: [Data] = []
    do {
      let store = try AccountStore.open(userId: "u1", origin: origin, in: folder)
      _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
      for k in 0..<3 {
        _ = try store.recordSet(
          Fixture.set(w, position: 3 + k, at: Double(1 + k)), at: Fixture.time(Double(1 + k)),
          active: Fixture.active(w))
      }
      written = try store.outbox(limit: nil).map(\.bytes)
    }
    let reopened = try AccountStore.open(userId: "u1", origin: origin, in: folder)
    let entries = try reopened.outbox(limit: nil)
    #expect(entries.map(\.bytes) == written)
    #expect(entries.map(\.id) == entries.map(\.id).sorted())
    #expect(try reopened.outbox(limit: 2).map(\.bytes) == Array(written.prefix(2)))
  }

  @Test func eachAccountAndInstanceHasItsOwnProtectedFile() throws {
    let folder = try Fixture.folder()
    let one = URL(string: "https://belay.example.org")!
    let other = URL(string: "https://other.example.org:8443")!
    let first = AccountStore.fileURL(userId: "u1", origin: one, in: folder)
    #expect(first != AccountStore.fileURL(userId: "u2", origin: one, in: folder))
    #expect(first != AccountStore.fileURL(userId: "u1", origin: other, in: folder))
    #expect(first.deletingLastPathComponent().standardizedFileURL == folder.standardizedFileURL)

    _ = try AccountStore.open(userId: "u1", origin: one, in: folder)
    #expect(FileManager.default.fileExists(atPath: first.path))
    #expect(AccountStore.protection == .completeUntilFirstUserAuthentication)
    #if os(iOS) || os(watchOS)
      let attributes = try FileManager.default.attributesOfItem(atPath: first.path)
      #expect(attributes[.protectionKey] as? FileProtectionType == AccountStore.protection)
    #endif
  }

  @Test func aFailedOpenLogsNeitherTheAccountNorItsInstance() throws {
    let origin = URL(string: "https://belay.example.org")!
    let gone = try Fixture.folder().appendingPathComponent("gone")
    let file = AccountStore.fileURL(userId: "0190abcd-user", origin: origin, in: gone)
    // The last step of `open`, on a file that is not there: Foundation's error names its path.
    let error = try #require(throws: (any Error).self) {
      try FileManager.default.setAttributes(
        [.protectionKey: AccountStore.protection], ofItemAtPath: file.path)
    }
    #expect(String(describing: error).contains("0190abcd-user"))

    let label = AccountStore.logLabel(error)
    #expect(!label.contains("0190abcd") && !label.contains("example"))
    #expect(label == "\((error as NSError).domain) \((error as NSError).code)")
  }

  @Test func anInvalidChangeIsRefusedBeforeAnyWrite() throws {
    let w = Fixture.id()
    var late = Fixture.start(w)
    late.at = "2026-11-06T09:00:00Z"  // not as toISOString() writes it
    #expect(throws: (any Error).self) {
      try store.recordChanges([.workout(late.change)], active: .set(Fixture.active(w)))
    }
    #expect(throws: (any Error).self) { try store.startWorkout(late, now: Fixture.t0) }
    #expect(try store.history().workouts.isEmpty)
    #expect(try store.activeSession() == nil)

    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    let offGrid = Fixture.set(w, kg: 60.1)
    #expect(throws: (any Error).self) {
      try store.recordSet(offGrid, at: Fixture.time(1), active: Fixture.active(w))
    }
    #expect(try store.history().sets.isEmpty)
    #expect(try store.outbox(limit: nil).count == 1)
  }

  @Test func aStartKeepsTheNameItsSessionHasHere() throws {
    let session = Fixture.id()
    let row = ProgramSessionRow(
      id: session, name: "Legs", nameAt: Fixture.time(0), programId: nil, position: 0,
      placeAt: nil, removed: false, removedAt: nil)
    try store.applyServer(sent: [], response: Fixture.response(programSessions: [row]))
    let w = Fixture.id(1)

    _ = try store.startWorkout(Fixture.start(w, at: 1, sessionId: .value(session)), now: Fixture.t0)
    #expect(try store.history().workouts.first?.sessionName == .value("Legs"))
    guard case .workout(let queued) = try Fixture.changes(store).first,
      case .start(let start) = queued.edit
    else {
      Issue.record("no start queued")
      return
    }
    #expect(start.sessionName == .value("Legs"))
  }

  @Test func anObserverSeesEachWrite() async throws {
    let w = Fixture.id()
    var seen = store.observe { db in try AccountStore.history(db).sets.count }.makeAsyncIterator()
    #expect(try await seen.next() == 0)
    _ = try store.startWorkout(Fixture.start(w), now: Fixture.t0)
    _ = try store.recordSet(Fixture.set(w), at: Fixture.time(1), active: Fixture.active(w))
    var count = try await seen.next()
    // The start alone may show first.
    if count == 0 { count = try await seen.next() }
    #expect(count == 1)
  }
}
