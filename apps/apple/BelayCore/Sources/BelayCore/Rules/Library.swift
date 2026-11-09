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

  public init(
    id: String, name: String, equipment: Equipment, incrementKg: Double, measure: Measure?
  ) {
    self.id = id
    self.name = name
    self.equipment = equipment
    self.incrementKg = incrementKg
    self.measure = measure
  }
}

/// The library, read once from its index.
public struct ExerciseLibrary: Sendable {
  public let exercises: [LibraryExercise]
  private let byId: [String: LibraryExercise]

  /// Reads the index: a list of `[id, name, primary, secondary, equipment, incrementKg,
  /// measure]`. The muscles are not read here.
  public init(indexJSON: Data) throws {
    let rows = try JSONDecoder().decode([Row].self, from: indexJSON)
    exercises = rows.map(\.exercise)
    byId = Dictionary(exercises.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
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

  private static func folded(_ text: String) -> String {
    text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
  }

  private struct Row: Decodable {
    let exercise: LibraryExercise

    init(from decoder: any Decoder) throws {
      var c = try decoder.unkeyedContainer()
      let id = try c.decode(String.self)
      let name = try c.decode(String.self)
      _ = try c.decode([String].self)
      _ = try c.decode([String].self)
      let equipment = try c.decode(String.self)
      let incrementKg = try c.decode(Double.self)
      let measure = try c.decode(String.self)
      exercise = LibraryExercise(
        id: id, name: name, equipment: Equipment(rawValue: equipment) ?? .other,
        incrementKg: incrementKg, measure: measure == "reps" ? nil : Measure(rawValue: measure))
    }
  }
}
