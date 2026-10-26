#if DEBUG
import ActivityKit
import SwiftUI

// Shows a fixed session's Activity from a launch argument (`-BelayActivityDemo rest`), so each
// state can be checked on the simulator without a server or a signed-in page. Each run appends one
// line to Documents/activity-demo.txt saying what iOS holds afterwards. `-BelayActivityRender YES`
// draws every presentation of every state, light and dark, to Documents/activity-renders: the lock
// screen cannot be scripted on the simulator. Debug builds only.
enum ActivityDemo {
    // While a demo runs, the page's own descriptions are ignored: the signed-out page would end
    // the fixture.
    private(set) static var isRunning = false

    private enum Fixture: String {
        case due, rest, paused, pausedRunning = "paused-running", done, stale, end
    }

    static func runIfAsked() {
        if UserDefaults.standard.bool(forKey: "BelayActivityRender") {
            Task { @MainActor in await render() }
        }
        guard let name = UserDefaults.standard.string(forKey: "BelayActivityDemo"),
              let fixture = Fixture(rawValue: name)
        else { return }
        isRunning = true
        let payload = self.payload(fixture, now: Date())
        Task {
            await LiveActivity.show(payload)
            // This process sees an update's content a moment after iOS took it, so the line waits
            // for it, two seconds at most, before saying what iOS holds.
            var live = Activity<SessionActivityAttributes>.activities.filter(LiveActivity.isLive)
            for _ in 0..<20 where live.first?.content.state != payload?.state {
                try? await Task.sleep(nanoseconds: 100_000_000)
                live = Activity<SessionActivityAttributes>.activities.filter(LiveActivity.isLive)
            }
            let status = live.first.map { $0.content.state.status.rawValue } ?? "none"
            append("activity-demo \(name) activities=\(live.count) status=\(status)\n")
        }
    }

    private static func payload(_ fixture: Fixture, now: Date) -> SessionActivityPayload? {
        let later = now.addingTimeInterval(6 * 3600)
        var state = SessionActivityAttributes.ContentState(
            status: .due,
            title: "Barbell bench press",
            detail: "Série 2 sur 4 · Séance A",
            statusLabel: "En cours",
            restOverTitle: "Repos terminé",
            restOverDetail: "C’est reparti",
            staleLine: "Ouvre Belay pour continuer",
            startedAt: now.addingTimeInterval(-12 * 60),
            pausedAt: nil,
            restStart: nil,
            restEnd: nil,
            restFrozen: false
        )
        var staleAt = later
        switch fixture {
        case .due:
            break
        case .rest:
            state.status = .rest
            state.statusLabel = "Repos"
            state.detail = "Série 3 sur 4 · Séance A"
            state.restStart = now.addingTimeInterval(-18)
            state.restEnd = now.addingTimeInterval(72)
            staleAt = now.addingTimeInterval(72)
        case .paused, .pausedRunning:
            // The same 90-second rest, paused 5 seconds ago when it was 18 seconds in.
            let pausedAt = now.addingTimeInterval(-5)
            state.status = .paused
            state.statusLabel = "En pause"
            state.detail = "Série 3 sur 4 · Séance A"
            state.pausedAt = pausedAt
            state.restStart = pausedAt.addingTimeInterval(-18)
            state.restEnd = pausedAt.addingTimeInterval(72)
            state.restFrozen = fixture == .paused
            if fixture == .pausedRunning { staleAt = pausedAt.addingTimeInterval(72) }
        case .done:
            state.status = .done
            state.title = "Toutes les séries faites"
            state.detail = "Séance A"
        case .stale:
            staleAt = now.addingTimeInterval(-60)
        case .end:
            return nil
        }
        return SessionActivityPayload(
            workoutId: "0192f5a0-7c1e-7b3a-9d2e-4f6a8b1c3d5e",
            staleAt: staleAt,
            state: state
        )
    }

    // Every state the Activity can show: the rest over is the rest gone stale at its end.
    private static let renderStates: [(name: String, fixture: Fixture, isStale: Bool)] = [
        ("due", .due, false),
        ("rest", .rest, false),
        ("rest-over", .rest, true),
        ("paused-frozen", .paused, false),
        ("paused-running", .pausedRunning, false),
        ("done", .done, false),
        ("stale", .stale, true),
    ]

