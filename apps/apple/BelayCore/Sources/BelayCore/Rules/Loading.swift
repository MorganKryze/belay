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

/// Bounds the change-making table: 1000 kg is 50 000 hundredths per side.
public let maxTargetKg = 1000.0

private func toCenti(_ kg: Double) -> Int { Int(jsRound(kg * 100)) }

/// The reachable load closest to the target, with the fewest plates per side; a tie goes to the
/// lighter one. Counted in hundredths of a kilo, so 2.5 + 1.25 never drifts. Assumes as many
/// plates of each weight as needed. Callers keep the target finite and within `maxTargetKg`, and
/// the bar positive: the table is sized from the target.
public func nearestLoading(_ targetKg: Double, barKg: Double, platesKg: [Double]) -> Loading {
  precondition(targetKg.isFinite && targetKg <= maxTargetKg, "target past the plate table")
  precondition(barKg.isFinite && barKg > 0, "bar must be a positive weight")
  let bar = toCenti(barKg)
  let plates = Set(platesKg.map(toCenti)).filter { $0 > 0 }.sorted(by: >)
  let half = Double(toCenti(targetKg) - bar) / 2
  if half < 0 { return Loading(totalKg: Double(bar) / 100, perSideKg: []) }

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

  if half.rounded() == half, count[Int(half)] != nil { return loading(Int(half)) }
  var lo = Int(half.rounded(.down))
  while count[lo] == nil { lo -= 1 }  // count[0] is 0, so this stops
  var hi = Int(half.rounded(.up))
  while hi <= limit, count[hi] == nil { hi += 1 }
  let below = loading(lo)
  guard hi <= limit else { return below }
  let above = loading(hi)
  return targetKg - below.totalKg <= above.totalKg - targetKg ? below : above
}
