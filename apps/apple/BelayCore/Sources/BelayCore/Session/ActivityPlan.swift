public import BelayActivity
public import Foundation

// What the Live Activity and the rest alert show, as pure functions of the session state: the
// app follows the store and hands each state here, so the Activity changes only when what it
// shows changes, never per tick.

/// The words the Activity and the alert use, in the phone's language; the app gives them.
public struct ActivityWords: Sendable {
  /// An exercise's name from its id.
  public var name: @Sendable (String) -> String
  /// « Série k sur K ».
  public var setOf: @Sendable (Int, Int) -> String
  public var warmup: String
  /// A load and count, or the seconds of a timed set (true).
  public var load: @Sendable (Double, Int, Bool) -> String
  public var rest: String
  /// « Ensuite · série k · {charge} ».
  public var next: @Sendable (Int, String) -> String
  public var paused: String
  /// « Séance arrêtée à {temps} ».
  public var stoppedAt: @Sendable (String) -> String
  public var allDone: String
  public var restOver: String
  public var stale: String

  public init(
    name: @escaping @Sendable (String) -> String,
    setOf: @escaping @Sendable (Int, Int) -> String, warmup: String,
    load: @escaping @Sendable (Double, Int, Bool) -> String, rest: String,
    next: @escaping @Sendable (Int, String) -> String, paused: String,
    stoppedAt: @escaping @Sendable (String) -> String, allDone: String, restOver: String,
    stale: String
  ) {
    self.name = name
    self.setOf = setOf
    self.warmup = warmup
    self.load = load
    self.rest = rest
    self.next = next
    self.paused = paused
    self.stoppedAt = stoppedAt
    self.allDone = allDone
    self.restOver = restOver
    self.stale = stale
  }
}

/// The marks the Activity reads the state with: no screen holds a recap or an announcement
/// there, so the rest shows as soon as it runs.
public let activityMarks = SessionMarks(recapTapped: true, restCardAsked: true)

/// What to do with the Activity to show `to` where `from` shows.
public enum ActivityStep: Sendable, Equatable {
  case none
  /// Start one, ending any other first: one Activity at a time.
  case start
  case update
  case end
}

/// The one pending notification at the rest's end.
public enum RestAlertPlan: Sendable, Equatable {
  case schedule(at: Date, title: String, body: String)
  case cancel
}

/// A text the Activity shows stays within this many characters, so an update stays far under
/// the system's 4 KB.
let activityTextMax = 80

private func capped(_ text: String) -> String { String(text.prefix(activityTextMax)) }

private func setLine(_ due: DueSet, _ words: ActivityWords) -> String {
  due.warmup ? words.warmup : words.setOf(due.number, due.of)
}

/// The load and count of the set; only what ✓ lifts, never a body weight.
private func loadLine(_ due: DueSet, _ words: ActivityWords) -> String {
  words.load(due.weightKg, due.count, due.timed)
}

/// « 1:30 », « 1:02:05 ».
func clockText(ms: Int) -> String {
  let total = max(0, ms / 1000)
  let (h, m, s) = (total / 3600, total / 60 % 60, total % 60)
  let two = { (n: Int) in n < 10 ? "0\(n)" : "\(n)" }
  return h > 0 ? "\(h):\(two(m)):\(two(s))" : "\(m):\(two(s))"
}

/// The Activity's content for `state`, read with `activityMarks`.
public func activityContent(_ state: SessionState, words: ActivityWords) -> ActivityContent? {
  var content = ActivityContent(
    status: .due, title: "", detail: "", load: nil, startedAt: state.startedAt, pausedAt: nil,
    restEnd: nil, showsCheck: false, showsThirty: false, place: nil, workoutId: state.workoutId,
    staleLine: capped(words.stale), restOverTitle: capped(words.restOver))

  func due(_ set: DueSet, check: Bool) {
    content.title = capped(words.name(set.exerciseId))
    content.detail = capped(setLine(set, words))
    content.load = capped(loadLine(set, words))
    // A timed set needs its chrono, which only the app runs.
    content.showsCheck = check && !set.timed
    content.place = content.showsCheck ? set.place : nil
  }

  func rest(_ end: Date?, next: DueSet?) {
    content.status = .rest
    content.title = capped(words.rest)
    content.detail = next.map { capped(words.next($0.number, loadLine($0, words))) } ?? ""
    content.restEnd = end
    content.showsThirty = end != nil
  }

  switch state.phase {
  case .due(let set): due(set, check: true)
  case .holding(let hold): due(hold.due, check: false)
  case .held(let held): due(held.due, check: false)
  case .resting(let r): rest(r.endsAt, next: r.next)
  case .announce(let a): rest(a.restEndsAt, next: a.next)
  // Only a screen holds a recap; read with `activityMarks` it never shows here.
  case .recap: rest(nil, next: nil)
  case .allDone:
    content.status = .allDone
    content.title = capped(words.allDone)
  case .paused(let p):
    content.status = .paused
    content.title = capped(words.paused)
    content.detail = capped(words.stoppedAt(clockText(ms: p.elapsedMs)))
    content.pausedAt = state.startedAt + Double(p.elapsedMs) / 1000
  }
  return content
}

public func activityChange(from: ActivityContent?, to: ActivityContent?) -> ActivityStep {
  switch (from, to) {
  case (nil, nil): .none
  case (nil, .some): .start
  case (.some, nil): .end
  case (.some(let a), .some(let b)):
    a.workoutId != b.workoutId ? .start : a == b ? .none : .update
  }
}

/// Whether the system must hear of `to`. The first read after launch always goes, so an Activity
/// left from an earlier run is kept for the open session or ended; after it, only a change does.
public func activityNeedsSync(from: ActivityContent?, to: ActivityContent?, synced: Bool) -> Bool {
  !synced || activityChange(from: from, to: to) != .none
}

/// The alert at the rest's end: « Repos terminé », then the next set and its exercise. Nil while
/// paused: the rest stands still and no alert is due until it runs again.
public func restAlert(_ state: SessionState, words: ActivityWords) -> RestAlertPlan? {
  let end: Date
  let next: DueSet?
  switch state.phase {
  case .paused: return nil
  case .resting(let r): (end, next) = (r.endsAt, r.next)
  case .announce(let a): (end, next) = (a.restEndsAt, a.next)
  default: return .cancel
  }
  let body = next.map {
    [words.name($0.exerciseId), setLine($0, words), loadLine($0, words)].joined(separator: " · ")
  }
  return .schedule(at: end, title: words.restOver, body: body ?? "")
}
