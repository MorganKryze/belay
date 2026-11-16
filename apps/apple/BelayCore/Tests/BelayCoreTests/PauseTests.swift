import Foundation
import Testing

@testable import BelayCore

// A time the phone cannot read, which only a server or contract at fault sends, never stops the
// pause rules: such a time is left out, or read as no pause, as the web's NaN leaves it.

@Suite struct PauseTests {
  private let bad = "not a time"
  private let now = Fixture.t0.addingTimeInterval(600)

  @Test func anUnreadableStartReadsNoTimeElapsed() {
    #expect(sessionElapsed(startedAt: bad, pausedAt: nil, now: now) == 0)
    #expect(sessionElapsed(startedAt: bad, pausedAt: Fixture.time(5), now: now) == 0)
  }

  @Test func anUnreadablePauseReadsAsNone() {
    #expect(sessionElapsed(startedAt: Fixture.time(0), pausedAt: bad, now: now) == 600_000)
    #expect(restClock(pausedAt: bad, now: now, stops: .all) == now)
    #expect(pauseEndedBy(pausedAt: bad, doneAts: [Fixture.time(6)]) == nil)
    #expect(
      resumedStart(startedAt: Fixture.time(0), pausedAt: bad, resumedAt: Fixture.time(10))
        == Fixture.time(0))
    #expect(
      resumedRestEnd(Fixture.time(3), pausedAt: bad, resumedAt: Fixture.time(10), stops: .all)
        == Fixture.time(3))
  }

  @Test func anUnreadableSetTimeEndsNoPause() {
    #expect(pauseEndedBy(pausedAt: Fixture.time(5), doneAts: [bad]) == nil)
    #expect(
      pauseEndedBy(pausedAt: Fixture.time(5), doneAts: [bad, Fixture.time(7), Fixture.time(6)])
        == Fixture.time(6))
  }

  @Test func anUnreadableStartOrRestStaysAsItIs() {
    #expect(
      resumedStart(startedAt: bad, pausedAt: Fixture.time(5), resumedAt: Fixture.time(10)) == bad)
    #expect(
      resumedStart(startedAt: Fixture.time(0), pausedAt: Fixture.time(5), resumedAt: bad)
        == Fixture.time(0))
    #expect(
      resumedRestEnd(bad, pausedAt: Fixture.time(5), resumedAt: Fixture.time(10), stops: .all)
        == bad)
  }
}

// What a pause stops is this device's choice: everything by default, or the session's time while
// the rest keeps running. Tried on a store that already holds finished sessions, through the
// actions the cover and the lock screen call.

extension PauseTests {
  /// The rest left on the cover while paused, in ms.
  private func restLeft(_ s: Seance) throws -> Int? {
    guard case .paused(let paused) = try s.state().phase else {
      Issue.record("the session reads as paused")
      return nil
    }
    return paused.restLeftMs
  }

  /// One set logged at minute 1, so the rest runs to minute 3, then a pause at minute 2.
  private func pausedDuringRest(_ stops: PauseStops?) throws -> Seance {
    let s = try Seance(past: [(Seance.squat, 60, 8), (Seance.bench, 40, 10)], stops: stops)
    s.clock.advance(seconds: 60)
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    #expect(try s.active?.restEndsAt == Fixture.time(3))
    s.clock.advance(seconds: 60)
    try s.actions.pause()
    s.clock.advance(seconds: 30)
    return s
  }

  @Test func restRunsWhenSessionOnly() throws {
    let s = try pausedDuringRest(.session)
    // Half a minute into the pause, the rest has gone on counting.
    #expect(try restLeft(s) == 30_000)
    #expect(try s.actions.addRest(seconds: 30))
    s.clock.advance(seconds: 300)
    #expect(try restLeft(s) == nil)

    try s.actions.resume()
    #expect(try s.workout.startedAt == Fixture.time(5.5))
    #expect(try s.active?.restEndsAt == Fixture.time(3.5))
    #expect(try s.active?.pausedAt == nil)
  }

  @Test func restStopsByDefault() throws {
    let s = try pausedDuringRest(nil)
    #expect(try restLeft(s) == 60_000)
    s.clock.advance(seconds: 300)
    #expect(try restLeft(s) == 60_000)

    try s.actions.resume()
    #expect(try s.workout.startedAt == Fixture.time(5.5))
    #expect(try s.active?.restEndsAt == Fixture.time(8.5))
    #expect(try s.active?.pausedAt == nil)
  }
}
