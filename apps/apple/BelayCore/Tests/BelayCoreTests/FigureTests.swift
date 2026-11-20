import Testing

@testable import BelayCore

// The body figure ships generated from the web's body map: the same outlines, the same muscles,
// the same deltoid cut and the same thumbnail framing.
@Suite struct FigureTests {
  let figure = Figure.bundled

  // Every point a command names: its controls and its end.
  private func points(_ command: PathCommand) -> [(Double, Double)] {
    switch command {
    case .move(let x, let y), .line(let x, let y): [(x, y)]
    case .curve(let x1, let y1, let x2, let y2, let x, let y): [(x1, y1), (x2, y2), (x, y)]
    case .close: []
    }
  }

  @Test func bothViewsDecodeAsGenerated() throws {
    #expect(figure.shapes(.front).count == 90)
    #expect(figure.shapes(.back).count == 71)
    #expect(figure.gap == 5)
    let chest = try #require(figure.shapes(.front).first)
    #expect(chest.muscle == "chest")
    #expect(chest.clip == nil)
    #expect(chest.commands.first == .move(272.91, 422.84))
    #expect(chest.commands[1] == .curve(253.96, 405.65, 250.91, 365.84, 260.27, 344.05))
    // Every outline is closed, as the web's are.
    for view in FigureView.allCases {
      for shape in figure.shapes(view) {
        #expect(shape.commands.first.map { if case .move = $0 { true } else { false } } == true)
        #expect(shape.commands.last == .close)
      }
    }
    // Some outlines are drawn at rest, never coloured.
    #expect(figure.shapes(.front).contains { $0.muscle == nil })
  }

  @Test func everyPointInsideItsViewBox() {
    for view in FigureView.allCases {
      let box = figure.viewBox(view)
      #expect(box.count == 4)
      for shape in figure.shapes(view) {
        for (x, y) in shape.commands.flatMap(points) {
          #expect((box[0]...box[0] + box[2]).contains(x), "\(view) x \(x)")
          #expect((box[1]...box[1] + box[3]).contains(y), "\(view) y \(y)")
        }
      }
    }
    #expect(figure.viewBox(.front) == [48, 90, 632, 1256])
    #expect(figure.viewBox(.back) == [768, 90, 632, 1256])
  }

  @Test func deltoidHeadsSplitAtTheCut() {
    for (view, inner) in [(FigureView.front, "front_delts"), (.back, "rear_delts")] {
      let cut = figure.cut(view)
      let clipped = figure.shapes(view).filter { $0.clip != nil }
      // Each deltoid outline is drawn twice: its inner part as one head, its outer part as the side.
      #expect(clipped.count == 4)
      for pair in stride(from: 0, to: clipped.count, by: 2) {
        let (a, b) = (clipped[pair], clipped[pair + 1])
        #expect(a.muscle == inner && a.clip == .inner)
        #expect(b.muscle == "side_delts" && b.clip == .outer)
        #expect(a.commands == b.commands)
        // The cut runs through the outline, so both heads show.
        let xs = a.commands.flatMap(points).map(\.0)
        let line = xs.min()! < figure.cut(view).left ? cut.left : cut.right
        #expect(xs.min()! < line && line < xs.max()!)
      }
    }
    #expect(figure.cut(.front) == FigureCut(left: 228, right: 500))
    #expect(figure.cut(.back) == FigureCut(left: 941, right: 1226))
    #expect(!figure.shapes(.front).contains { $0.muscle == "rear_delts" })
  }

  @Test func latsResolvedOnTheBack() {
    #expect(figure.shapes(.back).filter { $0.muscle == "lats" }.count == 2)
    #expect(figure.shapes(.back).contains { $0.muscle == "upper_back" })
    #expect(!figure.shapes(.front).contains { $0.muscle == "lats" })
  }

  @Test func thumbnailTableCoversEveryMuscle() {
    let muscles = [
      "chest", "front_delts", "side_delts", "rear_delts", "biceps", "triceps", "forearms", "lats",
      "upper_back", "lower_back", "abs", "glutes", "quads", "hamstrings", "adductors", "calves",
    ]
    #expect(Set(figure.thumbnails.keys) == Set(muscles))
    let drawn = Set(FigureView.allCases.flatMap { figure.shapes($0).compactMap(\.muscle) })
    #expect(drawn == Set(muscles))
    for muscle in muscles {
      let thumb = figure.thumbnail(muscle)
      // The muscle is on the view its thumbnail shows.
      #expect(figure.shapes(thumb.view).contains { $0.muscle == muscle }, "\(muscle)")
      #expect(thumb.viewBox.count == 4)
    }
    #expect(figure.thumbnail("chest") == (FigureView.front, [144, 230, 440, 440]))
    #expect(figure.thumbnail("lower_back") == (FigureView.back, [864, 480, 440, 440]))
    #expect(figure.thumbnail("quads") == (FigureView.front, [144, 680, 440, 440]))
    #expect(figure.thumbnail("calves") == (FigureView.back, [864, 680, 440, 440]))
  }

  @Test func thumbnailKeyIgnoresOrder() {
    let a = FigureThumbnailKey(primary: "chest", secondary: ["triceps", "front_delts"], dark: false)
    let b = FigureThumbnailKey(primary: "chest", secondary: ["front_delts", "triceps"], dark: false)
    #expect(a == b)
    #expect(a.hashValue == b.hashValue)
    #expect(a.secondary == ["front_delts", "triceps"])
    #expect(a != FigureThumbnailKey(primary: "chest", secondary: ["triceps", "front_delts"], dark: true))
    #expect(a != FigureThumbnailKey(primary: "triceps", secondary: ["chest", "front_delts"], dark: false))
  }
}
