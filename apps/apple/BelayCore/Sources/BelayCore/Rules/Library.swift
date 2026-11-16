import Foundation

// The exercise library as the app ships it: one line of the index per exercise.

/// What an exercise is done with; it sets the default step between two loads.
public enum Equipment: String, Codable, Sendable, CaseIterable {
  case barbell, dumbbell, machine, cable, bodyweight, other
}

/// An exercise of the library. Its id never changes and is never reused.
public struct LibraryExercise: Sendable, Equatable, Identifiable {
  public let id: String
  /// English, in sentence case, in both languages.
  public let name: String
  public let equipment: Equipment
  public let incrementKg: Double
  /// As a slot writes it: nil for repetitions.
  public let measure: Measure?
  /// The muscles it works first, as the library names them; the search filters on these.
  public let primary: [String]

  public init(
    id: String, name: String, equipment: Equipment, incrementKg: Double, measure: Measure?,
    primary: [String] = []
  ) {
    self.id = id
    self.name = name
    self.equipment = equipment
    self.incrementKg = incrementKg
    self.measure = measure
    self.primary = primary
  }
}

/// The library, read once from its index.
public struct ExerciseLibrary: Sendable {
  public let exercises: [LibraryExercise]
  private let byId: [String: LibraryExercise]
  /// Each name folded once, not once per keystroke.
  private let folded: [String]

  /// Reads the index: a list of `[id, name, primary, secondary, equipment, incrementKg,
  /// measure]`. The secondary muscles are not read here.
  public init(indexJSON: Data) throws {
    self.init(exercises: try JSONDecoder().decode([Row].self, from: indexJSON).map(\.exercise))
  }

  private init(exercises: [LibraryExercise]) {
    self.exercises = exercises
    byId = Dictionary(exercises.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
    folded = exercises.map { Self.fold($0.name) }
  }

  /// The index the app ships, read once at launch. A build that lacks it, or holds a broken one,
  /// still opens: the library is empty, so names show as ids, and `failed` says why
  /// (`missing`, `unreadable`) for the log.
  public static func bundled(at url: URL?, failed: (String) -> Void) -> ExerciseLibrary {
    guard let url else {
      failed("missing")
      return ExerciseLibrary(exercises: [])
    }
    do {
      return try ExerciseLibrary(indexJSON: Data(contentsOf: url))
    } catch {
      failed("unreadable")
      return ExerciseLibrary(exercises: [])
    }
  }

  public func exercise(_ id: String) -> LibraryExercise? { byId[id] }

  /// The exercises whose name or id holds the text, in index order, ignoring case and accents.
  /// Blank text gives them all.
  public func search(_ text: String) -> [LibraryExercise] {
    let needle = Self.folded(text.trimmingCharacters(in: .whitespacesAndNewlines))
    guard !needle.isEmpty else { return exercises }
    return exercises.filter {
      Self.folded($0.name).contains(needle) || $0.id.contains(needle)
    }
  }

  /// The exercises Exercices lists, in index order, as the web's search: every word of the query
  /// in the name, case, accents and word order aside; the muscle among the primary ones; the
  /// equipment. A nil filter keeps them all.
  public func filter(query: String, muscle: String?, equipment: Equipment?) -> [LibraryExercise] {
    let words = Self.fold(query).split(whereSeparator: \.isWhitespace)
    return exercises.indices.filter { i in
      let e = exercises[i]
      return words.allSatisfy { folded[i].contains($0) }
        && (muscle.map { e.primary.contains($0) } ?? true)
        && (equipment.map { e.equipment == $0 } ?? true)
    }.map { exercises[$0] }
  }

  /// "Sléd 45°" is "sled 45°": decomposed, its diacritics dropped, in lower case.
  private static func fold(_ text: String) -> String {
    let bare = text.decomposedStringWithCanonicalMapping.unicodeScalars.filter {
      !$0.properties.isDiacritic
    }
    return String(String.UnicodeScalarView(bare)).lowercased()
  }

  private static func folded(_ text: String) -> String {
    text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
  }

  private struct Row: Decodable {
    let exercise: LibraryExercise

    init(from decoder: any Decoder) throws {
      var c = try decoder.unkeyedContainer()
      let id = try c.decode(String.self)
      let name = try c.decode(String.self)
      let primary = try c.decode([String].self)
      _ = try c.decode([String].self)
      let equipment = try c.decode(String.self)
      let incrementKg = try c.decode(Double.self)
      let measure = try c.decode(String.self)
      exercise = LibraryExercise(
        id: id, name: name, equipment: Equipment(rawValue: equipment) ?? .other,
        incrementKg: incrementKg, measure: measure == "reps" ? nil : Measure(rawValue: measure),
        primary: primary)
    }
  }
}
