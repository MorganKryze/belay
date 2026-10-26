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

// A plain layout that already reads the whole description; every word on screen comes from it.
struct SessionActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionActivityAttributes.self) { context in
            HStack {
                VStack(alignment: .leading) {
                    Text(context.state.title).font(.headline)
                    Text(context.state.detail).font(.subheadline)
                    Text(context.state.statusLabel).font(.caption)
                }
                Spacer()
                SessionClock(state: context.state)
            }
            .padding()
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    VStack(alignment: .leading) {
                        Text(context.state.title)
                        Text(context.state.detail).font(.caption)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    SessionClock(state: context.state)
                }
            } compactLeading: {
                Image(systemName: "timer")
            } compactTrailing: {
                SessionClock(state: context.state)
            } minimal: {
                SessionClock(state: context.state)
            }
        }
    }
}

// Counts the rest down while one runs, else the session's time up; both stand still in a pause.
// The fixed width keeps the ticking digits from pushing their neighbors around.
private struct SessionClock: View {
    let state: SessionActivityAttributes.ContentState

    var body: some View {
        clock
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .frame(width: 56)
    }

    @ViewBuilder private var clock: some View {
        if let restEnd = state.restEnd {
            let restStart = min(state.restStart ?? restEnd, restEnd)
            Text(
                timerInterval: restStart...restEnd,
                pauseTime: state.restFrozen ? state.pausedAt : nil,
                countsDown: true
            )
        } else {
            Text(
                timerInterval: state.startedAt...state.startedAt.addingTimeInterval(12 * 3600),
                pauseTime: state.pausedAt,
                countsDown: false
            )
        }
    }
}
