import AudioToolbox
import BelayCore
import UIKit
import UserNotifications
import os

/// The one alert at the rest's end. Off screen it is a local notification under a fixed id, so
/// a new plan replaces the pending one. On screen the notification stays hidden and the phone
/// plays a haptic and a short tone instead, which the ring switch silences.
final class RestAlert: NSObject, UNUserNotificationCenterDelegate {
    private static let id = "rest-end"
    /// A short system tone: system sounds follow the ring switch.
    private static let tone: SystemSoundID = 1057
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
        content.sound = .default
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
        AudioServicesPlaySystemSound(Self.tone)
    }

    /// On screen the app rings itself: the banner stays hidden.
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter, willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        []
    }
}
