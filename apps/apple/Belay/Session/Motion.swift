import SwiftUI

/// The session's one motion: every state change of the cover moves on the same spring, so the
/// card, the foot's glass and the figures arrive together. Under Reduce Motion each change is a
/// short crossfade and nothing moves.
enum Motion {
    static func change(reduce: Bool) -> Animation {
        reduce ? .easeInOut(duration: 0.25) : .spring(duration: 0.55, bounce: 0.2)
    }

    /// Reduce Motion as the system sets it, or as a debug launch forces it for the tests.
    static func reduced(_ system: Bool) -> Bool {
        #if DEBUG
        system || Fixture.reduceMotion
        #else
        system
        #endif
    }
}

/// The card that keeps its place while its content changes: the set becomes the clock, the recap
/// the announcement. Under Reduce Motion it only fades.
struct Hero: ViewModifier {
    let space: Namespace.ID
    let reduce: Bool

    func body(content: Content) -> some View {
        if reduce {
            content.transition(.opacity)
        } else {
            content.matchedGeometryEffect(id: "hero", in: space).transition(.opacity)
        }
    }
}

/// The count logged: the ruler's figure and the done row's figure are one element in flight.
struct InFlight: ViewModifier {
    let id: String
    let space: Namespace.ID
    let reduce: Bool

    func body(content: Content) -> some View {
        if reduce { content } else { content.matchedGeometryEffect(id: id, in: space) }
    }
}
