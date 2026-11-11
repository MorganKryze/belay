import Foundation
import Testing

@testable import BelayCore

// The Live Activity's ✓ and +30 s go through the same writes as the screen, held to what the
// Activity showed: anything else writes nothing.

@Suite struct LockScreenTests {
  let first = SetPlace(slotIndex: 0, position: 3)

  @Test func logShownWritesOnce() throws {
    let s = try Seance()
    #expect(try LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
    #expect(try s.sets.count == 1)
    #expect(try s.active?.restEndsAt == Fixture.time(2))
    // A second tap on the same set never adds one.
    #expect(try !LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
    #expect(try s.sets.count == 1)
  }

  @Test func logShownRefusesOtherSet() throws {
    let s = try Seance()
    let before = try s.queued
    let other = SetPlace(slotIndex: 0, position: 4)
    #expect(try !LockScreenActions.logShown(other, workoutId: s.workoutId, using: s.actions))
    #expect(try !LockScreenActions.logShown(first, workoutId: Fixture.id(9), using: s.actions))
    #expect(try s.queued == before)
  }

  @Test func logShownRefusesWhilePaused() throws {
    let s = try Seance()
    try s.actions.pause()
    #expect(try !LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
    #expect(try s.sets.isEmpty)
  }

  @Test func logShownRefusesTimed() throws {
    let s = try Seance([Seance.slot(Seance.hang)])
    #expect(try !LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
    #expect(try s.sets.isEmpty)
  }

  @Test func addThirtyOnlyWhileResting() throws {
    let s = try Seance()
    #expect(try !LockScreenActions.addThirty(workoutId: s.workoutId, using: s.actions))
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    #expect(try LockScreenActions.addThirty(workoutId: s.workoutId, using: s.actions))
    #expect(try s.active?.restEndsAt == Instant.string(Fixture.t0 + 150))
    #expect(try !LockScreenActions.addThirty(workoutId: Fixture.id(9), using: s.actions))
    s.clock.advance(seconds: 200)
    #expect(try !LockScreenActions.addThirty(workoutId: s.workoutId, using: s.actions))
  }
}

@Suite struct LockScreenStaleTests {
  let first = SetPlace(slotIndex: 0, position: 3)

  /// A second ✓ from an Activity that did not update yet writes nothing: a change stamped now
  /// could overwrite a newer correction from another device.
  @Test func aSecondCheckWritesNothing() throws {
    let s = try Seance()
    let before = try s.queued
    #expect(try LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
    #expect(try !LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
    #expect(try s.queued == before + 1)
    let set = try #require(try s.sets.first)
    try s.actions.answerRIR(setId: set.id, rir: 2)
    let answered = try s.queued
    #expect(try !LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
    #expect(try s.queued == answered)
    #expect(try s.sets.first?.rir == 2)
  }

  /// The next exercise's warm-up, logged from the lock screen during the rest, leaves the
  /// question of the last work set's RIR in place.
  @Test func aWarmupDuringTheRestKeepsTheRIRQuestion() throws {
    let s = try Seance(
      [Seance.slot(sets: 1), Seance.slot(Seance.bench, warmups: 1)],
      past: [(Seance.bench, 80, 8)])
    let work = try #require(try s.actions.logNext(count: 8, weightKg: 60, expecting: nil))
    s.clock.advance(seconds: 10)
    #expect(try s.state(SessionMarks(recapTapped: true)).askRIR?.id == work.id)
    let warmup = SetPlace(slotIndex: 1, position: 0)
    #expect(try LockScreenActions.logShown(warmup, workoutId: s.workoutId, using: s.actions))
    #expect(try s.state(SessionMarks(recapTapped: true)).askRIR?.id == work.id)
  }
}
