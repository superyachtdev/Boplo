import SwiftUI
import UIKit
import UserNotifications

/// The app is portrait everywhere except the simulator, which may turn to landscape.
/// Info.plist lists landscape so iOS allows it; this mask decides when.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    static var mask: UIInterfaceOrientationMask = .portrait

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        AppDelegate.mask
    }

    // MARK: Notifications

    /// Show Boplo's reminders as banners even when the app is open.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    /// A lock-screen answer to the question of the day, or a tap that should open the right screen.
    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let action = response.actionIdentifier
        if action.hasPrefix("ans-"), let picked = Int(action.dropFirst(4)), let qid = info["qid"] as? String,
           let answer = info["answer"] as? Int, let options = info["options"] as? [String] {
            Reminders.handleLockScreenAnswer(qid: qid, picked: picked, answer: answer, options: options, explain: info["explain"] as? String ?? "")
        } else if action == UNNotificationDefaultActionIdentifier, let route = info["open"] as? String {
            Task { @MainActor in NotificationRouter.shared.route = route }
        }
        completionHandler()
    }
}

enum Orientation {
    @MainActor
    static func allow(_ mask: UIInterfaceOrientationMask) {
        AppDelegate.mask = mask
        for scene in UIApplication.shared.connectedScenes {
            guard let ws = scene as? UIWindowScene else { continue }
            ws.windows.forEach { $0.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations() }
            // Rotate straight away: into landscape for the simulator, back upright when it closes.
            ws.requestGeometryUpdate(.iOS(interfaceOrientations: mask == .portrait ? .portrait : .landscapeRight)) { _ in }
        }
    }
}
