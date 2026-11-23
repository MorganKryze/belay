import AVFoundation
import BelayCore
import UIKit
import UserNotifications
import os

/// The one alert at the rest's end. Off screen it is a local notification under a fixed id, so
/// a new plan replaces the pending one. On screen the notification stays hidden and the phone
/// plays a haptic and the rest tone instead. The tone follows Réglages' choice, read at each plan
/// for the notification, again when the choice changes while one is pending, and at each end for
/// the screen.
final class RestAlert: NSObject, UNUserNotificationCenterDelegate {
    private static let id = "rest-end"
    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "rest-alert")

    private var last: RestAlertPlan?
    /// The tone choice the last plan's notification was made with.
    private var lastChoice: DevicePrefs.RestSound?
    private var ring: Task<Void, Never>?
    private var prefs: NSObjectProtocol?

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
        // A choice made while a rest runs reaches its pending notification, a store read or not.
        prefs = NotificationCenter.default.addObserver(
            forName: UserDefaults.didChangeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let last = self.last else { return }
                self.apply(last)
            }
        }
    }

    func apply(_ plan: RestAlertPlan) {
        let choice = DevicePrefs.restSound.value
        guard plan != last || choice != lastChoice else { return }
        last = plan
        lastChoice = choice
        ring?.cancel()
        ring = nil
        let center = UNUserNotificationCenter.current()
        guard case .schedule(let at, let title, let body) = plan, at > .now else {
            center.removePendingNotificationRequests(withIdentifiers: [Self.id])
            return
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        let sound: UNNotificationSoundName? = choice == .off ? nil : RestTone.sound
        content.sound = sound.map { UNNotificationSound(named: $0) }
        #if DEBUG
        // Read back from the content itself, so a sound set against the choice shows.
        Fixture.restHeard.planned(sound: content.sound == nil ? nil : sound?.rawValue ?? "unchosen")
        #endif
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: at.timeIntervalSinceNow, repeats: false)
        let request = UNNotificationRequest(identifier: Self.id, content: content, trigger: trigger)
        ring = Task { [weak self] in
            do {
                try await center.add(request)
            } catch {
                // Refused notifications leave the in-app alert, which still rings below.
                Self.log.error("rest alert not scheduled: \((error as NSError).code, privacy: .public)")
            }
            do { try await Task.sleep(for: .seconds(at.timeIntervalSinceNow)) } catch { return }
            self?.ringOnScreen()
        }
    }

    private func ringOnScreen() {
        guard UIApplication.shared.applicationState == .active else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        RestTone.play(DevicePrefs.restSound.value)
    }

    /// On screen the app rings itself: the banner stays hidden.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }
}

/// The rest's end tone: the web's two notes, bundled as `rest.wav`. Discret plays it in the ambient
/// session, beside the person's music and silenced by the ring switch; Toujours in the playback
/// session, through silent mode, iOS pausing the music until the tone is over.
enum RestTone {
    /// The bundled file, which the rest notification plays too.
    static let sound = UNNotificationSoundName("rest.wav")
    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "rest-tone")

    /// Kept while it plays: a player let go stops at once.
    private static var player: AVAudioPlayer?
    private static var over: Task<Void, Never>?
    /// Whether a Toujours tone still holds the person's music, its session not yet handed back.
    private static var holding = false

    /// Plays the tone once as `choice` asks; Coupé plays nothing.
    @MainActor static func play(_ choice: DevicePrefs.RestSound) {
        guard choice != .off else { return }
        let session = AVAudioSession.sharedInstance()
        // A Toujours tone cut short hands the music back before the next one takes the session.
        over?.cancel()
        over = nil
        if holding { release(session) }
        let player: AVAudioPlayer
        do {
            guard let url = Bundle.main.url(forResource: "rest", withExtension: "wav") else {
                return log.error("rest tone missing from the bundle")
            }
            try session.setCategory(choice == .over ? .playback : .ambient)
            try session.setActive(true)
            player = try AVAudioPlayer(contentsOf: url)
        } catch {
            // The haptic still marks the end: a tone the phone refuses is left out, never shown.
            return log.error("rest tone not played: \((error as NSError).code, privacy: .public)")
        }
        guard player.play() else { return log.error("rest tone refused by the player") }
        #if DEBUG
        Fixture.restHeard.heard(choice: choice.rawValue, category: session.category)
        #endif
        self.player = player
        holding = choice == .over
        over = Task {
            do { try await Task.sleep(for: .seconds(player.duration + 0.1)) } catch { return }
            self.player = nil
            // The playback session paused the person's music: handing the audio back lets it resume.
            if holding { release(session) }
        }
    }

    @MainActor private static func release(_ session: AVAudioSession) {
        holding = false
        do {
            try session.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            log.error("rest tone session kept: \((error as NSError).code, privacy: .public)")
        }
    }
}
