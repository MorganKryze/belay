import Foundation
import GRDB
import Testing

@testable import BelayCore

// The effort a person gives a session on its summary: kept on this phone only, one row per
// session, never sent to the server.

@Suite struct StoreEffortTests {
  let workoutId = Fixture.id()

  @Test func aFloorOutsideOneToFiveIsRefusedAndNothingWritten() throws {
    let store = try AccountStore.inMemory(userId: "u")
    for floor in [0, 6, -1] {
      #expect(throws: StoreError.invalidEffort) {
        try store.giveEffort(workoutId: workoutId, floor: floor)
      }
    }
    #expect(try store.efforts().isEmpty)
  }

  @Test func givingChangingAndClearingWriteOneRow() throws {
    let store = try AccountStore.inMemory(userId: "u")
    try store.giveEffort(workoutId: workoutId, floor: 2)
    #expect(try store.effort(workoutId: workoutId)?.floor == 2)
    try store.giveEffort(workoutId: workoutId, floor: 4)
    #expect(try store.effort(workoutId: workoutId)?.floor == 4)
    try store.giveEffort(workoutId: workoutId, floor: nil)
    let efforts = try store.efforts()
    #expect(efforts.count == 1)
    #expect(efforts.first == SessionEffort(workoutId: workoutId, floor: nil, settled: false, relatedAt: nil))
  }

  @Test func settlingKeepsTheFloor() throws {
    let store = try AccountStore.inMemory(userId: "u")
    try store.giveEffort(workoutId: workoutId, floor: 3)
    try store.settleEffort(workoutId: workoutId)
    #expect(try store.effort(workoutId: workoutId) == SessionEffort(workoutId: workoutId, floor: 3, settled: true, relatedAt: nil))
  }

  @Test func settlingWithNoFloorStillSettles() throws {
    let store = try AccountStore.inMemory(userId: "u")
    try store.settleEffort(workoutId: workoutId)
    #expect(try store.effort(workoutId: workoutId) == SessionEffort(workoutId: workoutId, floor: nil, settled: true, relatedAt: nil))
  }

  @Test func relatedKeepsTheRest() throws {
    let store = try AccountStore.inMemory(userId: "u")
    try store.giveEffort(workoutId: workoutId, floor: 5)
    try store.settleEffort(workoutId: workoutId)
    try store.markEffortRelated(workoutId: workoutId, at: Fixture.time(5))
    #expect(try store.effort(workoutId: workoutId) == SessionEffort(workoutId: workoutId, floor: 5, settled: true, relatedAt: Fixture.time(5)))
  }

  @Test func theEffortIsNeverQueued() throws {
    let store = try AccountStore.inMemory(userId: "u")
    _ = try store.startWorkout(Fixture.start(workoutId), now: Fixture.t0)
    let before = try store.outbox(limit: nil)
    try store.giveEffort(workoutId: workoutId, floor: 4)
    try store.settleEffort(workoutId: workoutId)
    try store.markEffortRelated(workoutId: workoutId, at: Fixture.time(5))
    #expect(try store.outbox(limit: nil) == before)
  }

  @Test func v2OpensOnAFileTheV1SchemaMade() throws {
    let folder = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: folder) }
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let origin = URL(string: "https://belay.example")!
    let url = AccountStore.fileURL(userId: "u", origin: origin, in: folder)
    do {
      let old = try DatabasePool(path: url.path)
      try Schema.migrator.migrate(old, upTo: "v1")
      try old.write { db in
        try db.execute(sql: "INSERT INTO meta (key, value) VALUES ('cursor', '7')")
      }
      try old.close()
    }
    let store = try AccountStore.open(userId: "u", origin: origin, in: folder)
    #expect(try store.cursor() == "7")
    try store.giveEffort(workoutId: workoutId, floor: 1)
    #expect(try store.effort(workoutId: workoutId)?.floor == 1)
  }
}
