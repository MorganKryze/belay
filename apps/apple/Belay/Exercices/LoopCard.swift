import AVFoundation
import BelayCore
import SwiftUI
import UIKit

/// Where the screens get an exercise's loop: one already on the phone, or one the instance sends.
struct LoopSource {
    let kept: @MainActor (String) -> URL?
    let fetch: @MainActor (String) async -> URL?

    /// No loops at all, as before a sign-in.
    static let none = LoopSource(kept: { _ in nil }, fetch: { _ in nil })
}

extension EnvironmentValues {
    @Entry var loops = LoopSource.none
}

/// What the loop's square holds.
private enum LoopPhase: Equatable {
    case loading
    case ready(URL)
    /// No loop for this exercise, none served, or one that failed: the stand-in figure.
    case none
}

/// Where the clip is: on its first frame, running, or stopped part way.
enum LoopPlayback: Equatable {
    case rest
    case playing
    case paused
}

/// The exercise's demonstration: square, muted, without the player's controls. It never moves by
/// itself: it shows its first frame, and one glass button plays the clip once from its start, then
/// it rests on its first frame again; the same button pauses it while it runs.
struct LoopCard: View {
    let exerciseId: String
    let name: String
    @Environment(\.loops) private var loops
    @State private var phase = LoopPhase.loading
    @State private var playback = LoopPlayback.rest
    /// Counts the taps on play: each one starts the clip from its start.
    @State private var run = 0
    /// The player has its first frame: until then the spinner stays on the light square.
    @State private var shown = false

    private var playing: Bool { playback == .playing }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Rectangle().fill(Color.sunk)
            switch phase {
            case .loading:
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .none:
                StandIn()
            case .ready(let url):
                LoopPlayer(
                    url: url, playback: playback, run: run,
                    ready: { shown = true }, ended: { playback = .rest }, failed: { phase = .none })
                    .opacity(shown ? 1 : 0)
                if !shown {
                    ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                Button {
                    if playing {
                        playback = .paused
                    } else {
                        run += 1
                        playback = .playing
                    }
                } label: {
                    Image(systemName: playing ? "pause.fill" : "play.fill")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(.ink)
                        .frame(width: 48, height: 48)
                }
                .buttonStyle(.glass)
                .buttonBorderShape(.circle)
                .padding(12)
                .accessibilityLabel(
                    playing
                        ? Text("Mettre en pause", tableName: "Exercices")
                        : Text("Lire la démonstration", tableName: "Exercices"))
                }
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .clipShape(.rect(cornerRadius: 22))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Démonstration de \(name), \(state)", tableName: "Exercices"))
        .accessibilityIdentifier("loop")
        .task(id: exerciseId) { await load() }
    }

    /// The loop's state in words, for VoiceOver.
    private var state: String {
        switch phase {
        case .loading: String(localized: "chargement", table: "Exercices")
        case .none: String(localized: "indisponible", table: "Exercices")
        case .ready where !shown: String(localized: "chargement", table: "Exercices")
        case .ready:
            switch playback {
            case .rest: String(localized: "prête", table: "Exercices")
            case .playing: String(localized: "en lecture", table: "Exercices")
            case .paused: String(localized: "en pause", table: "Exercices")
            }
        }
    }

    /// A loop kept shows at once; otherwise the instance is asked once in this visit. An exercise
    /// with no loop shows the stand-in without waiting.
    private func load() async {
        if let kept = loops.kept(exerciseId) {
            // The card back on screen with the loop it holds: its player keeps the same file and
            // says nothing new, so the frame it shows stays shown.
            guard phase != .ready(kept) else { return }
            shown = false
            playback = .rest
            phase = .ready(kept)
            return
        }
        shown = false
        playback = .rest
        guard loopPath(exerciseId) != nil else {
            phase = .none
            return
        }
        phase = .loading
        let url = await loops.fetch(exerciseId)
        phase = url.map(LoopPhase.ready) ?? .none
    }
}

/// The video, muted, drawn by the system's layer without its controls. A new run plays it from its
/// start; at its end it goes back to its first frame and says so. It says when its first frame is
/// ready, and when the file cannot be played.
private struct LoopPlayer: UIViewRepresentable {
    let url: URL
    let playback: LoopPlayback
    let run: Int
    let ready: @MainActor () -> Void
    let ended: @MainActor () -> Void
    let failed: @MainActor () -> Void

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        updateUIView(view, context: context)
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {
        view.ready = ready
        view.ended = ended
        view.failed = failed
        view.load(url)
        view.apply(playback, run: run)
    }

    static func dismantleUIView(_ view: PlayerView, coordinator: ()) {
        view.stop()
    }

    final class PlayerView: UIView {
        let player = AVPlayer()
        var ready: @MainActor () -> Void = {}
        var ended: @MainActor () -> Void = {}
        var failed: @MainActor () -> Void = {}
        private var url: URL?
        /// The run this player last started; nil in a player made afresh.
        private var started: Int?
        private var watches: [NSKeyValueObservation] = []
        private var end: NSObjectProtocol?

