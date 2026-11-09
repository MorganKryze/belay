import SwiftUI

/// The mark on its 100-unit grid: an open ring whose two ends are the feet of a mountain with a
/// shoulder and a summit. Drawn as strokes, so a view strokes it with `strokeStyle(side:)`; a part
/// alone lets a view colour the ring and the mountain apart.
nonisolated struct BelayMark: Shape {
    enum Part {
        case ring, mountain
    }

    static let strokeWidth: CGFloat = 11
    static let radius: CGFloat = 37
    /// The ring's two ends, which are also the mountain's feet.
    static let feet = (CGPoint(x: 28.6, y: 78.8), CGPoint(x: 71.4, y: 78.8))
    static let ridge = [
        CGPoint(x: 28.6, y: 78.8), CGPoint(x: 39, y: 58), CGPoint(x: 45, y: 64),
        CGPoint(x: 56, y: 44), CGPoint(x: 71.4, y: 78.8),
    ]
    /// Both parts sit one unit lower, which centres the drawn mark on the grid.
    static let shift = CGAffineTransform(translationX: 0, y: 1)

    let part: Part?

    /// No part draws both.
    init(_ part: Part? = nil) {
        self.part = part
    }

    /// Round ends and joins, the width scaled to the side the mark is drawn at.
    static func strokeStyle(side: CGFloat) -> StrokeStyle {
        StrokeStyle(lineWidth: strokeWidth * side / 100, lineCap: .round, lineJoin: .round)
    }

    func path(in rect: CGRect) -> Path {
        var path = Path()
        if part != .mountain { path.addPath(Self.ring) }
        if part != .ring { path.addLines(Self.ridge) }
        let scale = min(rect.width, rect.height) / 100
        return path
            .applying(Self.shift)
            .applying(CGAffineTransform(a: scale, b: 0, c: 0, d: scale,
                                        tx: rect.midX - 50 * scale, ty: rect.midY - 50 * scale))
    }

    /// The long arc over the top from one foot to the other, its centre above the feet's chord.
    private static var ring: Path {
        let (left, right) = feet
        let half = (right.x - left.x) / 2
        let center = CGPoint(x: left.x + half, y: left.y - (radius * radius - half * half).squareRoot())
        let angle = { (p: CGPoint) in Angle(radians: atan2(p.y - center.y, p.x - center.x)) }
        var path = Path()
        path.addArc(center: center, radius: radius, startAngle: angle(left), endAngle: angle(right), clockwise: false)
        return path
    }
}
