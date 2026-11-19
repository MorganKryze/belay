import Foundation

// Loading a bar: the plates per side that reach a load, on the person's bar and plates.

/// A bar and the plates there are for it, in kg.
public struct Plates: Codable, Sendable, Equatable {
  public let barKg: Double
  public let platesKg: [Double]

  public init(barKg: Double, platesKg: [Double]) {
    self.barKg = barKg
    self.platesKg = platesKg
  }

  /// A standard gym: a 20 kg bar, plates of 20, 10, 5 and 2.5 kg.
  public static let gym = Plates(barKg: 20, platesKg: [20, 10, 5, 2.5])
  /// A competition set, every IWF disc.
  public static let competition = Plates(
    barKg: 20, platesKg: [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1, 0.5])
}

/// A load on the bar and its plates per side, heaviest first.
public struct Loading: Codable, Sendable, Equatable {
  public let totalKg: Double
  public let perSideKg: [Double]

  public init(totalKg: Double, perSideKg: [Double]) {
    self.totalKg = totalKg
    self.perSideKg = perSideKg
  }
}

/// The presets the plate tool offers, in its order: the session's own plates.
public let platePresets: [(id: String, plates: Plates)] = [
  ("competition", .competition), ("gym", .gym),
]
/// A standard pound gym: a 45 lb bar and its plates. The tool counts without a unit, so these
/// load in pounds.
public let lbPlates = Plates(barKg: 45, platesKg: [45, 35, 25, 10, 5, 2.5])
/// What the custom set offers as one-tap chips; any other value can be added by hand.
public let standardPlatesKg: [Double] = [25, 20, 15, 10, 5, 2.5, 2, 1.5, 1.25, 1, 0.5]
public let standardBarsKg: [Double] = [20, 15, 10]

/// IWF Technical and Competition Rules 2020, rule 3.3.3.6.
public enum IwfColor: String, Sendable {
  case red, blue, yellow, green, white
}

/// There is no 1.25 kg IWF disc and no official color for one: every value outside the table is
/// drawn neutral grey.
public func iwfColor(_ kg: Double) -> IwfColor? {
  switch kg {
  case 25, 2.5: .red
  case 20, 2: .blue
  case 15, 1.5: .yellow
  case 10, 1: .green
  case 5, 0.5: .white
  default: nil
  }
}

/// The target exactly, or the reachable loads either side of it; `below` is nil under the bar,
/// `above` nil past what the plates can add.
public enum BarLoad: Sendable, Equatable {
  case exact(Loading)
  case unreachable(below: Loading?, above: Loading?)
}

/// Bounds the change-making table: 1000 kg is 50 000 hundredths per side.
public let maxTargetKg = 1000.0

private func toCenti(_ kg: Double) -> Int { Int(jsRound(kg * 100)) }

/// The fewest plates per side for the target, heaviest first. Counted in hundredths of a kilo, so
/// 2.5 + 1.25 never drifts. Assumes as many plates of each weight as needed.
public func loadBar(_ targetKg: Double, barKg: Double, platesKg: [Double]) throws(OutOfRange)
  -> BarLoad
{
  guard targetKg.isFinite && targetKg <= maxTargetKg else { throw OutOfRange(message: "target") }
  guard barKg.isFinite && barKg > 0 else { throw OutOfRange(message: "bar") }
  guard platesKg.allSatisfy(\.isFinite) else { throw OutOfRange(message: "plates") }
  let bar = toCenti(barKg)
  let plates = Set(platesKg.map(toCenti)).filter { $0 > 0 }.sorted(by: >)
  let half = Double(toCenti(targetKg) - bar) / 2
  let barOnly = Loading(totalKg: Double(bar) / 100, perSideKg: [])
  if half < 0 { return .unreachable(below: nil, above: barOnly) }

  // count[a] = fewest plates adding up to a, nil when no combination does.
  let limit = Int(half.rounded(.up)) + (plates.first ?? 0)
  var count = [Int?](repeating: nil, count: limit + 1)
  count[0] = 0
  for a in stride(from: 1, through: limit, by: 1) {
    for p in plates where p <= a {
      if let before = count[a - p], before + 1 < (count[a] ?? .max) { count[a] = before + 1 }
    }
  }
  // Heaviest plate first among the optimal choices: "20 + 10 + 5", never "5 + 10 + 20".
  func loading(_ amount: Int) -> Loading {
    var side: [Double] = []
    var rest = amount
    while rest > 0, let need = count[rest] {
      guard let p = plates.first(where: { $0 <= rest && count[rest - $0] == need - 1 }) else {
        break
      }
      side.append(Double(p) / 100)
      rest -= p
    }
    return Loading(totalKg: Double(bar + 2 * amount) / 100, perSideKg: side)
  }

  if half.rounded() == half, count[Int(half)] != nil { return .exact(loading(Int(half))) }
  var lo = Int(half.rounded(.down))
  while count[lo] == nil { lo -= 1 }  // count[0] is 0, so this stops
  var hi = Int(half.rounded(.up))
  while hi <= limit, count[hi] == nil { hi += 1 }
  return .unreachable(below: loading(lo), above: hi <= limit ? loading(hi) : nil)
}

/// The reachable load closest to the target; a tie goes to the lighter one. Callers keep the
/// target finite and within `maxTargetKg`, the bar positive and the plates finite: the table is
/// sized from the target.
public func nearestLoading(_ targetKg: Double, barKg: Double, platesKg: [Double]) -> Loading {
  let load: BarLoad
  do {
    load = try loadBar(targetKg, barKg: barKg, platesKg: platesKg)
  } catch {
    preconditionFailure("no loading for this \(error.message)")
  }
  switch load {
  case .exact(let loading): return loading
  case .unreachable(nil, let above?): return above
  case .unreachable(let below?, nil): return below
  case .unreachable(let below?, let above?):
    return targetKg - below.totalKg <= above.totalKg - targetKg ? below : above
  case .unreachable(nil, nil): preconditionFailure("a target always has a load on one side")
  }
}