        override static var layerClass: AnyClass { AVPlayerLayer.self }

        override init(frame: CGRect) {
            super.init(frame: frame)
            player.isMuted = true
            player.actionAtItemEnd = .pause
            // A clip on screen is no reason to keep the phone awake.
            player.preventsDisplaySleepDuringVideoPlayback = false
            (layer as? AVPlayerLayer)?.player = player
            (layer as? AVPlayerLayer)?.videoGravity = .resizeAspect
            isAccessibilityElement = false
        }

        required init?(coder: NSCoder) { nil }

        /// The card leaves: nothing plays and nothing is watched any more.
        func stop() {
            player.pause()
            player.replaceCurrentItem(with: nil)
            if let end { NotificationCenter.default.removeObserver(end) }
            end = nil
            watches = []
        }

        func load(_ url: URL) {
            guard url != self.url else { return }
            self.url = url
            let item = AVPlayerItem(url: url)
            player.replaceCurrentItem(with: item)
            if let end { NotificationCenter.default.removeObserver(end) }
            end = NotificationCenter.default.addObserver(
                forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.player.seek(to: .zero)
                    self.ended()
                }
            }
            guard let shown = layer as? AVPlayerLayer else { return }
            watches = [
                shown.observe(\.isReadyForDisplay, options: [.initial, .new]) { [weak self] layer, _ in
                    guard layer.isReadyForDisplay else { return }
                    Task { @MainActor in self?.ready() }
                },
                item.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
                    guard item.status == .failed else { return }
                    Task { @MainActor in self?.failed() }
                },
            ]
        }

        /// Plays from the start once per new run; otherwise holds where the clip is.
        func apply(_ playback: LoopPlayback, run: Int) {
            guard playback == .playing else {
                player.pause()
                return
            }
            guard started != run else { return }
            started = run
            player.seek(to: .zero)
            player.play()
        }
    }
}

/// A stand-in figure by movement, as the body map will draw it: the legs' muscles squat, the
/// others stand.
enum StandInFigure {
    static func symbol(_ primary: [String]) -> String {
        let legs: Set = ["glutes", "quads", "hamstrings", "adductors", "calves"]
        return primary.first.map(legs.contains) == true ? "figure.strengthtraining.functional" : "figure.arms.open"
    }
}

/// The figure in the square when there is no loop to show.
private struct StandIn: View {
    var body: some View {
        Image(systemName: "figure.strengthtraining.traditional")
            .font(.system(size: 96, weight: .regular))
            .foregroundStyle(.muted)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityHidden(true)
    }
}

/// A row's 44 pt thumbnail: the first frame of the exercise's loop, kept or fetched as the row
/// shows, else the stand-in figure.
struct LoopThumb: View {
    let exerciseId: String
    /// The exercise's main muscles, for the stand-in figure.
    var primary: [String] = []
    @Environment(\.loops) private var loops
    @Environment(\.displayScale) private var scale
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 44
    @State private var frame: UIImage?

    var body: some View {
        Group {
            if let frame {
                Image(uiImage: frame).resizable().scaledToFill()
            } else {
                Image(systemName: StandInFigure.symbol(primary))
                    .font(.system(size: side * 0.5, weight: .medium))
                    .foregroundStyle(.muted)
            }
        }
        .frame(width: side, height: side)
        .background(Color.track)
        .clipShape(.rect(cornerRadius: 11))
        .accessibilityHidden(true)
        .task(id: exerciseId) {
            if let cached = ThumbCache.images.object(forKey: exerciseId as NSString) {
                frame = cached
                return
            }
            guard loopPath(exerciseId) != nil else { return }
            var url = loops.kept(exerciseId)
            if url == nil { url = await loops.fetch(exerciseId) }
            guard let url, let image = await Self.firstFrame(url, side: side * scale), !Task.isCancelled else { return }
            ThumbCache.images.setObject(image, forKey: exerciseId as NSString)
            frame = image
        }
    }

    private static func firstFrame(_ url: URL, side: CGFloat) async -> UIImage? {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.maximumSize = CGSize(width: side, height: side)
        generator.appliesPreferredTrackTransform = true
        guard let (image, _) = try? await generator.image(at: .zero) else { return nil }
        return UIImage(cgImage: image)
    }
}

/// The thumbnails drawn while the account is open, so a row scrolled back is not decoded again.
/// Bounded: the library holds about 1 300 exercises.
enum ThumbCache {
    fileprivate static let images: NSCache<NSString, UIImage> = {
        let cache = NSCache<NSString, UIImage>()
        cache.countLimit = 200
        return cache
    }()

    /// The account is going: the thumbnails tell which exercises it looked at.
    static func clear() { images.removeAllObjects() }
}
