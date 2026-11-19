import Foundation
import Testing

// The app's colour tokens, read from its asset catalog by path: the red that warns of a deletion
// must read on every ground it sits on, in light, dark and their increased-contrast variants.

private let assets = URL(filePath: #filePath)
  .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  .deletingLastPathComponent()
  .appending(path: "Belay/Assets.xcassets", directoryHint: .isDirectory)

/// One appearance a colorset can answer: dark or not, increased contrast or not.
private struct Appearance: Hashable, CustomStringConvertible {
  let dark: Bool
  let high: Bool

  static let all = [false, true].flatMap { dark in
    [false, true].map { Appearance(dark: dark, high: $0) }
  }

  var description: String { (dark ? "dark" : "light") + (high ? ", increased contrast" : "") }
}

/// A colorset's sRGB values by the appearances it states.
private struct ColorSet {
  let values: [Appearance: (r: Double, g: Double, b: Double)]

  init(_ name: String) throws {
    let url = assets.appending(path: "\(name).colorset/Contents.json")
    let json = try #require(
      try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    let colors = try #require(json["colors"] as? [[String: Any]])
    var values: [Appearance: (r: Double, g: Double, b: Double)] = [:]
    for entry in colors {
      let traits = (entry["appearances"] as? [[String: String]] ?? []).compactMap { $0["value"] }
      let color = try #require(entry["color"] as? [String: Any])
      let parts = try #require(color["components"] as? [String: String])
      func channel(_ key: String) throws -> Double {
        let text = try #require(parts[key])
        let value =
          text.hasPrefix("0x") ? Double(UInt8(text.dropFirst(2), radix: 16) ?? 0) / 255 : Double(text)
        return try #require(value)
      }
      values[Appearance(dark: traits.contains("dark"), high: traits.contains("high"))] =
        (try channel("red"), try channel("green"), try channel("blue"))
    }
    self.values = values
  }

  /// The value the system picks: the closest appearance stated, dropping contrast first.
  func resolve(_ a: Appearance) -> (r: Double, g: Double, b: Double)? {
    values[a] ?? values[Appearance(dark: a.dark, high: false)]
      ?? values[Appearance(dark: false, high: false)]
  }
}

/// WCAG 2.2 relative luminance of an sRGB colour.
private func luminance(_ c: (r: Double, g: Double, b: Double)) -> Double {
  func linear(_ v: Double) -> Double { v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4) }
  return 0.2126 * linear(c.r) + 0.7152 * linear(c.g) + 0.0722 * linear(c.b)
}

private func contrast(
  _ a: (r: Double, g: Double, b: Double), _ b: (r: Double, g: Double, b: Double)
) -> Double {
  let (x, y) = (luminance(a), luminance(b))
  return (max(x, y) + 0.05) / (min(x, y) + 0.05)
}

@Suite struct TokenContrastTests {
  @Test func everyColorsetReads() throws {
    let names = try FileManager.default.contentsOfDirectory(atPath: assets.path)
      .filter { $0.hasSuffix(".colorset") }.map { String($0.dropLast(".colorset".count)) }
    #expect(names.count > 10)
    for name in names {
      let set = try ColorSet(name)
      #expect(set.resolve(Appearance(dark: false, high: false)) != nil, "\(name) has no light value")
    }
  }

  @Test(arguments: ["Surface", "Sunk", "Paper"])
  func dangerReadsOn(_ ground: String) throws {
    let danger = try ColorSet("Danger")
    let under = try ColorSet(ground)
    for appearance in Appearance.all {
      let red = try #require(danger.resolve(appearance))
      let back = try #require(under.resolve(appearance))
      let ratio = contrast(red, back)
      #expect(
        ratio >= 4.5,
        "Danger on \(ground), \(appearance): \(String(format: "%.2f", ratio)):1, under 4.5:1")
    }
  }
}
