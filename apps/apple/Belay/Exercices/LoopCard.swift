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

/// The exercise's demonstration loop: square, muted, looping, without the player's controls; one
/// glass button pauses and plays. Under Reduce Motion the first frame holds until play is tapped.
struct LoopCard: View {
    let exerciseId: String
    let name: String
    @Environment(\.loops) private var loops
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase = LoopPhase.loading
    /// Nil until the person taps: then their choice wins over Reduce Motion.
    @State private var chosen: Bool?

    private var playing: Bool { chosen ?? !Motion.reduced(reduceMotion) }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Rectangle().fill(Color.sunk)
            switch phase {
            case .loading:
                ProgressView().controlSize(.large).frame(maxWidth: .infinity, maxHeight: .infinity)
            case .none:
                StandIn()
            case .ready(let url):
                LoopPlayer(url: url, playing: playing)
                Button {
                    chosen = !playing
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
        case .ready: playing
            ? String(localized: "en lecture", table: "Exercices")
            : String(localized: "en pause", table: "Exercices")
        }
    }

    /// A loop kept plays at once; otherwise the instance is asked once in this visit. An exercise
    /// with no loop shows the stand-in without waiting.
    private func load() async {
        if let kept = loops.kept(exerciseId) {
            phase = .ready(kept)
            return
        }
        guard loopPath(exerciseId) != nil else {
            phase = .none
            return
        }
        phase = .loading
        let url = await loops.fetch(exerciseId)
        phase = url.map(LoopPhase.ready) ?? .none
    }
}

/// The video, looping and muted, drawn by the system's layer without its controls.
private struct LoopPlayer: UIViewRepresentable {
    let url: URL
    let playing: Bool

    func makeUIView(context: Context) -> PlayerView {
        let view = PlayerView()
        view.play(url)
        return view
    }

    func updateUIView(_ view: PlayerView, context: Context) {
        view.play(url)
        if playing { view.player.play() } else { view.player.pause() }
    }

    static func dismantleUIView(_ view: PlayerView, coordinator: ()) {
        view.player.pause()
        view.player.removeAllItems()
    }

    final class PlayerView: UIView {
        let player = AVQueuePlayer()
        private var looper: AVPlayerLooper?
        private var url: URL?

        override static var layerClass: AnyClass { AVPlayerLayer.self }

        override init(frame: CGRect) {
            super.init(frame: frame)
            player.isMuted = true
            // A loop on screen is no reason to keep the phone awake.
            player.preventsDisplaySleepDuringVideoPlayback = false
            (layer as? AVPlayerLayer)?.player = player
            (layer as? AVPlayerLayer)?.videoGravity = .resizeAspect
            isAccessibilityElement = false
        }

        required init?(coder: NSCoder) { nil }

        func play(_ url: URL) {
            guard url != self.url else { return }
            self.url = url
            looper = AVPlayerLooper(player: player, templateItem: AVPlayerItem(url: url))
        }
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
    @Environment(\.loops) private var loops
    @Environment(\.displayScale) private var scale
    @ScaledMetric(relativeTo: .body) private var side: CGFloat = 44
    @State private var frame: UIImage?

    var body: some View {
        Group {
            if let frame {
                Image(uiImage: frame).resizable().scaledToFill()
            } else {
                Image(systemName: "figure.strengthtraining.traditional")
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
