import AVFoundation
import BelayCore
import UIKit
import UserNotifications
import os

/// The one alert at the rest's end. Off screen it is a local notification under a fixed id, so
/// a new plan replaces the pending one. On screen the notification stays hidden and the phone
/// plays a haptic and the rest tone instead. The tone follows Réglages' choice, read at each plan
/// for the notification and at each end for the screen.
final class RestAlert: NSObject, UNUserNotificationCenterDelegate {
    private static let id = "rest-end"
    private static let log = Logger(subsystem: "cloud.libresoftware.belay", category: "rest-alert")

    private var last: RestAlertPlan?
    private var ring: Task<Void, Never>?

    override init() {
        super.init()
        UNUserNotificationCenter.current().delegate = self
    }

    func apply(_ plan: RestAlertPlan) {
        guard plan != last else { return }
        last = plan
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
        let choice = DevicePrefs.restSound.value
        content.sound = choice == .off ? nil : UNNotificationSound(named: RestTone.sound)
        #if DEBUG
        Fixture.restHeard.planned(sound: choice == .off ? nil : RestTone.sound.rawValue)
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

    /// Plays the tone once as `choice` asks; Coupé plays nothing.
    @MainActor static func play(_ choice: DevicePrefs.RestSound) {
        guard choice != .off else { return }
        let session = AVAudioSession.sharedInstance()
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
        #if DEBUG
        Fixture.restHeard.heard(choice: choice.rawValue, category: session.category)
        #endif
        player.play()
        self.player = player
        over?.cancel()
        over = Task {
            do { try await Task.sleep(for: .seconds(player.duration + 0.1)) } catch { return }
            self.player = nil
            // The playback session paused the person's music: handing the audio back lets it resume.
            guard choice == .over else { return }
            do {
                try session.setActive(false, options: .notifyOthersOnDeactivation)
            } catch {
                log.error("rest tone session kept: \((error as NSError).code, privacy: .public)")
            }
        }
    }
}
