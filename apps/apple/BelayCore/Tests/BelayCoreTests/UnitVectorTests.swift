import Foundation
import Testing

@testable import BelayCore

// The weight units as the shared rules computed them (`pnpm vectors`): the conversions, steps,
// bounds in pounds, increments and pound plates, and the read-back of a prefill confirmed as
// shown. Then what only the phone has, the load choices, and what reaches the queue: kilos on
// their grid, whatever unit they were typed in.

private struct UnitsFile: Decodable, Sendable {
  let units: Units

  static func load() throws -> Units { try BelayCoreTests.load("rules", as: Self.self).units }
}

private struct Units: Decodable, Sendable {
  struct Range: Decodable, Sendable {
    let min: Double
    let max: Double
  }
  struct Plates: Decodable, Sendable {
    let barLb: Double
    let platesLb: [Double]
  }
  struct Conversion: Decodable, Sendable, CustomTestStringConvertible {
    let fn: String
    let value: Double
    let unit: WeightUnit
    let result: Double
    var testDescription: String { "\(fn)(\(value), \(unit))" }
  }
  struct StepCase: Decodable, Sendable {
    let stepKg: Double
    let unit: WeightUnit
    let result: Double
  }
  struct RangeCase: Decodable, Sendable {
    let name: String
    let range: Range
    let unit: WeightUnit
    let step: Double
    let result: Range
  }
  struct IncrementCase: Decodable, Sendable {
    let equipment: Equipment
    let incrementKg: Double
    let unit: WeightUnit
    let result: Double
  }
  struct Prefill: Decodable, Sendable {
    let kg: Double
    let shownKg: Double
  }
  struct ReadBackCase: Decodable, Sendable {
    let typedKg: Double
    let prefill: Prefill?
    let result: Double
  }
  struct LoadCase: Decodable, Sendable {
    let value: Double
    let unit: WeightUnit
    let prefillKg: Double?
    let result: Double?
  }
  struct WeighingCase: Decodable, Sendable {
    let value: Double
    let unit: WeightUnit
    let result: Double?
  }
  let kgPerLb: Double
  let incrementLb: [String: Double]
  let poundPlates: Plates
  let conversions: [Conversion]
  let stepIn: [StepCase]
  let rangeIn: [RangeCase]
  let incrementIn: [IncrementCase]
  let readBack: [ReadBackCase]
  let loadKgFrom: [LoadCase]
  let weighingKgFrom: [WeighingCase]
}

/// Every value a change carries under `weightKg`, wherever it sits in the queued bytes.
private func weights(in value: JSONValue) -> [Double] {
  switch value {
  case .object(let fields):
    fields.flatMap { key, field in
      if key == "weightKg", case .number(let kg) = field { [kg] } else { weights(in: field) }
    }
  case .array(let items): items.flatMap(weights(in:))
  default: []
  }
}

private func queuedWeights(_ store: AccountStore) throws -> [Double] {
  try store.outbox(limit: nil).flatMap { entry in
    weights(in: try JSONDecoder().decode(JSONValue.self, from: entry.bytes))
  }
}

/// The app's sources and its Live Activity's, beside this package.
private let appleFolder = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()

@Suite struct UnitVectorTests {
  @Test func unitRulesMatchVectors() throws {
    let units = try UnitsFile.load()
    #expect(kgPerLb == units.kgPerLb)
    #expect(poundPlates.barLb == units.poundPlates.barLb)
    #expect(poundPlates.platesLb == units.poundPlates.platesLb)
    let byName = Dictionary(uniqueKeysWithValues: incrementLb.map { ($0.rawValue, $1) })
    #expect(byName == units.incrementLb)
    for c in units.conversions {
      let got: Double? =
        switch c.fn {
        case "kgToLb": kgToLb(c.value)
        case "lbToKg": lbToKg(c.value)
        case "kgFromLoad": kgFromLoad(c.value, c.unit)
        case "loadFromKg": loadFromKg(c.value, c.unit)
        case "kgFromWeighing": kgFromWeighing(c.value, c.unit)
        case "weighingFromKg": weighingFromKg(c.value, c.unit)
        default: nil
        }
      let value = try #require(got, "\(c.fn) has no port")
      // The plain conversions are kept to 12 decimals; the rounded ones land exactly on a grid.
      if c.fn == "kgToLb" || c.fn == "lbToKg" {
        #expect(abs(value - c.result) < 1e-9, "\(c.testDescription)")
      } else {
        #expect(value == c.result, "\(c.testDescription)")
      }
    }
    for c in units.stepIn {
      #expect(stepIn(c.stepKg, c.unit) == c.result, "\(c.stepKg) kg in \(c.unit)")
    }
    for c in units.rangeIn {
      let got = rangeIn(c.range.min...c.range.max, c.unit, step: c.step)
      #expect(got == c.result.min...c.result.max, "\(c.name) in \(c.unit)")
    }
    for c in units.incrementIn {
      let exercise = LibraryExercise(
        id: "belay:x", name: "X", equipment: c.equipment, incrementKg: c.incrementKg, measure: nil)
      #expect(incrementIn(exercise, c.unit) == c.result, "\(c.equipment) in \(c.unit)")
    }
    for c in units.weighingKgFrom {
      #expect(weighingKgFrom(c.value, c.unit) == c.result, "\(c.value) \(c.unit)")
    }
  }

