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
