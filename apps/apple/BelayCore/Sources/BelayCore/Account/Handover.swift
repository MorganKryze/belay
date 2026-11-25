import Foundation

/// What the iPhone and its watch say to each other about the session, as dictionaries of strings.
/// The token travels only in the iPhone's reply to the watch's live request; the state the iPhone
/// publishes, which the system keeps on disk, holds the version and the session's id alone.
public enum Handover {
  /// Bumped when a message changes shape. A side reading another version takes the message as
  /// never sent.
  public static let version = "1"

  /// What the watch sends to ask for the iPhone's session.
  public static let request: [String: String] = ["v": version, "want": "session"]

  /// Whether `message` is the watch's request in this version, and nothing else.
  public static func isRequest(_ message: [String: Any]) -> Bool {
    message.count == request.count && message["v"] as? String == version
      && message["want"] as? String == request["want"]
  }

  /// The iPhone's answer to the request: its session for the instance at `origin`, or signed out
  /// when no token is kept there or the instance has not yet named its owner.
  public static func reply(session: StoredSession, origin: String?) -> [String: String] {
    guard let origin, let token = session.token(origin: origin), let userId = session.userId,
      let name = session.displayName, let id = session.handoverId(origin: origin)
    else { return ["v": version, "state": "signedOut"] }
    return [
      "v": version, "state": "session", "origin": origin, "token": token, "userId": userId,
      "name": name, "session": id,
    ]
  }

  /// What the iPhone publishes to its watch: the id of the session `reply` would hand, or no id
  /// when it would hand none, so a watch told of a session is never answered signed out. Never the
  /// token.
  public static func state(session: StoredSession, origin: String?) -> [String: String] {
    guard let id = reply(session: session, origin: origin)["session"] else { return ["v": version] }
    return ["v": version, "session": id]
  }
}

/// The iPhone's session as the watch receives it.
public struct HandedSession: Sendable, Equatable {
  public let origin: String
  public let token: String
  public let userId: String
  public let name: String
  /// The handover id the iPhone publishes for this token.
  public let id: String

  public init(origin: String, token: String, userId: String, name: String, id: String) {
    self.origin = origin
    self.token = token
    self.userId = userId
    self.name = name
    self.id = id
  }
}

/// The iPhone's answer to the watch's request, read on the watch.
public enum HandoverReply: Sendable, Equatable {
  case session(HandedSession)
  case signedOut

  /// Nil for another version, an unknown state or a session missing a field: the watch takes it
  /// as the iPhone out of reach.
  public init?(_ reply: [String: Any]) {
    guard reply["v"] as? String == Handover.version else { return nil }
    func field(_ key: String) -> String? {
      guard let value = reply[key] as? String, !value.isEmpty else { return nil }
      return value
    }
    switch reply["state"] as? String {
    case "signedOut":
      self = .signedOut
    case "session":
      guard let origin = field("origin"), let token = field("token"), let userId = field("userId"),
        let name = field("name"), let id = field("session")
      else { return nil }
      self = .session(HandedSession(origin: origin, token: token, userId: userId, name: name, id: id))
    default:
      return nil
    }
  }
}

/// The state the iPhone published, read on the watch.
public struct HandoverState: Sendable, Equatable {
  /// The id of the iPhone's kept session; nil when it is signed out.
  public let sessionId: String?

  /// Nil for another version.
  public init?(_ state: [String: Any]) {
    guard state["v"] as? String == Handover.version else { return nil }
    sessionId = state["session"] as? String
  }
}
