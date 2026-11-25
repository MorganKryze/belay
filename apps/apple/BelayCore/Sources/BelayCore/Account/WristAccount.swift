import Foundation
import Observation
import os

/// How the watch asks its iPhone for the session, live.
public protocol PhoneAsking: Sendable {
  /// The iPhone's answer; nil when the iPhone is out of reach or answers in a form this build does
  /// not read.
  func askSession() async -> HandoverReply?
}

/// The watch's account: the iPhone's session, kept on the wrist, checked against the instance and
/// forgotten when the iPhone's session changes or the person signs the watch out. The watch never
/// ends the session on the instance: that would sign the iPhone out too.
@MainActor @Observable
public final class WristAccount {
  public enum State: Equatable, Sendable {
    /// Waiting for the iPhone's answer.
    case asking
    /// The iPhone did not answer, or the instance refused the token it gave.
    case phoneOut
    /// The iPhone answered that nobody is signed in.
    case phoneSignedOut
    /// A session is kept; `reached` is nil until the instance has answered this time.
    case connected(name: String, host: String, reached: Bool?)
    /// Signed out on the watch, which asks nothing until told to connect again.
    case signedOutHere
  }

  /// The address of the session's instance, as the iPhone handed it.
  static let instanceKey = "belay.instance"
  /// The handover id of the kept session, compared with each state the iPhone publishes.
  static let phoneSessionKey = "belay.phoneSession"
  /// Set when the person signs the watch out, lifted only by connecting again.
  static let signedOutHereKey = "belay.signedOutHere"

  public private(set) var state: State

  private let session: StoredSession
  private let defaults: UserDefaults
  private let http: HTTPClient
  private let phone: any PhoneAsking
  private let allowsLoopback: Bool
  /// Moves on with every drop, so an answer asked for before it is never kept or shown after it.
  private var round = 0
  /// The launch or return being handled: another trigger meanwhile adds no ask and no check. A
  /// sign-out on the watch lets it go, so connecting again starts afresh while the stale one ends.
  private var starting: Int?
  private var starts = 0

  private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "wrist")

  public init(
    secrets: SecretStore, defaults: UserDefaults, http: HTTPClient, phone: any PhoneAsking,
    allowsLoopback: Bool = Instance.allowsLoopbackByDefault
  ) {
    session = StoredSession(store: secrets, defaults: defaults)
    self.defaults = defaults
    self.http = http
    self.phone = phone
    self.allowsLoopback = allowsLoopback
    state = defaults.bool(forKey: Self.signedOutHereKey) ? .signedOutHere : .asking
  }

  /// At launch and at each return to the front: checks the kept session with the instance, or asks
  /// the iPhone for one.
  public func start() async {
    guard starting == nil else { return }
    starts += 1
    let mine = starts
    starting = mine
    defer { if starting == mine { starting = nil } }
    if signedOutHere {
      state = .signedOutHere
    } else if let kept {
      await check(kept)
    } else {
      await ask()
    }
  }

  /// The iPhone published its state. Another id drops the kept token first, then asks for the new
  /// session if the iPhone has one.
  public func received(_ published: HandoverState) async {
    guard !signedOutHere else { return }
    if let kept, kept.id == published.sessionId { return }
    forget()
    if published.sessionId == nil {
      state = .phoneSignedOut
    } else {
      await ask()
    }
  }

  /// « Réessayer »: the same as a return to the front.
  public func retry() async {
    await start()
  }

  /// Drops the watch's copy of the session and stays out across launches. The instance is not
  /// told, so the iPhone stays signed in.
  public func signOutHere() {
    defaults.set(true, forKey: Self.signedOutHereKey)
    starting = nil
    forget()
    state = .signedOutHere
  }

  /// Lifts the sign-out on the watch and asks the iPhone again.
  public func connectAgain() async {
    defaults.removeObject(forKey: Self.signedOutHereKey)
    await start()
  }

  private var signedOutHere: Bool { defaults.bool(forKey: Self.signedOutHereKey) }

  /// The session kept on the watch. Nothing is read from the Keychain without the address kept
  /// beside it, so a token an earlier install left there is never used.
  private var kept: (instance: Instance, token: String, id: String, name: String)? {
    guard let origin = defaults.string(forKey: Self.instanceKey),
      let instance = Instance(storedOrigin: origin, allowsLoopback: allowsLoopback),
      let id = defaults.string(forKey: Self.phoneSessionKey),
      let token = session.token(origin: origin)
    else { return nil }
    return (instance, token, id, session.displayName ?? "")
  }

  private func ask() async {
    let asked = round
    state = .asking
    let reply = await phone.askSession()
    guard asked == round else { return }
    switch reply {
    case nil:
      state = .phoneOut
    case .signedOut:
      state = .phoneSignedOut
    case .session(let handed):
      await keep(handed)
    }
  }

  /// Replaces whatever was kept with `handed`, if its address is one the iPhone's own sign-in
  /// accepts, then checks it.
  private func keep(_ handed: HandedSession) async {
    forget()
    guard let instance = Instance(storedOrigin: handed.origin, allowsLoopback: allowsLoopback) else {
      Self.log.error("handed session refused: not an instance address")
      state = .phoneOut
      return
    }
    do {
      try session.keep(origin: handed.origin, token: handed.token)
    } catch {
      Self.log.error("keychain write failed: \((error as? KeychainError)?.status ?? 0)")
      state = .phoneOut
      return
    }
    defaults.set(handed.origin, forKey: Self.instanceKey)
    defaults.set(handed.id, forKey: Self.phoneSessionKey)
    session.remember(userId: handed.userId, displayName: handed.name, media: false)
    await check((instance, handed.token, handed.id, handed.name))
  }

  /// Asks the instance whom the token belongs to: a refusal drops it, no answer keeps it.
  private func check(_ kept: (instance: Instance, token: String, id: String, name: String)) async {
    let checked = round
    let host = kept.instance.origin.host(percentEncoded: false) ?? ""
    state = .connected(name: kept.name, host: host, reached: nil)
    let answer = await me(token: kept.token, at: kept.instance, using: http)
    guard checked == round else { return }
    switch answer {
    case .success(let me):
      session.remember(userId: me.id, displayName: me.displayName, media: me.media)
      state = .connected(name: me.displayName, host: host, reached: true)
    case .failure(.failed):
      Self.log.info("instance refused the token")
      forget()
      state = .phoneOut
    case .failure:
      state = .connected(name: kept.name, host: host, reached: false)
    }
  }

  /// Drops the token and everything kept beside it. The store's sign-out mark is written before the
  /// token is deleted, so a token the Keychain failed to drop is never read again.
  private func forget() {
    round += 1
    defaults.removeObject(forKey: Self.instanceKey)
    defaults.removeObject(forKey: Self.phoneSessionKey)
    do {
      try session.drop()
    } catch {
      Self.log.error("keychain drop failed: \((error as? KeychainError)?.status ?? 0)")
    }
  }
}
