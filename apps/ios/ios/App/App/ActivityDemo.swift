#if DEBUG
import ActivityKit
import Foundation

// Shows a fixed session's Activity from a launch argument (`-BelayActivityDemo rest`), so each
// state can be checked on the simulator without a server or a signed-in page. Each run appends one
// line to Documents/activity-demo.txt saying what iOS holds afterwards. Debug builds only.
enum ActivityDemo {
    // While a demo runs, the page's own descriptions are ignored: the signed-out page would end
    // the fixture.
    private(set) static var isRunning = false

    private enum Fixture: String {
        case due, rest, paused, pausedRunning = "paused-running", done, stale, end
    }

    static func runIfAsked() {
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
            restOverDetail: "C’est reparti · Série 2 sur 4",
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
            state.restOverDetail = "C’est reparti · Série 3 sur 4"
            state.restStart = now.addingTimeInterval(-18)
            state.restEnd = now.addingTimeInterval(72)
            staleAt = now.addingTimeInterval(72)
        case .paused, .pausedRunning:
            // The same 90-second rest, paused 5 seconds ago when it was 18 seconds in.
            let pausedAt = now.addingTimeInterval(-5)
            state.status = .paused
            state.statusLabel = "En pause"
            state.detail = "Série 3 sur 4 · Séance A"
            state.restOverDetail = "C’est reparti · Série 3 sur 4"
            state.pausedAt = pausedAt
            state.restStart = pausedAt.addingTimeInterval(-18)
            state.restEnd = pausedAt.addingTimeInterval(72)
            state.restFrozen = fixture == .paused
            if fixture == .pausedRunning { staleAt = pausedAt.addingTimeInterval(72) }
        case .done:
            state.status = .done
            state.title = "Toutes les séries faites"
            state.detail = "Séance A"
            state.statusLabel = ""
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
