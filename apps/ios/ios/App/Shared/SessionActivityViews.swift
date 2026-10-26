import SwiftUI

// The open session as the lock screen and the Dynamic Island draw it. Compiled into the extension,
// which shows it, and into the app's Debug build, which renders it to images for a check on the
// simulator. Every word comes from the description: these views only place it.

// Belay's two hooks, drawn from the brand's path (512 × 512 artboard) and scaled so the hooks
// themselves fill the rect, as an icon would be.
struct BelayMark: Shape {
    // The hooks' own bounds on the artboard.
    private static let bounds = CGRect(x: 86, y: 140, width: 340, height: 232)
    static let aspect = bounds.height / bounds.width

    func path(in rect: CGRect) -> Path {
        var path = Path()
        // First hook, opening up. SVG's sweep flag 0 is `clockwise: true` in SwiftUI's flipped space.
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
        // Second hook, opening down.
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

        let bounds = Self.bounds
        let scale = min(rect.width / bounds.width, rect.height / bounds.height)
        let x = rect.midX - bounds.midX * scale
        let y = rect.midY - bounds.midY * scale
        return path.applying(CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: x, ty: y))
    }
}

// Belay's chalk and dark card colours. The lock screen sits on Belay's own background rather than
// iOS's translucent material, so every contrast holds whatever the wallpaper.
enum SessionPalette {
    static let background = pair(0xFAFAF7, 0x151412)
    static let ink = pair(0x1C1917, 0xF5F5F4)
    static let muted = pair(0x57534E, 0xA8A29E)
    static let accent = pair(0xC2410C, 0xFB923C)
    static let track = pair(0xEDEBE8, 0x2A2724)
    static let edge = Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(0x2E2B28) : .clear })
    // The always-on display dims the screen: the muted and orange words are raised to stay legible.
    static let dimmedMuted = Color(rgb(0xD6D3D1))
    static let dimmedAccent = Color(rgb(0xFDBA74))

    // The Dynamic Island is always black, whatever the phone's appearance.
    static let islandInk = Color.white
    static let islandMuted = Color(rgb(0xA8A29E))
    static let islandAccent = Color(rgb(0xFB923C))
    static let islandTrack = Color(rgb(0x3A3633))

    private static func pair(_ light: UInt32, _ dark: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? rgb(dark) : rgb(light) })
    }

    private static func rgb(_ hex: UInt32) -> UIColor {
        UIColor(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

// What one description shows, read once for every presentation.
private struct SessionLook {
    enum Content { case live, restOver, stale }
    enum Glyph { case mark, timer, pause }
    enum Tone { case ink, accent, muted }

    let state: SessionActivityAttributes.ContentState
    let content: Content

    init(_ state: SessionActivityAttributes.ContentState, isStale: Bool) {
        self.state = state
        // iOS redraws at the stale date with no word from the app. A rest still running then has
        // just ended; anything else has gone quiet too long.
        if !isStale {
            content = .live
        } else if state.restEnd != nil && !state.restFrozen {
            content = .restOver
        } else {
            content = .stale
        }
    }

    var title: String { content == .restOver ? state.restOverTitle : state.title }
    var detail: String { content == .restOver ? "\(state.restOverDetail) · \(state.detail)" : state.detail }
    var staleLine: String? { content == .stale ? state.staleLine : nil }

    // Every set done needs no word: its title says it.
    var word: String? {
        content == .restOver || state.status == .done || state.statusLabel.isEmpty ? nil : state.statusLabel
    }

    var glyph: Glyph {
        if state.status == .paused { return .pause }
        return state.status == .rest && content == .live ? .timer : .mark
    }

    // Orange is the rest's own colour; the word is orange only while nothing else is going on.
    var wordTone: Tone { state.status == .rest ? .accent : .ink }

    var restWindow: ClosedRange<Date>? {
        guard let end = state.restEnd else { return nil }
        return min(state.restStart ?? end, end)...end
    }

    var restRunning: Bool { content == .live && restWindow != nil && !state.restFrozen }

    // The clock goes once the rest is over or the app has gone quiet: a zero or a six-hour count
    // would read as a fault.
    var showsClock: Bool { content == .live }

    var clockTone: Tone {
        if restWindow != nil { return state.restFrozen ? .muted : .accent }
        return state.pausedAt != nil ? .muted : .ink
    }
}

// The rest's time left, or the session's time up; both stand still where a pause holds them.
private struct SessionClock: View {
    let look: SessionLook
    let size: CGFloat
    var showsHours = true

    var body: some View {
        // A timer text fills the width it is given, so it sits over an invisible copy of its widest
        // value: the digits never push their neighbours or clip.
        Text(verbatim: widest)
            .hidden()
            .overlay(alignment: .trailing) { clock.multilineTextAlignment(.trailing) }
            .font(.system(size: size, weight: .semibold))
            .monospacedDigit()
            .lineLimit(1)
    }

    private var widest: String {
        if look.restWindow != nil { return "0:00" }
        return showsHours ? "0:00:00" : "00:00"
    }

    // A clock a pause holds never moves, so it is written out rather than timed: the timer's own
    // pause date was not honoured everywhere these views are drawn.
    @ViewBuilder private var clock: some View {
        let state = look.state
        if let window = look.restWindow {
            if state.restFrozen, let pausedAt = state.pausedAt {
                Text(verbatim: Self.written(window.upperBound.timeIntervalSince(max(pausedAt, window.lowerBound)), showsHours: false))
            } else {
                Text(timerInterval: window, countsDown: true)
            }
        } else if let pausedAt = state.pausedAt {
            Text(verbatim: Self.written(pausedAt.timeIntervalSince(state.startedAt), showsHours: showsHours))
        } else {
            Text(
                timerInterval: state.startedAt...state.startedAt.addingTimeInterval(12 * 3600),
                countsDown: false,
                showsHours: showsHours
            )
        }
    }

    // « 1:12 », « 1:02:10 », or « 62:10 » without hours, as the timer writes them.
    private static func written(_ interval: TimeInterval, showsHours: Bool) -> String {
        let total = max(0, Int(interval.rounded()))
        let seconds = String(format: "%02d", total % 60)
        if showsHours && total >= 3600 {
            return "\(total / 3600):\(String(format: "%02d", total % 3600 / 60)):\(seconds)"
        }
        return "\(total / 60):\(seconds)"
    }
}

// The rest's bar, emptying over the planned rest; a pause that stops everything holds it.
private struct SessionBar: View {
    let look: SessionLook
    let fill: Color

    var body: some View {
        bar
            .progressViewStyle(.linear)
            .tint(fill)
            .accessibilityLabel(Text(look.state.statusLabel))
    }

    @ViewBuilder private var bar: some View {
        if let window = look.restWindow {
            if look.state.restFrozen, let pausedAt = look.state.pausedAt {
                let total = window.upperBound.timeIntervalSince(window.lowerBound)
                let left = window.upperBound.timeIntervalSince(pausedAt)
                ProgressView(value: total > 0 ? min(max(left / total, 0), 1) : 0)
            } else {
                ProgressView(timerInterval: window, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
            }
        }
    }
}

private struct SessionGlyph: View {
    let glyph: SessionLook.Glyph
    let size: CGFloat
    let accent: Color
    let ink: Color

    var body: some View {
        switch glyph {
        case .mark:
            BelayMark().fill(accent).frame(width: size, height: size * BelayMark.aspect)
        case .timer:
            Image(systemName: "timer").font(.system(size: size * 0.85, weight: .semibold)).foregroundStyle(accent)
        case .pause:
            Image(systemName: "pause.fill").font(.system(size: size * 0.8, weight: .semibold)).foregroundStyle(ink)
        }
    }
}

// MARK: - Lock screen (also the banner on a phone without a Dynamic Island)

struct SessionLockScreenView: View {
    let state: SessionActivityAttributes.ContentState
    let isStale: Bool

    @Environment(\.colorScheme) private var scheme
    @Environment(\.isLuminanceReduced) private var dimmed
    @ScaledMetric(relativeTo: .body) private var k: CGFloat = 1

    var body: some View {
        let look = SessionLook(state, isStale: isStale)
        // 10 rather than 12 between the row and the bar: the system's taller clock line would
        // otherwise make a rest two points higher than the other states.
        VStack(spacing: 10) {
            HStack(spacing: 12) {
                BelayMark()
                    .fill(accent)
                    .frame(width: 22, height: 22 * BelayMark.aspect)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 0) {
                    Text(look.title)
                        .font(.system(size: 17 * k, weight: .semibold))
                        .foregroundStyle(SessionPalette.ink)
                    // One line at any text size: the session's name gives way first.
                    Text(look.detail)
                        .font(.system(size: 15 * k, weight: .medium))
                        .foregroundStyle(muted)
                    if let line = look.staleLine {
                        Text(line)
                            .font(.system(size: 14 * k, weight: .semibold))
                            .foregroundStyle(SessionPalette.ink)
                            .padding(.top, 3)
                    }
                }
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
                if look.word != nil || look.showsClock {
                    VStack(alignment: .trailing, spacing: 0) {
                        if let word = look.word {
                            HStack(spacing: 4) {
                                if look.glyph == .pause {
                                    Image(systemName: "pause.fill")
                                        .font(.system(size: 11 * k, weight: .bold))
                                        .accessibilityHidden(true)
                                }
                                Text(word).lineLimit(1)
                            }
                            .font(.system(size: 13 * k, weight: .semibold))
                            .foregroundStyle(color(look.wordTone))
                        }
                        if look.showsClock {
                            SessionClock(look: look, size: (look.restWindow != nil ? 34 : 28) * k)
                                .foregroundStyle(color(look.clockTone))
                        }
                    }
                    .fixedSize()
                    .accessibilityElement(children: .combine)
                }
            }
            if look.showsClock && look.restWindow != nil {
                SessionBar(look: look, fill: color(look.clockTone))
            }
        }
        .padding(14)
        // Every state keeps the same height: only the content changes, so nothing jumps.
        .frame(maxWidth: .infinity, minHeight: 98)
    }

    private var raised: Bool { dimmed && scheme == .dark }
    private var accent: Color { raised ? SessionPalette.dimmedAccent : SessionPalette.accent }
    private var muted: Color { raised ? SessionPalette.dimmedMuted : SessionPalette.muted }

    private func color(_ tone: SessionLook.Tone) -> Color {
        switch tone {
        case .ink: return SessionPalette.ink
        case .accent: return accent
        case .muted: return muted
        }
    }
}

// MARK: - Dynamic Island

private func islandColor(_ tone: SessionLook.Tone) -> Color {
    switch tone {
    case .ink: return SessionPalette.islandInk
    case .accent: return SessionPalette.islandAccent
    case .muted: return SessionPalette.islandMuted
    }
}

// Expanded, on a long press: the compact's places on top, the exercise, the set and the bar below.
struct SessionExpandedLeading: View {
    let state: SessionActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let look = SessionLook(state, isStale: isStale)
        HStack(spacing: 6) {
            SessionGlyph(glyph: look.glyph, size: 24, accent: SessionPalette.islandAccent, ink: SessionPalette.islandInk)
                .accessibilityHidden(true)
            if let word = look.word {
                Text(word)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(islandColor(look.wordTone))
                    .lineLimit(1)
            }
        }
        .frame(maxHeight: .infinity)
    }
}

struct SessionExpandedTrailing: View {
    let state: SessionActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let look = SessionLook(state, isStale: isStale)
        if look.showsClock {
            SessionClock(look: look, size: 26)
                .foregroundStyle(islandColor(look.clockTone))
                .frame(maxHeight: .infinity)
        }
    }
}

