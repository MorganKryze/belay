import BelayCore
import SwiftUI
import UIKit
import os

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

/// A list row's thumbnail: the view and the part of the body where the first primary muscle sits,
/// that muscle in full, the secondary ones lighter. Drawn once per muscle set and theme, then shown
/// as a picture.
struct FigureThumbnail: View {
    let primary: String?
    let secondary: [String]
    @Environment(\.colorScheme) private var scheme
    @Environment(\.displayScale) private var scale
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 44

    var body: some View {
        let key = FigureThumbnailKey(primary: primary ?? "", secondary: secondary, dark: scheme == .dark)
        Image(uiImage: FigureThumbnails.image(key, scale: scale))
            .resizable()
            .frame(width: side, height: side)
            .background(Color.track)
            .clipShape(.rect(cornerRadius: 11))
            .accessibilityHidden(true)
    }
}

/// The thumbnails drawn so far. Unbounded on purpose: the library's 1 300 exercises share about 150
/// muscle sets, some 70 kB each at 3×, and a set looks the same for every account.
@MainActor
enum FigureThumbnails {
    private static var images: [FigureThumbnailKey: UIImage] = [:]

    /// Drawn at 44 pt for the screen's scale; a larger text size shows it enlarged.
    static func image(_ key: FigureThumbnailKey, scale: CGFloat) -> UIImage {
        if let image = images[key] { return image }
        let frame = BelayCore.Figure.bundled.thumbnail(key.primary)
        let shades = MuscleShades.of(dark: key.dark)
        let renderer = ImageRenderer(
            content: FigureDrawing(
                view: frame.view, viewBox: frame.viewBox,
                fills: shades.fills(primary: [key.primary], secondary: key.secondary), rest: shades.rest
            )
            .frame(width: 44, height: 44))
        renderer.scale = scale
        guard let image = renderer.uiImage else {
            // The row keeps its empty square and says why; the next appearance tries again.
            Logger(subsystem: "cloud.libresoftware.belay", category: "library")
                .error("thumbnail not drawn for \(key.primary, privacy: .public)")
            return UIImage()
        }
        images[key] = image
        return image
    }
}
