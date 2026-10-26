import ActivityKit
import SwiftUI
import WidgetKit

// WidgetKit finds the extension's entry point through @main, not through the Info.plist.
@main
struct BelayActivityBundle: WidgetBundle {
    var body: some Widget {
        SessionActivityWidget()
    }
}

// The open session on the lock screen and in the Dynamic Island. The views live beside the shared
// type; every word on screen comes from the description.
struct SessionActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionActivityAttributes.self) { context in
            SessionLockScreenView(state: context.state, isStale: context.isStale)
                // The dark card's hairline, as on Belay's dark cards; none in light.
                .overlay(ContainerRelativeShape().strokeBorder(SessionPalette.edge, lineWidth: 1))
                .activityBackgroundTint(SessionPalette.background)
                .activitySystemActionForegroundColor(SessionPalette.ink)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    SessionExpandedLeading(state: context.state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    SessionExpandedTrailing(state: context.state, isStale: context.isStale)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    SessionExpandedBottom(state: context.state, isStale: context.isStale)
                }
            } compactLeading: {
                SessionCompactLeading(state: context.state, isStale: context.isStale)
            } compactTrailing: {
                SessionCompactTrailing(state: context.state, isStale: context.isStale)
            } minimal: {
                SessionMinimalView(state: context.state, isStale: context.isStale)
            }
        }
    }
}
