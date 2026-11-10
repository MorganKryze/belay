import ActivityKit
import BelayActivity
import SwiftUI
import WidgetKit

/// The session on the lock screen and in the Dynamic Island. It draws the content the app wrote
/// and nothing else: the words are already in the phone's language.
struct SessionActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: SessionActivityAttributes.self) { context in
            LockCard(content: context.state, stale: context.isStale)
                .activityBackgroundTint(Palette.card)
                .activitySystemActionForegroundColor(Palette.ink)
        } dynamicIsland: { context in
            let content = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Mark(side: 22).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Clock(content: content).font(.headline).padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(alignment: .center, spacing: 12) {
                        Lines(content: content, stale: context.isStale, figure: 24)
                        Spacer(minLength: 8)
                        Action(content: content, side: 48)
                    }
                }
            } compactLeading: {
                Mark(side: 18)
            } compactTrailing: {
                Clock(content: content).font(.subheadline.weight(.semibold)).frame(maxWidth: 52)
            } minimal: {
                Mark(side: 18)
            }
            .keylineTint(Palette.accent)
        }
    }
}

private typealias Content = BelayActivity.ActivityContent

/// The card's own colors: it is always dark, so its text keeps AA contrast in light and dark.
private enum Palette {
    static let ink = Color.white
    static let soft = Color(white: 0.78)
    static let accent = Color(red: 0x8D / 255, green: 0xB6 / 255, blue: 0xEE / 255)
    static let card = Color(white: 0.10).opacity(0.82)
}

/// The lock-screen card: the text on the left, its one round button on the right.
private struct LockCard: View {
    let content: Content
    let stale: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Lines(content: content, stale: stale, figure: 32)
            Spacer(minLength: 8)
            Action(content: content, side: 56)
        }
        .padding(16)
    }
}

/// The rest whose end passed with no update, read from the content alone.
private func restOver(_ content: Content, stale: Bool) -> Bool {
    content.status == .rest && (content.restEnd == nil || stale)
}

private struct Lines: View {
    let content: Content
    let stale: Bool
    let figure: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if restOver(content, stale: stale) {
                Text(content.restOverTitle).font(.headline).foregroundStyle(Palette.ink)
            } else {
                switch content.status {
                case .due:
                    HStack(spacing: 6) {
                        Mark(side: 18)
                        Text(content.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.ink)
                    }
                    Text(content.detail).font(.subheadline).foregroundStyle(Palette.soft)
                    if let load = content.load {
                        Text(load).font(.custom("ArchivoExpanded-ExtraBold", size: figure, relativeTo: .title))
                            .foregroundStyle(Palette.ink)
                    }
                case .rest:
                    Text(content.title).font(.subheadline.weight(.semibold)).foregroundStyle(Palette.soft)
                    if let end = content.restEnd {
                        Text(timerInterval: Date.now...max(end, .now), countsDown: true)
                            .font(.custom("ArchivoExpanded-ExtraBold", size: figure + 8, relativeTo: .title))
                            .monospacedDigit().foregroundStyle(Palette.ink)
                    }
                    if !content.detail.isEmpty {
                        Text(content.detail).font(.subheadline).foregroundStyle(Palette.soft)
                    }
                case .paused:
                    Text(content.title).font(.headline).foregroundStyle(Palette.ink)
                    Text(content.detail).font(.subheadline).monospacedDigit().foregroundStyle(Palette.soft)
                case .allDone:
                    Text(content.title).font(.headline).foregroundStyle(Palette.ink)
                }
                if stale {
                    Text(content.staleLine).font(.footnote).foregroundStyle(Palette.soft)
                }
            }
        }
        .lineLimit(1)
        .minimumScaleFactor(0.7)
        .accessibilityElement(children: .combine)
    }
}

/// ✓ while a set is due, +30 s while resting, nothing otherwise.
private struct Action: View {
    let content: Content
    let side: CGFloat

    var body: some View {
        if content.showsCheck, let place = content.place, let load = content.load {
            Button(intent: LogSetIntent(workoutId: content.workoutId, place: place)) {
                RoundButton(symbol: "checkmark", fill: Palette.accent, glyph: .black, side: side)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Noter la série, \(load)", tableName: "Activity"))
        } else if content.showsThirty, content.restEnd.map({ $0 > .now }) == true {
            Button(intent: AddThirtyIntent(workoutId: content.workoutId)) {
                RoundButton(symbol: "goforward.30", fill: Palette.ink.opacity(0.18), glyph: Palette.ink, side: side)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Ajouter 30 secondes", tableName: "Activity"))
        }
    }
}

private struct RoundButton: View {
    let symbol: String
    let fill: Color
    let glyph: Color
    let side: CGFloat

    var body: some View {
        Image(systemName: symbol).font(.title3.weight(.bold)).foregroundStyle(glyph)
            .frame(width: side, height: side)
            .background(fill, in: .circle)
    }
}

/// The running clock of the island: the rest's time left, else the session's time.
private struct Clock: View {
    let content: Content

    var body: some View {
        Group {
            if let end = content.restEnd, content.status == .rest {
                Text(timerInterval: Date.now...max(end, .now), countsDown: true)
            } else if let paused = content.pausedAt {
                Text(timerInterval: content.startedAt...max(paused, content.startedAt), pauseTime: paused, countsDown: false)
            } else {
                Text(timerInterval: content.startedAt...Date.distantFuture, countsDown: false)
            }
        }
        .monospacedDigit()
        .foregroundStyle(Palette.accent)
        .multilineTextAlignment(.trailing)
    }
}

private struct Mark: View {
    let side: CGFloat

    var body: some View {
        BelayMark().stroke(Palette.ink, style: BelayMark.strokeStyle(side: side))
            .frame(width: side, height: side)
            .accessibilityHidden(true)
    }
}
