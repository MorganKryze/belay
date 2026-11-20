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

/// The body figure's shades, the web's: the primary muscles in ink, the secondary ones a grey apart
/// from it, every other muscle at rest. The muscles are always named in words beside the figure, so
/// the two greys carry no meaning alone.
struct MuscleShades {
    let primary: Color
    let secondary: Color
    let rest: Color

    /// Resolved for one theme, so a thumbnail drawn off screen gets the colours of the list it
    /// goes to.
    static func of(dark: Bool) -> MuscleShades {
        let traits = UITraitCollection(userInterfaceStyle: dark ? .dark : .light)
        return MuscleShades(
            primary: Color(UIColor(resource: .ink).resolvedColor(with: traits)),
            secondary: srgb(dark ? 0x6F7D86 : 0x8E9AA1),
            rest: srgb(dark ? 0x2E3A43 : 0xD5DBDD))
    }

    /// Each muscle's shade on a figure of these muscles; the others are at rest.
    func fills(primary: [String], secondary: [String]) -> [String: Color] {
        var fills: [String: Color] = [:]
        for muscle in secondary { fills[muscle] = self.secondary }
        for muscle in primary { fills[muscle] = self.primary }
        return fills
    }

    private static func srgb(_ hex: UInt32) -> Color {
        Color(
            red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255)
    }
}
