import AuthenticationServices
import UIKit

/// Asks Sign in with Apple for a fresh authorization code (used when deleting an account, so the
/// server can revoke Boplo's Apple tokens).
@MainActor
final class AppleReauth: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<String, Error>?
    private static var current: AppleReauth?

    static func authorizationCode() async throws -> String {
        let helper = AppleReauth()
        current = helper
        defer { current = nil }
        return try await withCheckedThrowingContinuation { cont in
            helper.continuation = cont
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = []
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = helper
            controller.presentationContextProvider = helper
            controller.performRequests()
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let code = (authorization.credential as? ASAuthorizationAppleIDCredential)?.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
        Task { @MainActor in
            if let code { self.continuation?.resume(returning: code) }
            else { self.continuation?.resume(throwing: APIError(message: "Apple didn’t confirm. Try again.", status: 0)) }
            self.continuation = nil
        }
    }

    nonisolated func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        Task { @MainActor in
            let cancelled = (error as? ASAuthorizationError)?.code == .canceled
            self.continuation?.resume(throwing: APIError(message: cancelled ? "Deleting needs you to confirm with Apple. Nothing was deleted." : "Apple didn’t confirm. Nothing was deleted; try again.", status: 0))
            self.continuation = nil
        }
    }

    nonisolated func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
            return scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first ?? ASPresentationAnchor()
        }
    }
}