struct SessionExpandedBottom: View {
    let state: SessionActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let look = SessionLook(state, isStale: isStale)
        VStack(alignment: .leading, spacing: 0) {
            Group {
                Text(look.title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(SessionPalette.islandInk)
                Text(look.detail)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(SessionPalette.islandMuted)
                if let line = look.staleLine {
                    Text(line)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(SessionPalette.islandInk)
                        .padding(.top, 3)
                }
            }
            .lineLimit(1)
            if look.showsClock && look.restWindow != nil {
                SessionBar(look: look, fill: islandColor(look.clockTone))
                    .padding(.top, 12)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// Compact, beside the camera: a glyph that tells rest, pause and set apart without colour, and
// the clock.
struct SessionCompactLeading: View {
    let state: SessionActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let look = SessionLook(state, isStale: isStale)
        Group {
            if look.content == .restOver {
                // The rest is over: the timer, no longer orange, with a tick on the other side.
                Image(systemName: "timer")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(SessionPalette.islandInk)
            } else {
                SessionGlyph(glyph: look.glyph, size: look.glyph == .mark ? 24 : 20, accent: SessionPalette.islandAccent, ink: SessionPalette.islandInk)
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(look.content == .restOver ? look.title : (look.word ?? look.title)))
    }
}

struct SessionCompactTrailing: View {
    let state: SessionActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let look = SessionLook(state, isStale: isStale)
        switch look.content {
        case .live:
            // Minutes past the hour (« 62:10 »): an hour's digits do not fit beside the camera.
            SessionClock(look: look, size: 15, showsHours: false)
                .foregroundStyle(islandColor(look.clockTone))
        case .restOver:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(SessionPalette.islandInk)
                .accessibilityLabel(Text(state.restOverDetail))
        case .stale:
            Image(systemName: "arrow.up.forward.app")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(SessionPalette.islandMuted)
                .accessibilityLabel(Text(state.staleLine))
        }
    }
}

// Minimal, a bubble beside another app's Activity: the countdown while a rest runs, else the
// pause or the mark.
struct SessionMinimalView: View {
    let state: SessionActivityAttributes.ContentState
    let isStale: Bool

    var body: some View {
        let look = SessionLook(state, isStale: isStale)
        if look.restRunning {
            SessionClock(look: look, size: 12.5)
                .foregroundStyle(SessionPalette.islandAccent)
                .accessibilityElement(children: .combine)
        } else {
            SessionGlyph(glyph: look.glyph == .pause ? .pause : .mark, size: look.glyph == .pause ? 17 : 22, accent: SessionPalette.islandAccent, ink: SessionPalette.islandInk)
                .accessibilityElement()
                .accessibilityLabel(Text(look.word ?? look.title))
        }
    }
}
