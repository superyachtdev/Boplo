import Foundation
import Capacitor
import StoreKit
import AuthenticationServices
import CoreLocation
import UserNotifications
import WebKit

@objc(BoploPlugin)
public class BoploPlugin: CAPPlugin, CAPBridgedPlugin, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding, CLLocationManagerDelegate {
    public let identifier = "BoploPlugin"
    public let jsName = "Boplo"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "purchase", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signInWithApple", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPoints", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "registerPush", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPushToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlockInteraction", returnType: CAPPluginReturnPromise)
    ]

    private let yearly = "app.boplo.flight.advanced.yearly"
    private let monthly = "app.boplo.flight.advanced.monthly"
    private var appleCall: CAPPluginCall?
    private var appleController: ASAuthorizationController?
    private let location = CLLocationManager()
    private var points: [[String: Any]] = []
    private var recording = false
    private var pushCall: CAPPluginCall?
    private var pushToken: String?
    private var tokenObserver: NSObjectProtocol?

    override public func load() {
        location.delegate = self
        location.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        location.distanceFilter = 15
        location.activityType = .otherNavigation
        location.pausesLocationUpdatesAutomatically = false
        // allowsBackgroundLocationUpdates throws if it is set before a recording is allowed.
        // That exception aborts plugin load. It is enabled in startRecording instead.
        tokenObserver = NotificationCenter.default.addObserver(forName: Notification.Name("boploPushToken"), object: nil, queue: .main) { [weak self] note in
            guard let self = self, let token = note.object as? String else { return }
            self.pushToken = token
            self.pushCall?.resolve(["token": token, "environment": self.pushEnvironment()])
            self.pushCall = nil
        }
        // The splash plugin disables the view controller until its hide animation finishes.
        // A layout pass during page load cancels that animation, so the desk is visible and untappable.
        for delay in [0.05, 0.4, 1.0, 2.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                Self.releaseTouches(bridge: self?.bridge)
                Self.paintEdgeToEdge(bridge: self?.bridge)
            }
        }
    }

    /// The status-bar plugin shrinks the web view and the scroll view insets itself, so the window’s old navy shows as black bands.
    static func paintEdgeToEdge(bridge: CAPBridgeProtocol?) {
        let cloud = UIColor(red: 237 / 255, green: 242 / 255, blue: 250 / 255, alpha: 1)
        guard let root = bridge?.viewController?.view else { return }
        root.backgroundColor = cloud
        root.window?.backgroundColor = cloud
        guard let web = bridge?.webView else { return }
        web.isOpaque = true
        web.backgroundColor = cloud
        web.scrollView.backgroundColor = cloud
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.contentInset = .zero
        web.scrollView.scrollIndicatorInsets = .zero
        if let parent = web.superview {
            parent.backgroundColor = cloud
            web.frame = parent.bounds
        }
    }

    @objc func unlockInteraction(_ call: CAPPluginCall) {
        Self.releaseTouches(bridge: bridge)
        Self.paintEdgeToEdge(bridge: bridge)
        call.resolve()
    }

    /// Turns touches back on and drops a full-screen splash view left above the web view.
    static func releaseTouches(bridge: CAPBridgeProtocol?) {
        guard let root = bridge?.viewController?.view else { return }
        root.isUserInteractionEnabled = true
        bridge?.webView?.isUserInteractionEnabled = true
        let web = bridge?.webView
        for sub in root.subviews where sub !== web {
            let covers = sub.frame.width >= root.bounds.width - 2 && sub.frame.height >= root.bounds.height * 0.85
            if covers {
                sub.isUserInteractionEnabled = false
                sub.removeFromSuperview()
            }
        }
    }

    deinit {
        if let tokenObserver = tokenObserver { NotificationCenter.default.removeObserver(tokenObserver) }
    }

    @objc func purchase(_ call: CAPPluginCall) {
        let requested = call.getString("productId") ?? yearly
        guard requested == yearly || requested == monthly else {
            call.reject("That plan isn’t sold in the app.")
            return
        }
        Task {
            let outcome: Result<[String: Any], Error>
            do {
                let products = try await Product.products(for: [requested])
                guard let product = products.first else {
                    DispatchQueue.main.async { call.reject("That plan isn’t available in the App Store yet. Create the subscription in App Store Connect first.") }
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    let transaction = try Self.check(verification)
                    await transaction.finish()
                    outcome = .success(["signedTransaction": verification.jwsRepresentation, "productId": transaction.productID])
                case .userCancelled:
                    outcome = .success(["cancelled": true])
                case .pending:
                    outcome = .success(["pending": true])
                @unknown default:
                    outcome = .failure(NSError(domain: "Boplo", code: 3, userInfo: [NSLocalizedDescriptionKey: "The App Store didn’t finish that purchase."]))
                }
            } catch {
                outcome = .failure(error)
            }
            // Resolve on the main queue. Calling the bridge from the StoreKit task
            // makes Swift take a forced synchronous hop and logs unsafeForcedSync.
            DispatchQueue.main.async {
                switch outcome {
                case .success(let data): call.resolve(data)
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func restore(_ call: CAPPluginCall) {
        Task {
            var signed: [String] = []
            for await result in Transaction.currentEntitlements {
                guard let transaction = try? Self.check(result) else { continue }
                if transaction.productID == self.yearly || transaction.productID == self.monthly {
                    signed.append(result.jwsRepresentation)
                }
            }
            let payload = signed
            DispatchQueue.main.async {
                call.resolve(["signedTransactions": payload])
            }
        }
    }

    @objc func signInWithApple(_ call: CAPPluginCall) {
        appleCall = call
        let request = ASAuthorizationAppleIDProvider().createRequest()
        request.requestedScopes = [.fullName, .email]
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        appleController = controller
        controller.performRequests()
    }

    public func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        return bridge?.webView?.window ?? ASPresentationAnchor()
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
              let tokenData = credential.identityToken,
              let token = String(data: tokenData, encoding: .utf8) else {
            appleCall?.reject("Apple didn’t return a sign-in token.")
            appleCall = nil
            return
        }
        var name = ""
        if let full = credential.fullName {
            name = [full.givenName, full.familyName].compactMap { $0 }.joined(separator: " ")
        }
        appleCall?.resolve(["identityToken": token, "name": name])
        appleCall = nil
        appleController = nil
    }

    public func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        let code = (error as NSError).code
        // 1000 unknown, 1001 canceled, 1002 invalid response, 1003 not handled, 1004 failed.
        // Cancel stays silent. Every other code is a calm line. The system string includes the error domain, so it is never sent.
        if code == ASAuthorizationError.canceled.rawValue || code == 1001 {
            appleCall?.resolve(["cancelled": true])
        } else {
            appleCall?.resolve(["unavailable": true])
        }
        appleCall = nil
        appleController = nil
    }

    @objc func startRecording(_ call: CAPPluginCall) {
        let status = location.authorizationStatus
        if status == .denied || status == .restricted {
            call.reject("Allow location access for Boplo to record the flight.")
            return
        }
        points = []
        recording = true
        let modes = Bundle.main.object(forInfoDictionaryKey: "UIBackgroundModes") as? [String] ?? []
        if modes.contains("location") {
            location.allowsBackgroundLocationUpdates = true
            location.showsBackgroundLocationIndicator = true
        }
        location.requestAlwaysAuthorization()
        location.startUpdatingLocation()
        call.resolve(["started": true])
    }

    @objc func stopRecording(_ call: CAPPluginCall) {
        recording = false
        location.stopUpdatingLocation()
        call.resolve(["points": points])
    }

    @objc func getPoints(_ call: CAPPluginCall) {
        call.resolve(["points": points, "recording": recording])
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard recording else { return }
        for fix in locations {
            if fix.horizontalAccuracy < 0 || fix.horizontalAccuracy > 80 { continue }
            let t = fix.timestamp.timeIntervalSince1970 * 1000
            if let last = points.last, let lastT = last["t"] as? Double, t - lastT < 2000 { continue }
            var point: [String: Any] = [
                "lat": fix.coordinate.latitude,
                "lng": fix.coordinate.longitude,
                "t": t
            ]
            if fix.verticalAccuracy >= 0 { point["alt"] = fix.altitude }
            if fix.speed >= 0 { point["gs"] = fix.speed * 1.943844 }
            points.append(point)
            if points.count > 9000 { points = stride(from: 0, to: points.count, by: 2).map { points[$0] } }
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // A missing fix is normal in a hangar. The web UI already says to wait for the sky.
    }

    @objc func registerPush(_ call: CAPPluginCall) {
        pushCall = call
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            DispatchQueue.main.async {
                if let error = error {
                    call.reject(error.localizedDescription)
                    self.pushCall = nil
                    return
                }
                if !granted {
                    call.reject("Notifications are blocked for Boplo. Allow them in Settings.")
                    self.pushCall = nil
                    return
                }
                UIApplication.shared.registerForRemoteNotifications()
                if let token = self.pushToken {
                    call.resolve(["token": token, "environment": self.pushEnvironment()])
                    self.pushCall = nil
                }
            }
        }
    }

    @objc func getPushToken(_ call: CAPPluginCall) {
        call.resolve(["token": pushToken ?? "", "environment": pushEnvironment()])
    }

    private func pushEnvironment() -> String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    private static func check<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified:
            throw NSError(domain: "Boplo", code: 1, userInfo: [NSLocalizedDescriptionKey: "The App Store couldn’t verify that purchase."])
        case .verified(let value):
            return value
        }
    }
}
