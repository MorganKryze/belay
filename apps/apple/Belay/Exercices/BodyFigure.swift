import BelayCore
import SwiftUI

/// The figure's outlines as paths, built once per view, the deltoid's two heads already cut apart
/// at the web's line, a hairline between them.
enum FigurePaths {
    struct Outline {
        /// nil: drawn at rest, never coloured.
        let muscle: String?
        let path: Path
    }

    static let front = outlines(.front)
    static let back = outlines(.back)

    static func of(_ view: FigureView) -> [Outline] { view == .front ? front : back }

    private static func outlines(_ view: FigureView) -> [Outline] {
        let figure = BelayCore.Figure.bundled
        let cut = figure.cut(view)
        let gap = figure.gap
        // The web's clip rectangles: wide and tall enough for either view whole.
        let inner = Path(CGRect(x: cut.left + gap, y: 0, width: cut.right - cut.left - 2 * gap, height: 2_000))
        var outer = Path(CGRect(x: 0, y: 0, width: cut.left - gap, height: 2_000))
        outer.addRect(CGRect(x: cut.right + gap, y: 0, width: 2_000, height: 2_000))
        return figure.shapes(view).map { shape in
            let path = Path(shape.commands)
            switch shape.clip {
            case .inner: return Outline(muscle: shape.muscle, path: path.intersection(inner))
            case .outer: return Outline(muscle: shape.muscle, path: path.intersection(outer))
            case nil: return Outline(muscle: shape.muscle, path: path)
            }
        }
    }
}

extension Path {
    init(_ commands: [PathCommand]) {
        self.init()
        for command in commands {
            switch command {
            case .move(let x, let y): move(to: CGPoint(x: x, y: y))
            case .line(let x, let y): addLine(to: CGPoint(x: x, y: y))
            case .curve(let x1, let y1, let x2, let y2, let x, let y):
                addCurve(to: CGPoint(x: x, y: y), control1: CGPoint(x: x1, y: y1), control2: CGPoint(x: x2, y: y2))
            case .close: closeSubpath()
            }
        }
    }
}

/// One view of the figure framed by `viewBox`, as an SVG view box, centred: each muscle in its
/// fill, the others at rest.
private struct FigureDrawing: View {
    let view: FigureView
    let viewBox: [Double]
    let fills: [String: Color]
    let rest: Color

    var body: some View {
        let outlines = FigurePaths.of(view)
        let (box, fills, rest) = (viewBox, fills, rest)
        Canvas { context, size in
            let scale = min(size.width / box[2], size.height / box[3])
            context.translateBy(x: (size.width - box[2] * scale) / 2, y: (size.height - box[3] * scale) / 2)
            context.scaleBy(x: scale, y: scale)
            context.translateBy(x: -box[0], y: -box[1])
            for outline in outlines {
                context.fill(outline.path, with: .color(outline.muscle.flatMap { fills[$0] } ?? rest))
            }
        }
        .clipped()
    }
}

/// « Muscles »'s figure, from the front and from the back: the primary muscles in the full body
/// shade, the secondary ones lighter. Hidden from VoiceOver, which reads the muscles named in words
/// beside it.
struct BodyFigure: View {
    let primary: [String]
    let secondary: [String]
    @Environment(\.colorScheme) private var scheme

    /// The web's figure height: an image, so it keeps its size whatever the text size.
    private static let height: CGFloat = 224

    var body: some View {
        let shades = MuscleShades.of(dark: scheme == .dark)
        let fills = shades.fills(primary: primary, secondary: secondary)
        HStack(spacing: 24) {
            ForEach(FigureView.allCases, id: \.self) { view in
                let box = BelayCore.Figure.bundled.viewBox(view)
                VStack(spacing: 4) {
                    FigureDrawing(view: view, viewBox: box, fills: fills, rest: shades.rest)
                        .frame(width: Self.height * box[2] / box[3], height: Self.height)
                    caption(view).font(.caption).foregroundStyle(.muted)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .accessibilityHidden(true)
    }

    private func caption(_ view: FigureView) -> Text {
        switch view {
        case .front: Text("De face", tableName: "Exercices")
        case .back: Text("De dos", tableName: "Exercices")
        }
    }
}
