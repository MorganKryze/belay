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
}
