import Foundation
import Testing

@testable import BelayCore

// What the cover shows, read from the stored session and the screen's own marks at an injected
// time: the set due, the rest, the recap and the announcement, the pause, and the end.

@Suite struct SessionStateTests {
  private func log(_ s: Seance, kg: Double = 60, count: Int? = 8) throws {
    try s.actions.logNext(count: count, weightKg: kg, expecting: nil)
  }

  @Test func aSetIsDueWithItsBars() throws {
    let s = try Seance([Seance.slot(), Seance.slot(Seance.bench)])
    let state = try s.state()
    guard case .due(let due) = state.phase else {
      Issue.record("a set due")
      return
    }
    #expect(due.number == 1 && due.of == 3 && !due.warmup)
    #expect(state.bars == [.current, .toCome, .toCome])
    #expect(state.exerciseIndex == 0 && state.exerciseCount == 2)
    #expect(state.title == "A")
    #expect(state.askRIR == nil)
  }

  @Test func aWorkSetRestsAndAsksItsRIR() throws {
    let s = try Seance()
    try log(s)
    let state = try s.state()
    guard case .resting(let rest) = state.phase else {
      Issue.record("resting")
      return
    }
    #expect(rest.endsAt == Fixture.t0 + 120)
    #expect(rest.next?.place == SetPlace(slotIndex: 0, position: 4))
    #expect(state.done.map(\.count) == [8])
    #expect(state.bars == [.done, .current, .toCome])
    #expect(state.askRIR?.id == state.done.first?.id)

    // The answer is never preset, and once given is no longer asked.
    try s.actions.answerRIR(setId: try #require(state.askRIR?.id), rir: 2)
    #expect(try s.state().askRIR == nil)

    s.clock.advance(seconds: 121)
    guard case .due(let due) = try s.state().phase else {
      Issue.record("the next set once the rest ends")
      return
    }
    #expect(due.number == 2)
  }

  @Test func warmupsComeFirstAsMontee() throws {
    let s = try Seance([Seance.slot(warmups: 2)], past: [(Seance.squat, 100, 8)])
    guard case .due(let due) = try s.state().phase else {
      Issue.record("a warm-up due")
      return
    }
    #expect(due.warmup && due.number == 1 && due.of == 2)
    #expect(due.progression == .warmup)
    try s.actions.logNext(count: nil, weightKg: nil, expecting: nil)
    guard case .due(let next) = try s.state().phase else {
      Issue.record("no rest after a warm-up")
      return
    }
    #expect(next.warmup && next.number == 2)
  }

  @Test func aTimedSetHoldsThenWaits() throws {
    let s = try Seance([Seance.slot(Seance.hang)])
    guard case .due(let due) = try s.state().phase else {
      Issue.record("due")
      return
    }
    #expect(due.timed && due.count == 30)
    try s.actions.startHold()
    s.clock.advance(seconds: 10)
    guard case .holding(let hold) = try s.state().phase else {
      Issue.record("holding")
      return
    }
    #expect(hold.endsAt == Fixture.t0 + 30)
    try s.actions.stopHold()
    #expect(try s.state().phase == .held(Held(due: due, seconds: 10)))
  }

  private func finishFirstExercise() throws -> Seance {
    let s = try Seance([Seance.slot(sets: 1), Seance.slot(Seance.bench)])
    try log(s)
    return s
  }

  @Test func theLastSetOfAnExerciseShowsItsRecap() throws {
    let s = try finishFirstExercise()
    let state = try s.state()
    guard case .recap(let recap) = state.phase else {
      Issue.record("recap")
      return
    }
    #expect(recap.exerciseId == Seance.squat && recap.sets.count == 1)
    #expect(state.askRIR != nil)
  }

  @Test func theRecapTurnsAfterItsFloorAndTheAnswer() throws {
    let s = try finishFirstExercise()
    let shown = Fixture.t0
    let setId = try #require(try s.sets.first?.id)
    s.clock.advance(seconds: 1)
    try s.actions.answerRIR(setId: setId, rir: 1)
    let answered = s.clock.now
    let marks = SessionMarks(recapShownAt: shown, rirAnsweredAt: answered)

    s.clock.advance(seconds: 1.5)  // 2.5 s shown
    guard case .recap = try s.state(marks).phase else {
      Issue.record("still the recap before 2.6 s")
      return
    }
    s.clock.advance(seconds: 0.2)  // 2.7 s shown, 1.7 s after the answer
    guard case .announce(let announce) = try s.state(marks).phase else {
      Issue.record("the announcement")
      return
    }
    #expect(announce.next.exerciseId == Seance.bench)
    #expect(announce.restEndsAt == Fixture.t0 + 120)
  }

  @Test func theRecapWaitsForTheAnswer() throws {
    let s = try finishFirstExercise()
    s.clock.advance(seconds: 10)
    guard case .recap = try s.state(SessionMarks(recapShownAt: Fixture.t0)).phase else {
      Issue.record("the recap waits for its RIR")
      return
    }
    // Answered at 3 s: it turns 0.9 s later, not before.
    let late = SessionMarks(recapShownAt: Fixture.t0, rirAnsweredAt: Fixture.t0 + 9.5)
    guard case .recap = try s.state(late).phase else {
      Issue.record("0.9 s after the answer")
      return
    }
  }

  @Test func aTapTurnsTheRecapAtOnce() throws {
    let s = try finishFirstExercise()
    guard case .announce = try s.state(SessionMarks(recapTapped: true)).phase else {
      Issue.record("announced at once")
      return
    }
  }

  @Test func voiceOverNeverTurnsTheRecapOnItsOwn() throws {
    let s = try finishFirstExercise()
    let setId = try #require(try s.sets.first?.id)
    try s.actions.answerRIR(setId: setId, rir: 1)
    s.clock.advance(seconds: 60)
    let marks = SessionMarks(recapShownAt: Fixture.t0, rirAnsweredAt: Fixture.t0, voiceOver: true)
    guard case .recap = try s.state(marks).phase else {
      Issue.record("the recap stays")
      return
    }
  }

  @Test func theRestEndingFirstShowsTheNextSet() throws {
    let s = try finishFirstExercise()
    s.clock.advance(seconds: 121)
    guard case .due(let due) = try s.state(SessionMarks(recapShownAt: Fixture.t0)).phase else {
      Issue.record("the next set directly")
      return
    }
    #expect(due.exerciseId == Seance.bench)
  }

  @Test func aTapOnTheAnnouncedClockBringsBackTheRest() throws {
    let s = try finishFirstExercise()
    guard case .resting = try s.state(SessionMarks(recapTapped: true, restCardAsked: true)).phase
    else {
      Issue.record("the rest card")
      return
    }
  }

  @Test func aGroupFollowsTheSharedOrder() throws {
    let s = try Seance([
      Seance.slot(sets: 2, rest: 0, group: "g"),
      Seance.slot(Seance.bench, sets: 2, rest: 90, group: "g"),
    ])
    var order: [SetPlace] = []
    for _ in 0..<4 {
      guard case .due(let due) = try s.state(SessionMarks(recapTapped: true)).phase else {
        Issue.record("a set due")
        return
      }
      order.append(due.place)
      try log(s)
      try s.actions.answerRIR(setId: try #require(try s.sets.last?.id), rir: 1)
      // Within a round the next exercise follows with no rest.
      if order.count == 1 { #expect(try s.active?.restEndsAt == nil) }
      try s.actions.skipRest()
    }
    #expect(
      order == [
        SetPlace(slotIndex: 0, position: 3), SetPlace(slotIndex: 1, position: 3),
        SetPlace(slotIndex: 0, position: 4), SetPlace(slotIndex: 1, position: 4),
      ])
  }

  @Test func everyPlannedSetLoggedIsAllDone() throws {
    let s = try Seance([Seance.slot(sets: 1)])
    try log(s)
    guard case .recap = try s.state().phase else {
      Issue.record("the last recap first")
      return
    }
    #expect(try s.state(SessionMarks(recapTapped: true)).phase == .allDone(sets: 1, title: "A"))
  }

  @Test func aPauseStopsTheClockAndTheRest() throws {
    let s = try Seance()
    s.clock.advance(seconds: 60)
    try log(s)
    s.clock.advance(seconds: 30)
    try s.actions.pause()
    s.clock.advance(seconds: 600)
    let state = try s.state()
    #expect(state.paused)
    #expect(state.phase == .paused(Paused(elapsedMs: 90_000, restLeftMs: 90_000)))
    #expect(state.elapsedMs == 90_000)
  }

  @Test func theProgressionLine() throws {
    let squat = Seance.slot()
    let hang = Seance.slot(Seance.hang)
    let none = History(workouts: [], sets: [])
    #expect(
      progression(history: none, slot: squat, setIndex: 0, warmup: true, weightKg: 40, count: 5)
        == .warmup)
    #expect(
      progression(history: none, slot: squat, setIndex: 0, warmup: false, weightKg: 60, count: 8)
        == .firstTime(low: 8, high: 12))

    let lifted = try Seance(past: [(Seance.squat, 60, 8)])
    let history = try lifted.store.history()
    #expect(
      progression(
        history: history, slot: squat, setIndex: 0, warmup: false, weightKg: 62.5, count: 8)
        == .heavier(byKg: 2.5))
    #expect(
      progression(history: history, slot: squat, setIndex: 0, warmup: false, weightKg: 60, count: 8)
        == .sameLoad(top: 12))

    let held = try Seance([hang], past: [(Seance.hang, 0, 40)])
    let holds = try held.store.history()
    #expect(
      progression(history: holds, slot: hang, setIndex: 0, warmup: false, weightKg: 0, count: 45)
        == .holdLonger(bySeconds: 5, last: 40))
    #expect(
      progression(history: holds, slot: hang, setIndex: 0, warmup: false, weightKg: 0, count: 40)
        == .holdSame(last: 40))
  }

  @Test func thePrefillOrder() throws {
    // Shared prefill first.
    let past = try Seance(past: [(Seance.squat, 70, 10)])
    try log(past, kg: 70, count: 6)
    try past.actions.skipRest()
    guard case .due(let fromPast) = try past.state().phase else {
      Issue.record("due")
      return
    }
    #expect(fromPast.count == 10 && fromPast.weightKg == 70)

    // Else the previous set of this session.
    let session = try Seance()
    try log(session, kg: 50, count: 6)
    try session.actions.skipRest()
    guard case .due(let fromSession) = try session.state().phase else {
      Issue.record("due")
      return
    }
    #expect(fromSession.count == 6 && fromSession.weightKg == 50)

    // Else the low target.
    let fresh = try Seance()
    guard case .due(let fromPlan) = try fresh.state().phase else {
      Issue.record("due")
      return
    }
    #expect(fromPlan.count == 8)
  }
}

