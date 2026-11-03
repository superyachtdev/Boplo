import Foundation
import Capacitor
import StoreKit
import AuthenticationServices
import CoreLocation
import UserNotifications

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
        CAPPluginMethod(name: "getPushToken", returnType: CAPPluginReturnPromise)
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
        location.allowsBackgroundLocationUpdates = true
        location.showsBackgroundLocationIndicator = true
        tokenObserver = NotificationCenter.default.addObserver(forName: Notification.Name("boploPushToken"), object: nil, queue: .main) { [weak self] note in
            guard let self = self, let token = note.object as? String else { return }
            self.pushToken = token
            self.pushCall?.resolve(["token": token, "environment": self.pushEnvironment()])
            self.pushCall = nil
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
            do {
                let products = try await Product.products(for: [requested])
                guard let product = products.first else {
                    call.reject("That plan isn’t available in the App Store yet. Create the subscription in App Store Connect first.")
                    return
                }
                let result = try await product.purchase()
                switch result {
                case .success(let verification):
                    let transaction = try Self.check(verification)
                    await transaction.finish()
                    call.resolve(["signedTransaction": verification.jwsRepresentation, "productId": transaction.productID])
                case .userCancelled:
                    call.resolve(["cancelled": true])
                case .pending:
                    call.resolve(["pending": true])
                @unknown default:
                    call.reject("The App Store didn’t finish that purchase.")
                }
            } catch {
                call.reject(error.localizedDescription)
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
            call.resolve(["signedTransactions": signed])
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
        if code == ASAuthorizationError.canceled.rawValue {
            appleCall?.resolve(["cancelled": true])
        } else if code == 1004 {
            appleCall?.reject("Sign in with Apple isn’t available until the Apple Developer account and the capability are turned on. Use email for now.")
        } else {
            appleCall?.reject(error.localizedDescription)
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
