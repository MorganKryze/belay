import BelayCore
import Foundation
import Testing

// The library as the app reads it from its bundle: once, and never a crash when the index is
// missing or broken.

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
}
