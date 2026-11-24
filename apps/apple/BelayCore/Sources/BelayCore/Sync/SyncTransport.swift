import Foundation

/// Where the sync stands, as a screen tells it: nothing to say while idle or syncing.
public enum SyncStatus: Sendable, Equatable {
  case idle, syncing
  /// The instance was not reached; the queue waits for the network.
  case offline
  /// The token was refused: the queue waits for a new sign-in.
  case expired
  /// The server answered but not with rows, or the store did not take them.
  case failed
  /// The instance speaks a later contract version: nothing goes out until the app is updated.
  case instanceAhead
  /// The instance speaks an earlier contract version: nothing goes out until it is updated.
  case instanceBehind

  /// What the screen says once this status arrives, `shown` being what it said until now: a run
  /// under way keeps the last line, so each trigger while offline does not hide it and show it
  /// again; the run's end replaces it.
  public func noticed(after shown: SyncStatus) -> SyncStatus {
    self == .syncing ? shown : self
  }
}

/// What one request came back with.
public enum SendResult: Sendable {
  case ok(SyncResponse)
  case offline, expired, failed

  /// The status a run ends on after this result; a 200 goes on with the rounds.
  var status: SyncStatus {
    switch self {
    case .ok: .idle
    case .offline: .offline
    case .expired: .expired
    case .failed: .failed
    }
  }
}

/// How a sync request reaches the server; tests script one in its place.
public protocol SyncTransport: Sendable {
  func send(_ request: SyncRequest) async -> SendResult
}

/// Asks the instance which contract version it speaks; tests script one in its place.
public protocol VersionProbe: Sendable {
  /// Nil when the instance was not reached or did not answer as Belay.
  func version() async -> VersionAnswer?
}
