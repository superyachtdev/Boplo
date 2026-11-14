import SwiftUI
import UIKit

/// The app is portrait everywhere except the simulator, which may turn to landscape.
/// Info.plist lists landscape so iOS allows it; this mask decides when.
final class AppDelegate: NSObject, UIApplicationDelegate {
    static var mask: UIInterfaceOrientationMask = .portrait

    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        AppDelegate.mask
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