  @Test func readBackMatchesVectors() throws {
    let units = try UnitsFile.load()
    #expect(!units.readBack.isEmpty && !units.loadKgFrom.isEmpty)
    for c in units.readBack {
      let prefill = c.prefill.map { (kg: $0.kg, shownKg: $0.shownKg) }
      #expect(readBack(c.typedKg, prefill: prefill) == c.result, "\(c.typedKg) kg typed")
    }
    for c in units.loadKgFrom {
      #expect(
        loadKgFrom(c.value, c.unit, prefillKg: c.prefillKg) == c.result,
        "\(c.value) \(c.unit), prefill \(String(describing: c.prefillKg))")
    }
  }

  @Test(arguments: [WeightUnit.kg, .lb])
  func loadChoicesKeepTheCurrentKilos(_ unit: WeightUnit) {
    let step: Double = unit == .kg ? 2.5 : 5
    for kg in [20, 60, 81.25, 100, 102.5] {
      let choices = loadChoices(weightKg: kg, stepInUnit: step, unit)
      #expect(choices.count == 4, "\(kg) kg")
      #expect(choices[1] == kg, "\(kg) kg")
      let shown = loadFromKg(kg, unit)
      let expected = [shown - step, shown, shown + step, shown + 2 * step]
      #expect(choices.map { loadFromKg($0, unit) } == expected, "\(kg) kg")
    }
    // 60 kg reads 132 lb: a step down and two up land on the quarter kilo nearest each pound.
    #expect(loadChoices(weightKg: 60, stepInUnit: 5, .lb) == [57.5, 60, 62.25, 64.5])
  }

  @Test(arguments: [WeightUnit.kg, .lb])
  func loadChoicesInsideSetBounds(_ unit: WeightUnit) {
    let step: Double = unit == .kg ? 2.5 : 5
    for kg in [0, 0.25, 1, 498, 499.75, 500] {
      let choices = loadChoices(weightKg: kg, stepInUnit: step, unit)
      #expect(choices.contains(kg), "\(kg) kg")
      #expect(choices.allSatisfy(isSetKg), "\(kg) kg: \(choices)")
      #expect(Set(choices).count == choices.count, "\(kg) kg: \(choices)")
    }
    #expect(loadChoices(weightKg: 0, stepInUnit: 5, .lb) == [0, 2.25, 4.5])
    #expect(loadChoices(weightKg: 500, stepInUnit: 2.5, .kg) == [497.5, 500])
  }

  @Test func poundLoadQueuedOnQuarterKilo() throws {
    let s = try Seance()
    let kg = try #require(loadKgFrom(225, .lb, prefillKg: nil))
    try s.actions.logNext(count: 8, weightKg: kg, expecting: nil)
    #expect(try queuedWeights(s.store).last == 102)
  }

  @Test func poundWeighingQueuedOnTenthKilo() throws {
    let store = try AccountStore.inMemory(userId: "u1")
    let body = BodyActions(store: store, now: { Fixture.t0 }, timeZone: Days.paris)
    try body.weigh(date: "2026-11-05", kg: try #require(weighingKgFrom(177.25, .lb)))
    #expect(try queuedWeights(store) == [80.4])
  }

  /// The pound's factor lives in the core alone: a screen that converts by hand drifts from the
  /// grid the web stores on.
  @Test func appConvertsOnlyThroughUnits() throws {
    let factor = try Regex(#"0\.45[0-9]|2\.20[0-9]|/ *0\.45"#)
    var faults: [String] = []
    for folder in ["Belay", "BelayActivity"] {
      let walk = FileManager.default.enumerator(
        at: appleFolder.appending(path: folder, directoryHint: .isDirectory),
        includingPropertiesForKeys: nil)
      let files = ((walk?.allObjects as? [URL]) ?? []).filter { $0.pathExtension == "swift" }
      #expect(!files.isEmpty, "\(folder) has Swift files")
      for file in files {
        let lines = try String(contentsOf: file, encoding: .utf8).split(separator: "\n")
        for (i, line) in lines.enumerated() where line.contains(factor) {
          faults.append("\(file.lastPathComponent):\(i + 1): \(line)")
        }
      }
    }
    #expect(faults.isEmpty, "\(faults)")
  }
}
