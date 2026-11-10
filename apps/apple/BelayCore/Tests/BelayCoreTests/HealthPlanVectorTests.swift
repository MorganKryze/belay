import Foundation
import Testing

@testable import BelayCore

// Which workouts Health should hold, as the web's Health plan computed it (`pnpm vectors`).

private struct HealthFile: Decodable, Sendable {
  struct Bounds: Decodable, Sendable {
    let earliest: Int64
    let day: Int64
    let sessionKey: String
  }
  struct PlanCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let on: Bool
    let turnedOnAt: Int64?
    let written: [String: HealthWritten]
    let allowed: Bool
    let owner: String
    let now: Int64
    let result: [HealthObject]
    var testDescription: String { name }
  }
  struct Span: Decodable, Sendable, Equatable {
    let startedAt: Int64
    let endedAt: Int64
  }
  struct SpanCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let workout: WorkoutRow
    let liveSets: Int
    let result: Span?
    var testDescription: String { name }
  }
  struct VersionCase: Decodable, Sendable, CustomTestStringConvertible {
    let latest: Int64
    let last: Int64?
    let result: Int64
    var testDescription: String { "\(latest) after \(last.map(String.init) ?? "none")" }
  }
  struct OwnerCase: Decodable, Sendable, CustomTestStringConvertible {
    let userId: String
    let result: String
    var testDescription: String { userId.isEmpty ? "empty" : userId }
  }

  let bounds: Bounds
  let workouts: [WorkoutRow]
  let sets: [SetRow]
  let planHealth: [PlanCase]
  let finishedSpan: [SpanCase]
  let versionOf: [VersionCase]
  let ownerOf: [OwnerCase]

  static func load() throws -> HealthFile {
    let url = try #require(
      Bundle.module.url(forResource: "health", withExtension: "json", subdirectory: "Vectors"))
    return try JSONDecoder().decode(HealthFile.self, from: Data(contentsOf: url))
  }
}

struct HealthPlanVectorTests {
  @Test func bounds() throws {
    let bounds = try HealthFile.load().bounds
    #expect(healthEarliest == bounds.earliest)
    #expect(healthDay == bounds.day)
    #expect(BelayCore.sessionKey("x") == bounds.sessionKey)
  }

  @Test(arguments: try HealthFile.load().planHealth)
  fileprivate func planHealth(_ c: HealthFile.PlanCase) throws {
    let file = try HealthFile.load()
    let input = HealthPlanInput(
      workouts: file.workouts, sets: file.sets, on: c.on, turnedOnAt: c.turnedOnAt,
      written: c.written, allowed: c.allowed, now: c.now, owner: c.owner)
    #expect(BelayCore.planHealth(input) == c.result)
  }

  @Test(arguments: try HealthFile.load().finishedSpan)
  fileprivate func finishedSpan(_ c: HealthFile.SpanCase) {
    let span = BelayCore.finishedSpan(c.workout, liveSets: c.liveSets)
    #expect(span.map { HealthFile.Span(startedAt: $0.startedAt, endedAt: $0.endedAt) } == c.result)
  }

  @Test(arguments: try HealthFile.load().versionOf)
  fileprivate func versionOf(_ c: HealthFile.VersionCase) {
    #expect(BelayCore.versionOf(latest: c.latest, last: c.last) == c.result)
  }

  @Test(arguments: try HealthFile.load().ownerOf)
  fileprivate func ownerOf(_ c: HealthFile.OwnerCase) {
    #expect(BelayCore.ownerOf(c.userId) == c.result)
  }

  /// A time the phone cannot read, from a server or a contract at fault, is no span: the session
  /// is left out, and one already written is removed, as the web's plan does with its NaN. A
  /// time on the row read only for the version is left out of it.
  @Test(arguments: ["startedAt", "endedAt"])
  func anUnreadableTimeIsNoSession(_ field: String) throws {
    let file = try HealthFile.load()
    var w = try #require(file.workouts.first)
    if field == "startedAt" { w.startedAt = "not a time" } else { w.endedAt = "not a time" }
    #expect(BelayCore.finishedSpan(w, liveSets: 1) == nil)
    let input = { (written: [String: HealthWritten]) in
      HealthPlanInput(
        workouts: [w], sets: file.sets, on: true, turnedOnAt: 0, written: written,
        allowed: true, now: Int64(Date().timeIntervalSince1970 * 1000), owner: "00000000")
    }
    #expect(BelayCore.planHealth(input([:])).isEmpty)
    let kept = HealthWritten.workout(version: 1, startedAt: 0, endedAt: 1)
    #expect(BelayCore.planHealth(input([sessionKey(w.id): kept])) == [.workoutRemoved(id: w.id)])
  }

  @Test func anUnreadableTimeIsLeftOutOfTheVersion() throws {
    let file = try HealthFile.load()
    var w = try #require(file.workouts.first)
    w.endedAtAt = "not a time"
    let input = HealthPlanInput(
      workouts: [w], sets: file.sets, on: true, turnedOnAt: 0, written: [:], allowed: true,
      now: Int64(Date().timeIntervalSince1970 * 1000), owner: "00000000")
    guard case .workout(_, _, _, let version) = BelayCore.planHealth(input).first else {
      Issue.record("the session is written")
      return
    }
    #expect(version == Instant.milliseconds(w.endedAt ?? ""))
  }
}
