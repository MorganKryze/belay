import Foundation

// The shared science catalogue, generated from the TypeScript into `science.json`: what a « Comment
// c'est calculé » page says, word for word as the web says it.

/// A source's identifier: its label, and its address when a stable resolver exists.
public struct ScienceLink: Decodable, Sendable, Equatable {
  public var label: String
  public var url: String?
}

/// A source as the web cites it: « Helms et al. 2014 », then its title and venue.
public struct ScienceSource: Decodable, Sendable, Equatable {
  public var cite: String
  public var title: String
  public var venue: String
  public var links: [ScienceLink]
}

/// One entry in one language.
public struct ScienceEntry: Sendable, Equatable {
  /// "source", "heuristic" or "mixed".
  public var label: String
  public var title: String
  public var brief: String
  public var keep: [String]
  /// What Belay adds without a source, when it does.
  public var heuristic: String?
  public var formula: [String]
  public var limits: [String]
  public var sources: [ScienceSource]
}

public enum Science {
  private struct Words: Decodable {
    var title: String
    var brief: String
    var keep: [String]
    var heuristic: String?
    var formula: [String]
    var limits: [String]
  }

  private struct Item: Decodable {
    var label: String
    var sources: [ScienceSource]
    var content: [String: Words]
  }

  private static let catalogue: [String: Item] = {
    // The file ships inside the package and its tests read it: unreadable, the build is broken.
    guard let url = Bundle.module.url(forResource: "science", withExtension: "json") else {
      preconditionFailure("the science catalogue is missing")
    }
    do {
      return try JSONDecoder().decode([String: Item].self, from: Data(contentsOf: url))
    } catch {
      preconditionFailure("the science catalogue does not read: \(error)")
    }
  }()

  /// The entry `id` (« target-rate »), in French for a French `language`, else in English.
  public static func entry(_ id: String, language: String) -> ScienceEntry? {
    guard let item = catalogue[id],
      let words = item.content[language.hasPrefix("fr") ? "fr" : "en"]
    else { return nil }
    return ScienceEntry(
      label: item.label, title: words.title, brief: words.brief, keep: words.keep,
      heuristic: words.heuristic, formula: words.formula, limits: words.limits,
      sources: item.sources)
  }
}
