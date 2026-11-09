import SwiftUI

// Shared with the Live Activity, which draws the same mark.

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
