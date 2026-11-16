import BelayCore
import Foundation
import Testing

// The library as the app reads it from its bundle: once, and never a crash when the index is
// missing or broken; and its search, as the shared rules computed it (`pnpm vectors`).

private struct SearchVectors: Decodable {
  struct Toolkit: Decodable {
    let filterExercises: [Case]
  }
  struct Case: Decodable {
    let name: String
    let query: String
    let muscle: String?
    let equipment: String?
    let result: [String]
  }
  let toolkit: Toolkit
}

@Suite struct LibraryTests {
  private let folder = FileManager.default.temporaryDirectory
    .appending(path: "library-\(UUID().uuidString)", directoryHint: .isDirectory)

  @Test func readsTheIndex() throws {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appending(path: "index.json")
    try Data(#"[["ds:0025","Barbell bench press",["chest"],[],"barbell",2.5,"reps"]]"#.utf8).write(to: url)
    var failures: [String] = []
    let library = ExerciseLibrary.bundled(at: url) { failures.append($0) }
    #expect(library.exercise("ds:0025")?.name == "Barbell bench press")
    #expect(failures.isEmpty)
  }

  @Test func missingIndexIsEmptyAndSaid() {
    var failures: [String] = []
    let library = ExerciseLibrary.bundled(at: nil) { failures.append($0) }
    #expect(library.exercises.isEmpty)
    #expect(failures == ["missing"])
  }

  @Test func brokenIndexIsEmptyAndSaid() throws {
    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
    let url = folder.appending(path: "index.json")
    try Data("{".utf8).write(to: url)
    var failures: [String] = []
    let library = ExerciseLibrary.bundled(at: url) { failures.append($0) }
    #expect(library.exercises.isEmpty)
    #expect(failures == ["unreadable"])
  }

  @Test func filterMatchesVectors() throws {
    let url = try #require(
      Bundle.module.url(forResource: "rules", withExtension: "json", subdirectory: "Vectors"))
    let raw = try Data(contentsOf: url)
    let vectors = try JSONDecoder().decode(SearchVectors.self, from: raw).toolkit
    // The library slice the cases ran on, as index rows.
    let file = try #require(try JSONSerialization.jsonObject(with: raw) as? [String: Any])
    let toolkit = try #require(file["toolkit"] as? [String: Any])
    let rows = try #require(toolkit["library"])
    let library = try ExerciseLibrary(indexJSON: JSONSerialization.data(withJSONObject: rows))
    #expect(library.exercises.count > 300)
    for c in vectors.filterExercises {
      let equipment = try c.equipment.map { try #require(Equipment(rawValue: $0)) }
      let found = library.filter(query: c.query, muscle: c.muscle, equipment: equipment)
      #expect(found.map(\.id) == c.result, "\(c.name)")
    }
  }
}
