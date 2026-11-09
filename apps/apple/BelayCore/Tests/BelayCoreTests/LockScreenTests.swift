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
    // A second tap on the same set corrects it, never adds one.
    #expect(try LockScreenActions.logShown(first, workoutId: s.workoutId, using: s.actions))
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
