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

  struct WeighInBounds: Decodable, Sendable {
    let weighingKey: String
    let historyDay: String
    let importStampMs: Int64
  }
  struct WeighInCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let turnedOnAt: Int64?
    let written: [String: HealthWritten]
    /// The file's weigh-ins unless the case brings its own.
    let weights: [WeightRow]?
    let allowed: Bool
    let owner: String
    let now: Int64
    let result: [HealthObject]
    var testDescription: String { name }
  }
  struct SampleTimeCase: Decodable, Sendable, CustomTestStringConvertible {
    let date: String
    let now: Int64
    let result: Int64
    var testDescription: String { "\(date) at \(now)" }
  }
  struct EarliestCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let samples: [HealthSample]
    let fromDay: String
    let result: [String: HealthSample]
    var testDescription: String { name }
  }
  struct ImportCase: Decodable, Sendable, CustomTestStringConvertible {
    let name: String
    let rows: [WeightRow]
    let filled: [String: Filled]
    let samples: [HealthSample]
    let now: Int64
    let result: [WeightChange]
    var testDescription: String { name }
  }

  let bounds: Bounds
  let weighInBounds: WeighInBounds
  let weights: [WeightRow]
  let planWeighIns: [WeighInCase]
  let sampleTime: [SampleTimeCase]
  let earliestPerDay: [EarliestCase]
  let importChoice: [ImportCase]
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

private let paris = TimeZone(identifier: "Europe/Paris")!

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

  @Test func weighInBounds() throws {
    let bounds = try HealthFile.load().weighInBounds
    #expect(BelayCore.weighingKey("2026-10-10") == bounds.weighingKey)
    #expect(toISODate(Date(ms: healthEarliest), timeZone: paris) == bounds.historyDay)
    #expect(BelayCore.importStampMs == bounds.importStampMs)
  }

  @Test(arguments: try HealthFile.load().planWeighIns)
  fileprivate func planWeighIns(_ c: HealthFile.WeighInCase) throws {
    let file = try HealthFile.load()
    let input = HealthPlanInput(
      workouts: [], sets: [], on: true, turnedOnAt: c.turnedOnAt, written: c.written,
      allowed: false, now: c.now, owner: c.owner, weights: c.weights ?? file.weights,
      allowedWeighIns: c.allowed, timeZone: paris)
    #expect(BelayCore.planHealth(input) == c.result)
  }

  @Test(arguments: try HealthFile.load().sampleTime)
  fileprivate func sampleTime(_ c: HealthFile.SampleTimeCase) {
    #expect(BelayCore.sampleTime(c.date, now: c.now, timeZone: paris) == c.result)
  }

  @Test(arguments: try HealthFile.load().earliestPerDay)
  fileprivate func earliestPerDay(_ c: HealthFile.EarliestCase) {
    #expect(BelayCore.earliestPerDay(c.samples, fromDay: c.fromDay, timeZone: paris) == c.result)
  }

  /// The days the web's import filled, from the same rows and readings: the import reads from
  /// the history's floor.
  @Test(arguments: try HealthFile.load().importChoice)
  fileprivate func importChoice(_ c: HealthFile.ImportCase) throws {
    let floor = try HealthFile.load().weighInBounds.historyDay
    let now = Date(ms: c.now)
    let choice = BelayCore.importChoice(
      BelayCore.earliestPerDay(c.samples, fromDay: floor, timeZone: paris),
      rows: Dictionary(uniqueKeysWithValues: c.rows.map { ($0.date, $0) }), filled: c.filled,
      today: toISODate(now, timeZone: paris), now: now, timeZone: paris)
    #expect(choice == c.result.sorted { $0.date < $1.date })
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
