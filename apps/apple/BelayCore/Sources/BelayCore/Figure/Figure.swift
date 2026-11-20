import Foundation

// The body figure, front and back, generated from the web's body map into `figure.json`: each
// outline as absolute moves, lines and cubics in the figure's own units, the muscle it colours,
// the deltoid's cut and the thumbnail framing of each muscle. Plain numbers, so the core stays
// free of any drawing framework and the screens turn them into paths.

public enum FigureView: String, Decodable, Sendable, CaseIterable {
  case front, back
}

/// Which side of the deltoid's cut an outline keeps: the inner head or the side head.
public enum FigureClip: String, Decodable, Sendable {
  case inner, outer
}

/// One drawing step, in the figure's units, every coordinate absolute.
public enum PathCommand: Sendable, Equatable, Decodable {
  case move(Double, Double)
  case line(Double, Double)
  case curve(Double, Double, Double, Double, Double, Double)
  case close

  public init(from decoder: Decoder) throws {
    var values = try decoder.unkeyedContainer()
    let letter = try values.decode(String.self)
    func next() throws -> Double { try values.decode(Double.self) }
    switch letter {
    case "M": self = .move(try next(), try next())
    case "L": self = .line(try next(), try next())
    case "C":
      self = .curve(try next(), try next(), try next(), try next(), try next(), try next())
    case "Z": self = .close
    default:
      throw DecodingError.dataCorruptedError(
        in: values, debugDescription: "unknown path command \(letter)")
    }
  }
}

public struct FigureShape: Sendable, Decodable {
  /// nil: drawn at rest, never coloured.
  public var muscle: String?
  public var clip: FigureClip?
  public var commands: [PathCommand]

  private enum CodingKeys: String, CodingKey {
    case muscle, clip
    case commands = "path"
  }
}

/// Where the deltoid is cut on each side: x in the figure's units.
public struct FigureCut: Sendable, Equatable, Decodable {
  public var left: Double
  public var right: Double
}

/// What one list row's thumbnail looks like: two rows with the same muscles in any order and the
/// same theme draw the same picture, so one drawing serves both.
public struct FigureThumbnailKey: Hashable, Sendable {
  public let primary: String
  public let secondary: [String]
  public let dark: Bool

  public init(primary: String, secondary: [String], dark: Bool) {
    self.primary = primary
    self.secondary = secondary.sorted()
    self.dark = dark
  }
}

public struct Figure: Sendable, Decodable {
  struct View: Sendable, Decodable {
    var viewBox: [Double]
    var cut: FigureCut
    var shapes: [FigureShape]
  }

  struct Thumbnail: Sendable, Decodable {
    var view: FigureView
    var viewBox: [Double]
  }

  let views: [String: View]
  /// The space left on each side of the deltoid's cut, so a hairline parts its two heads.
  public let gap: Double
  let thumbnails: [String: Thumbnail]

  public static let bundled: Figure = {
    // The file ships inside the package and its tests read it: unreadable, the build is broken.
    guard let url = Bundle.module.url(forResource: "figure", withExtension: "json") else {
      preconditionFailure("the body figure is missing")
    }
    do {
      return try JSONDecoder().decode(Figure.self, from: Data(contentsOf: url))
    } catch {
      preconditionFailure("the body figure does not read: \(error)")
    }
  }()

  private func view(_ view: FigureView) -> View {
    // Both views are generated together; one missing means the file is broken.
    guard let v = views[view.rawValue] else { preconditionFailure("no \(view) view") }
    return v
  }

  public func shapes(_ view: FigureView) -> [FigureShape] { self.view(view).shapes }

  /// x, y, width and height, as an SVG viewBox.
  public func viewBox(_ view: FigureView) -> [Double] { self.view(view).viewBox }

  public func cut(_ view: FigureView) -> FigureCut { self.view(view).cut }

  /// The view and the frame a 44 pt thumbnail shows for an exercise whose primary muscle this is.
  /// A muscle the table does not know gets the whole front view rather than a blank picture.
  public func thumbnail(_ primary: String) -> (view: FigureView, viewBox: [Double]) {
    guard let t = thumbnails[primary] else { return (.front, viewBox(.front)) }
    return (t.view, t.viewBox)
  }
}
