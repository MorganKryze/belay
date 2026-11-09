import BelayActivity
import Foundation
import Testing

@testable import BelayCore

// What the Live Activity and the rest alert show, read from the session state alone: one
// content per state, updated only when what it shows changes, and one alert at the rest's end.

@Suite struct ActivityPlanTests {
  static let words = ActivityWords(
    name: { $0 == Seance.squat ? "Back squat" : $0 },
    setOf: { "Série \($0) sur \($1)" },
    warmup: "Montée",
    load: { kg, count, timed in timed ? "\(count) s" : "\(kg) kg × \(count)" },
    rest: "Repos",
    next: { k, load in "Ensuite · série \(k) · \(load)" },
    paused: "En pause",
    stoppedAt: { "Séance arrêtée à \($0)" },
    allDone: "Tout est noté",
    restOver: "Repos terminé",
    stale: "Ouvre Belay pour continuer")

  private func content(_ s: Seance) throws -> ActivityContent {
    try #require(activityContent(try s.state(activityMarks), words: Self.words))
  }

  private func plan(_ s: Seance) throws -> RestAlertPlan? {
    restAlert(try s.state(activityMarks), words: Self.words)
  }

  @Test func aSetDueShowsItsLoadAndCheck() throws {
    let s = try Seance(past: [(Seance.squat, 60, 8)])
    let c = try content(s)
    #expect(c.status == .due)
    #expect(c.title == "Back squat")
    #expect(c.detail == "Série 1 sur 3")
    #expect(c.load == "60.0 kg × 8")
    #expect(c.showsCheck && !c.showsThirty)
    #expect(c.place == SetPlace(slotIndex: 0, position: 3))
    #expect(c.workoutId == s.workoutId)
    #expect(c.restEnd == nil && c.pausedAt == nil)
  }

  @Test func aWarmupShowsMontee() throws {
    let s = try Seance([Seance.slot(warmups: 2)], past: [(Seance.squat, 100, 8)])
    let c = try content(s)
    #expect(c.detail == "Montée")
    #expect(c.load == "50.0 kg × 5")
    #expect(c.showsCheck)
  }

  @Test func aRestShowsThirtyAndItsEnd() throws {
    let s = try Seance(past: [(Seance.squat, 60, 8)])
    try s.actions.logNext(count: nil, weightKg: nil, expecting: nil)
    let c = try content(s)
    #expect(c.status == .rest)
    #expect(c.title == "Repos")
    #expect(c.detail == "Ensuite · série 2 · 60.0 kg × 8")
    #expect(c.restEnd == Fixture.t0 + 120)
    #expect(c.showsThirty && !c.showsCheck)
    #expect(c.load == nil && c.place == nil)
  }

  @Test func aPauseShowsNoButton() throws {
    let s = try Seance(past: [(Seance.squat, 60, 8)])
    s.clock.advance(seconds: 90)
    try s.actions.pause()
    let c = try content(s)
    #expect(c.status == .paused)
    #expect(c.title == "En pause")
    #expect(c.detail == "Séance arrêtée à 1:30")
    #expect(c.pausedAt == c.startedAt + 90)
    #expect(!c.showsCheck && !c.showsThirty)
  }

  @Test func aTimedSetShowsNoCheck() throws {
    let s = try Seance([Seance.slot(Seance.hang)])
    let c = try content(s)
    #expect(c.status == .due)
    #expect(!c.showsCheck)
  }

  @Test func everySetDoneShowsNoCheck() throws {
    let s = try Seance([Seance.slot(sets: 1)])
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    try s.actions.skipRest()
    let c = try content(s)
    #expect(c.status == .allDone)
    #expect(c.title == "Tout est noté")
    #expect(!c.showsCheck && !c.showsThirty)
  }

  @Test func longTextsAreCutAndTheUpdateStaysSmall() throws {
    let long = String(repeating: "é", count: 200)
    let words = ActivityWords(
      name: { _ in long }, setOf: { _, _ in long }, warmup: long, load: { _, _, _ in long },
      rest: long, next: { _, _ in long }, paused: long, stoppedAt: { _ in long }, allDone: long,
      restOver: long, stale: long)
    let s = try Seance()
    let c = try #require(activityContent(try s.state(activityMarks), words: words))
    for text in [c.title, c.detail, c.load ?? "", c.staleLine, c.restOverTitle] {
      #expect(text.count == 80)
    }
    #expect(try JSONEncoder().encode(c).count < 4096)
  }

  @Test func nothingShownChangedIsNoUpdate() throws {
    let s = try Seance(past: [(Seance.squat, 60, 8)])
    try s.actions.logNext(count: nil, weightKg: nil, expecting: nil)
    let before = try content(s)
    // The rest's clock counts by itself: a tick changes nothing shown.
    s.clock.advance(seconds: 10)
    let after = try content(s)
    #expect(activityChange(from: before, to: after) == .none)
    try s.actions.addRest(seconds: 30)
    #expect(activityChange(from: after, to: try content(s)) == .update)
    #expect(activityChange(from: nil, to: after) == .start)
    #expect(activityChange(from: after, to: nil) == .end)
    #expect(activityChange(from: nil, to: nil) == .none)
  }

  @Test func theFirstReadAtLaunchAlwaysReachesTheSystem() throws {
    let due = try content(try Seance())
    // At launch an Activity from an earlier run may be there: the first read adopts or ends it.
    #expect(activityNeedsSync(from: nil, to: due, synced: false))
    #expect(activityNeedsSync(from: nil, to: nil, synced: false))
    // After that, only a change shown goes to the system.
    #expect(!activityNeedsSync(from: nil, to: nil, synced: true))
    #expect(!activityNeedsSync(from: due, to: due, synced: true))
    #expect(activityNeedsSync(from: due, to: nil, synced: true))
  }

  @Test func anotherSessionStartsAnew() throws {
    let a = try content(try Seance())
    var b = a
    b.workoutId = Fixture.id(9)
    #expect(activityChange(from: a, to: b) == .start)
  }

  @Test func staleWords() throws {
    let s = try Seance()
    let due = try content(s)
    #expect(due.staleLine == "Ouvre Belay pour continuer")
    #expect(due.restOverTitle == "Repos terminé")
    #expect(due.staleAt == nil)
    try s.actions.logNext(count: 8, weightKg: 60, expecting: nil)
    // Past the rest's end with no update, the Activity says the rest is over.
    #expect(try content(s).staleAt == Fixture.t0 + 120)
  }

  @Test func theRestAlertFollowsTheRest() throws {
    let s = try Seance(past: [(Seance.squat, 60, 8)])
    #expect(try plan(s) == .cancel)
    try s.actions.logNext(count: nil, weightKg: nil, expecting: nil)
    #expect(
      try plan(s)
        == .schedule(
          at: Fixture.t0 + 120, title: "Repos terminé",
          body: "Back squat · Série 2 sur 3 · 60.0 kg × 8"))
    try s.actions.addRest(seconds: 30)
    guard case .schedule(let at, _, _) = try plan(s) else {
      Issue.record("the alert moves")
      return
    }
    #expect(at == Fixture.t0 + 150)
    try s.actions.pause()
    #expect(try plan(s) == nil)
    try s.actions.resume()
    try s.actions.skipRest()
    #expect(try plan(s) == .cancel)
  }
}
