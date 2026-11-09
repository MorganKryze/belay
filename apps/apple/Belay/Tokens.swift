import SwiftUI
import UIKit

// Colours live in the asset catalog as semantic slots (paper, surface, ink, muted, line, mark, track,
// sunk), each with its dark and high-contrast values: `.ink`, `.mark` and the rest are the symbols
// Xcode generates from it. Nothing names a raw colour.

/// The display face: titles and big figures only. Every size is relative to a text style, so it
/// follows the person's text size; everything else stays on the system font.
extension Font {
    static let archivoName = "ArchivoExpanded-ExtraBold"

    /// Large titles of the navigation bar get the same face through `DisplayType.styleBars()`.
    static let displayCard = Font.custom(archivoName, size: 27, relativeTo: .title)
    static let displayFigure = Font.custom(archivoName, size: 44, relativeTo: .largeTitle)
    /// Fills the width of a card: the wide face at this size is the app's signature.
    static let displayHero = Font.custom(archivoName, size: 56, relativeTo: .largeTitle)
    static let displayHeroWide = Font.custom(archivoName, size: 92, relativeTo: .largeTitle)
    /// The figure that opens Corps.
    static let displayBig = Font.custom(archivoName, size: 104, relativeTo: .largeTitle)
    /// The weigh-in being typed: same family of scale as the figure behind the sheet.
    static let displaySheet = Font.custom(archivoName, size: 72, relativeTo: .largeTitle)
    /// The load of the next set: the one row of the table in the display face.
    static let displayLoad = Font.custom(archivoName, size: 34, relativeTo: .title)
    static let displayStat = Font.custom(archivoName, size: 28, relativeTo: .title)
    static let displayWidget = Font.custom(archivoName, size: 21, relativeTo: .title2)
    static let displayWidgetFigure = Font.custom(archivoName, size: 26, relativeTo: .title)
}

/// The two hooks of Belay, on the brand's 512-unit artboard.
nonisolated struct BelayMark: Shape {
    private static let bounds = CGRect(x: 86, y: 140, width: 340, height: 232)
    static let aspect = bounds.height / bounds.width

    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 86, y: 160))
        path.addLine(to: CGPoint(x: 86, y: 266))
        path.addArc(center: CGPoint(x: 206, y: 266), radius: 120, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
        path.addLine(to: CGPoint(x: 326, y: 246))
        path.addArc(center: CGPoint(x: 306, y: 246), radius: 20, startAngle: .degrees(0), endAngle: .degrees(-180), clockwise: true)
        path.addLine(to: CGPoint(x: 286, y: 266))
        path.addArc(center: CGPoint(x: 206, y: 266), radius: 80, startAngle: .degrees(0), endAngle: .degrees(180), clockwise: false)
        path.addLine(to: CGPoint(x: 126, y: 160))
        path.addArc(center: CGPoint(x: 106, y: 160), radius: 20, startAngle: .degrees(0), endAngle: .degrees(-180), clockwise: true)
        path.closeSubpath()
        path.move(to: CGPoint(x: 426, y: 352))
        path.addLine(to: CGPoint(x: 426, y: 246))
        path.addArc(center: CGPoint(x: 306, y: 246), radius: 120, startAngle: .degrees(0), endAngle: .degrees(-180), clockwise: true)
        path.addLine(to: CGPoint(x: 186, y: 266))
        path.addArc(center: CGPoint(x: 206, y: 266), radius: 20, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
        path.addLine(to: CGPoint(x: 226, y: 246))
        path.addArc(center: CGPoint(x: 306, y: 246), radius: 80, startAngle: .degrees(180), endAngle: .degrees(360), clockwise: false)
        path.addLine(to: CGPoint(x: 386, y: 352))
        path.addArc(center: CGPoint(x: 406, y: 352), radius: 20, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
        path.closeSubpath()

        let b = Self.bounds
        let scale = min(rect.width / b.width, rect.height / b.height)
        return path.applying(CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: rect.midX - b.midX * scale, ty: rect.midY - b.midY * scale))
    }
}
