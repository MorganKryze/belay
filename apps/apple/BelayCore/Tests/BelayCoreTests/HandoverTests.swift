import Foundation
import Testing

@testable import BelayCore

/// A store that keeps one token in memory.
private final class MemoryStore: SecretStore, @unchecked Sendable {
  private let lock = NSLock()
  private var kept: (origin: String, token: String)?

  func read(origin: String) -> String? {
    lock.withLock { kept?.origin == origin ? kept?.token : nil }
  }

  func write(origin: String, token: String) throws {
    lock.withLock { kept = (origin, token) }
  }

  func clear() throws {
    lock.withLock { kept = nil }
  }
}

private let origin = "https://belay.example.org"
private let token = "s3cr3t-t0k3n"

/// Fresh defaults per test, so no test sees another's marker.
private func freshDefaults() -> UserDefaults {
  let name = "HandoverTests.\(UUID().uuidString)"
  let defaults = UserDefaults(suiteName: name)!
  defaults.removePersistentDomain(forName: name)
  return defaults
}

/// A session kept and named by the instance, as the iPhone holds it once signed in.
private func signedIn(store: SecretStore = MemoryStore(), defaults: UserDefaults = freshDefaults())
  throws -> StoredSession
{
  let session = StoredSession(store: store, defaults: defaults)
  try session.keep(origin: origin, token: token)
  session.remember(userId: "ana", displayName: "Ana", media: false)
  return session
}

@Suite struct HandoverTests {
  @Test func aKeptSessionIsHandedWithItsAddressTokenPersonAndId() throws {
    let session = try signedIn()
    let id = try #require(session.handoverId(origin: origin))
    let reply = Handover.reply(session: session, origin: origin)
    #expect(
      reply == [
        "v": "1", "state": "session", "origin": origin, "token": token, "userId": "ana",
        "name": "Ana", "session": id,
      ])
    #expect(
      HandoverReply(reply)
        == .session(HandedSession(origin: origin, token: token, userId: "ana", name: "Ana", id: id)))
  }

  @Test func nobodySignedInHandsNoToken() throws {
    let signedOut: [String: String] = ["v": "1", "state": "signedOut"]
    let empty = StoredSession(store: MemoryStore(), defaults: freshDefaults())
    #expect(Handover.reply(session: empty, origin: origin) == signedOut)
    #expect(Handover.reply(session: empty, origin: nil) == signedOut)

    // A sign-out the store could not finish: the token is still there, the mark says it is gone.
    let store = MemoryStore()
    let defaults = freshDefaults()
    let session = try signedIn(store: store, defaults: defaults)
    defaults.set(true, forKey: StoredSession.signedOutKey)
    #expect(store.read(origin: origin) == token)
    #expect(Handover.reply(session: session, origin: origin) == signedOut)
    #expect(HandoverReply(signedOut) == .signedOut)

    // A token kept but no instance address to go with it.
    #expect(Handover.reply(session: try signedIn(), origin: nil) == signedOut)
  }

  @Test func anUnknownOrOlderRequestGetsNoToken() {
    #expect(Handover.isRequest(Handover.request))
    #expect(Handover.request == ["v": "1", "want": "session"])
    #expect(!Handover.isRequest(["want": "session"]))
    #expect(!Handover.isRequest(["v": "2", "want": "session"]))
    #expect(!Handover.isRequest(["v": "1", "want": "everything"]))
    #expect(!Handover.isRequest(["v": "1"]))
    #expect(!Handover.isRequest(["v": 1, "want": "session"]))
    #expect(!Handover.isRequest([:]))
    #expect(!Handover.isRequest(["v": "1", "want": "session", "and": "more"]))
  }

  @Test func onlyTheExactRequestGetsTheReply() {
    let reply = ["v": "1", "state": "session", "token": "secret"]
    var asked = 0
    let answering: () -> [String: String] = {
      asked += 1
      return reply
    }
    #expect(Handover.answer(to: Handover.request, with: answering) == reply)
    #expect(Handover.answer(to: ["v": "1", "want": "session", "and": "more"], with: answering) == [:])
    #expect(Handover.answer(to: ["v": "2", "want": "session"], with: answering) == [:])
    #expect(Handover.answer(to: [:], with: answering) == [:])
    #expect(asked == 1)
  }

  @Test func theStateNeverHoldsTheToken() throws {
    let store = MemoryStore()
    let session = try signedIn(store: store)
    let id = try #require(session.handoverId(origin: origin))

    let signedInState = Handover.state(session: session, origin: origin)
    #expect(Set(signedInState.keys) == ["v", "session"])
    #expect(signedInState == ["v": "1", "session": id])
    #expect(HandoverState(signedInState)?.sessionId == id)

    try session.drop()
    try store.write(origin: origin, token: token)
    let signedOutState = Handover.state(session: session, origin: origin)
    #expect(Set(signedOutState.keys) == ["v"])
    #expect(HandoverState(signedOutState)?.sessionId == nil)
    #expect(HandoverState(signedOutState) != nil)

    for state in [signedInState, signedOutState] {
      for value in state.values {
        #expect(!value.contains(token))
      }
    }
  }

  @Test func theStatePublishesAnIdOnlyOnceTheSessionWouldBeHanded() throws {
    let session = StoredSession(store: MemoryStore(), defaults: freshDefaults())
    try session.keep(origin: origin, token: token)
    #expect(Handover.reply(session: session, origin: origin) == ["v": "1", "state": "signedOut"])
    #expect(Handover.state(session: session, origin: origin) == ["v": "1"])

    session.remember(userId: "ana", displayName: "Ana", media: false)
    let id = try #require(Handover.reply(session: session, origin: origin)["session"])
    #expect(Handover.state(session: session, origin: origin) == ["v": "1", "session": id])
  }

  @Test func aStateOfAnotherVersionIsNotRead() {
    #expect(HandoverState(["v": "2", "session": "x"]) == nil)
    #expect(HandoverState([:]) == nil)
  }

  @Test func aReplyWithAMissingFieldIsNotASession() {
    let full: [String: String] = [
      "v": "1", "state": "session", "origin": origin, "token": token, "userId": "ana", "name": "Ana",
      "session": "id",
    ]
    #expect(HandoverReply(full) != nil)
    for key in full.keys {
      var missing = full
      missing[key] = nil
      #expect(HandoverReply(missing) == nil, "without \(key)")
    }
    for key in ["origin", "token", "userId", "name", "session"] {
      var empty = full
      empty[key] = ""
      #expect(HandoverReply(empty) == nil, "with an empty \(key)")
    }
    var later = full
    later["v"] = "2"
    #expect(HandoverReply(later) == nil)
    #expect(HandoverReply(["v": "2", "state": "signedOut"]) == nil)
    #expect(HandoverReply([:]) == nil)
  }
}