extension Seance {
  /// The server's copy of this session lands with `edit` applied, the queue already sent.
  func serverSession(_ edit: (inout WorkoutRow) -> Void) throws {
    var row = try workout
    edit(&row)
    try store.applyServer(
      sent: try store.outbox(limit: nil), response: Fixture.response(workouts: [row]))
  }

  /// The server's copy of the set `id` lands with a done time the phone cannot read.
  func serverSetUnreadable(_ id: String) throws {
    var row = try #require(try sets.first { $0.id == id })
    row.doneAt = "not a time"
    try store.applyServer(
      sent: try store.outbox(limit: nil), response: Fixture.response(sets: [row]))
  }
}

// A time the phone cannot read on a synced row: the cover and the Activity read it at every
// change and tick, so it is left out rather than closing the app at each launch.
@Suite struct SessionStateUnreadableTests {
  @Test func anUnreadableStartReadsNoTimeElapsed() throws {
    let s = try Seance()
    s.clock.advance(seconds: 60)
    try s.serverSession { $0.startedAt = "not a time" }
    #expect(try s.state().elapsedMs == 0)
    try s.actions.pause()
    #expect(try s.state().elapsedMs == 0)
  }

  @Test func anUnreadableSetTimeEndsNoPause() throws {
    let s = try Seance()
    s.clock.advance(seconds: 60)
    try s.actions.pause()
    s.clock.advance(seconds: 60)
    try s.serverSetUnreadable(try s.landed(position: 3))
    s.clock.advance(seconds: 60)
    let state = try s.state()
    #expect(state.paused)
    #expect(state.elapsedMs == 60_000)
  }
}
