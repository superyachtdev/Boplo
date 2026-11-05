import SwiftUI
import UIKit

/// One-time permission before Boplo sends anything to a third-party AI provider (App Store
/// guideline 5.1.2(i)). Shown over whatever is on screen, including sheets, the first time an AI
/// feature is used. Can be switched off again in You › AI features.
@MainActor
enum AIConsent {
    static let key = "boplo.aiConsent.v1"

    static var granted: Bool {
        get { UserDefaults.standard.bool(forKey: key) }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    static func ensure() async -> Bool {
        if granted { return true }
        guard let top = topController() else { return false }
        return await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            final class Box { weak var host: UIViewController?; var done = false }
            let box = Box()
            let sheet = AIConsentSheet { ok in
                guard !box.done else { return }
                box.done = true
                if ok { granted = true }
                box.host?.dismiss(animated: true)
                cont.resume(returning: ok)
            }
            let host = UIHostingController(rootView: sheet)
            host.isModalInPresentation = true
            host.sheetPresentationController?.detents = [.large()]
            host.sheetPresentationController?.prefersGrabberVisible = false
            box.host = host
            top.present(host, animated: true)
        }
    }

    private static func topController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}

struct AIConsentSheet: View {
    let decide: (Bool) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Image(systemName: "sparkles")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(Theme.electric)
                    .padding(.top, 28)
                Text("Before Ask Boplo answers")
                    .font(Theme.display(34)).tracking(-1)
                    .foregroundStyle(Theme.ink)
                Text("Ask Boplo, the mock checkride and question explanations are written by an AI service run by another company. To answer, Boplo sends them:")
                    .font(.archivo(15.5)).foregroundStyle(Theme.ink2)
                VStack(alignment: .leading, spacing: 10) {
                    row("text.bubble", "Your question and the recent messages in that chat")
                    row("person.text.rectangle", "A summary of your desk: first name, licence, home airfield and aircraft, school, hours, next lesson and preparation, and your last five flights with their debriefs")
                    row("building.2", "To Anthropic (Claude). If it's unavailable, Google (Gemini) may answer instead")
                }
                .padding(16)
                .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
                Text("They don't get your email address or your GPS tracks. Nothing is sent until you allow it, and you can switch it off any time in You › AI features. [How Boplo handles your data](https://boplo.app/privacy.html)")
                    .font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                    .tint(Theme.electric)
            }
            .padding(.horizontal, 24)
        }
        .background(Theme.cloud.ignoresSafeArea())
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 10) {
                Button { decide(true) } label: { Text("Allow") }
                    .primaryStyle()
                Button("Not now") { decide(false) }
                    .font(.archivo(15.5, .semibold))
                    .foregroundStyle(Theme.ink2)
                    .frame(maxWidth: .infinity, minHeight: 44)
            }
            .padding(.horizontal, 24)
            .padding(.top, 10)
            .background(Theme.cloud)
        }
    }

    private func row(_ icon: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon).foregroundStyle(Theme.electric).frame(width: 22)
            Text(text).font(.archivo(14.5)).foregroundStyle(Theme.ink)
        }
    }
}

/// You › AI features: the switch behind the consent.
struct AIFeaturesPage: View {
    @State private var on = AIConsent.granted
    var body: some View {
        Page(title: "AI features", subtitle: "Ask Boplo, the mock checkride and question explanations use an AI service run by Anthropic (and Google as a backup).") {
            Tile {
                Toggle(isOn: $on) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Allow AI features").font(.archivo(16, .semibold))
                        Text("Sends your question, the chat so far and a summary of your desk. Never your email address or GPS tracks.").font(.archivo(13)).foregroundStyle(Theme.ink3)
                    }
                }
                .tint(Theme.electric)
                .onChange(of: on) { _, v in AIConsent.granted = v }
            }
            Footnote(text: "Switching this off stops anything new being sent. Chats already on this phone stay here until you clear them.")
        }
    }
}
