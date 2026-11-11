public import Foundation

/// A place of a session: its slot and its position (warm-ups 0 to 2, work sets from 3).
public struct SetPlace: Codable, Sendable, Hashable {
  public var slotIndex: Int
  public var position: Int

  public init(slotIndex: Int, position: Int) {
    self.slotIndex = slotIndex
    self.position = position
  }
}

/// What the Live Activity shows, in words already in the phone's language. The app writes it;
/// the extension only draws it, so every text is decided in one place.
public struct ActivityContent: Codable, Hashable, Sendable {
  public enum Status: String, Codable, Hashable, Sendable { case due, rest, paused, allDone }

  public var status: Status
  /// The exercise while a set is due, else the state's word.
  public var title: String
  /// « Série k sur K », « Montée », the next set during a rest, the time stopped at.
  public var detail: String
  /// The load and count ✓ logs, or the seconds of a timed set; nil when no set is due.
  public var load: String?
  /// The session's start, moved past its pauses: the island's clock counts from it.
  public var startedAt: Date
  /// While paused, the moment the session's clock stands at.
  public var pausedAt: Date?
  public var restEnd: Date?
  public var showsCheck: Bool
  public var showsThirty: Bool
  /// The set ✓ logs, so a tap on an Activity left behind writes nothing.
  public var place: SetPlace?
  public var workoutId: String
  /// Said under the last content once the Activity is stale.
  public var staleLine: String
  /// Said alone once the rest's end passes with no update.
  public var restOverTitle: String

  public init(
    status: Status, title: String, detail: String, load: String?, startedAt: Date,
    pausedAt: Date?, restEnd: Date?, showsCheck: Bool, showsThirty: Bool, place: SetPlace?,
    workoutId: String, staleLine: String, restOverTitle: String
  ) {
    self.status = status
    self.title = title
    self.detail = detail
    self.load = load
    self.startedAt = startedAt
    self.pausedAt = pausedAt
    self.restEnd = restEnd
    self.showsCheck = showsCheck
    self.showsThirty = showsThirty
    self.place = place
    self.workoutId = workoutId
    self.staleLine = staleLine
    self.restOverTitle = restOverTitle
  }

  /// When the content stops being true by itself: a rest's end, after which the Activity says
  /// the rest is over. Other states stay true until the app updates them.
  public var staleAt: Date? { status == .rest ? restEnd : nil }
}