    // Drawn in a window of the app's scene, behind the page, rather than by ImageRenderer: that
    // one leaves a placeholder where the rest's bar is (a UIKit view) and ignores a pause's hold on
    // the clocks.
    @MainActor private static func render() async {
        var scene: UIWindowScene?
        for _ in 0..<50 {
            scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            if scene != nil { break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let folder = documents.appendingPathComponent("activity-renders")
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var count = 0
        if let scene {
            let window = UIWindow(windowScene: scene)
            window.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.normal.rawValue - 1)
            window.isHidden = false
            let now = Date()
            for item in renderStates {
                guard let state = payload(item.fixture, now: now)?.state else { continue }
                for (scheme, schemeName) in [(ColorScheme.light, "light"), (.dark, "dark")] {
                    for (presentation, view) in presentations(state, isStale: item.isStale) {
                        let url = folder.appendingPathComponent("\(presentation)-\(item.name)-\(schemeName).png")
                        let image = await snapshot(view.environment(\.colorScheme, scheme), scheme: scheme, in: window)
                        guard let data = image.pngData(), (try? data.write(to: url)) != nil else { continue }
                        count += 1
                    }
                }
            }
            window.isHidden = true
        }
        append("activity-render \(count)\n")
    }

    @MainActor private static func snapshot(_ view: some View, scheme: ColorScheme, in window: UIWindow) async -> UIImage {
        let host = UIHostingController(rootView: view.fixedSize())
        host.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
        host.view.backgroundColor = .clear
        // The window sits under the status bar: no inset, the image is the view alone.
        host.safeAreaRegions = []
        window.rootViewController = host
        let size = host.sizeThatFits(in: CGSize(width: 1000, height: 1000))
        window.frame = CGRect(origin: .zero, size: size)
        host.view.frame = window.bounds
        host.view.layoutIfNeeded()
        // One pass of the run loop so SwiftUI has drawn the content before it is captured.
        try? await Task.sleep(nanoseconds: 50_000_000)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 3
        // sRGB, as the colours are written, so contrast can be measured on the image as is.
        format.preferredRange = .standard
        return UIGraphicsImageRenderer(size: size, format: format).image { _ in
            _ = host.view.drawHierarchy(in: host.view.bounds, afterScreenUpdates: true)
        }
    }

    // Each presentation at the size iOS gives it on a 393-point phone, on what it sits on.
    @MainActor private static func presentations(
        _ state: SessionActivityAttributes.ContentState, isStale: Bool
    ) -> [(String, AnyView)] {
        let card = RoundedRectangle(cornerRadius: 22, style: .continuous)
        let compactWidth: CGFloat = 52.33, islandHeight: CGFloat = 36.67
        return [
            ("lock", AnyView(
                SessionLockScreenView(state: state, isStale: isStale)
                    .frame(width: 371)
                    .background(SessionPalette.background)
                    .overlay(card.strokeBorder(SessionPalette.edge, lineWidth: 1))
                    .clipShape(card)
            )),
            ("expanded-leading", AnyView(
                SessionExpandedLeading(state: state, isStale: isStale)
                    .frame(width: 120, height: 44, alignment: .leading)
                    .background(Color.black)
            )),
            ("expanded-trailing", AnyView(
                SessionExpandedTrailing(state: state, isStale: isStale)
                    .frame(width: 120, height: 44, alignment: .trailing)
                    .background(Color.black)
            )),
            ("expanded-bottom", AnyView(
                SessionExpandedBottom(state: state, isStale: isStale)
                    .frame(width: 327)
                    .background(Color.black)
            )),
            ("compact-leading", AnyView(
                SessionCompactLeading(state: state, isStale: isStale)
                    .frame(width: compactWidth, height: islandHeight)
                    .background(Color.black)
            )),
            ("compact-trailing", AnyView(
                SessionCompactTrailing(state: state, isStale: isStale)
                    .frame(width: compactWidth, height: islandHeight)
                    .background(Color.black)
            )),
            ("minimal", AnyView(
                SessionMinimalView(state: state, isStale: isStale)
                    .frame(minWidth: islandHeight, minHeight: islandHeight)
                    .background(Color.black)
            )),
        ]
    }

    private static func append(_ line: String) {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let url = documents.appendingPathComponent("activity-demo.txt")
        let data = Data(line.utf8)
        guard let handle = try? FileHandle(forWritingTo: url) else {
            try? data.write(to: url)
            return
        }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }
}
#endif
