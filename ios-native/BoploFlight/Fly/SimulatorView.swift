import SwiftUI
import WebKit

/// The 3D simulator stays on the web (photo-real Google scenery), shown full screen inside the app.
/// The app's session cookie is copied into the web view first, so it opens signed in.
struct SimulatorView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var loading = true

    var body: some View {
        ZStack(alignment: .topLeading) {
            SimulatorWebView(loading: $loading)
                .ignoresSafeArea()
            if loading {
                ZStack {
                    Theme.night.ignoresSafeArea()
                    VStack(spacing: 12) {
                        ProgressView().tint(.white)
                        Text("Loading the simulator…").foregroundStyle(Theme.mist).font(.subheadline)
                    }
                }
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .padding(.leading, 16)
            .padding(.top, 8)
            .accessibilityLabel("Close simulator")
        }
        .statusBarHidden()
    }
}

struct SimulatorWebView: UIViewRepresentable {
    @Binding var loading: Bool

    func makeCoordinator() -> Coordinator { Coordinator(loading: $loading) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "BoploFlightNative"
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor(Theme.night)
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.scrollView.bounces = false

        let url = URL(string: "https://boplo.app/flight-app.html#sim")!
        let store = view.configuration.websiteDataStore.httpCookieStore
        let cookies = HTTPCookieStorage.shared.cookies(for: API.origin) ?? []
        let group = DispatchGroup()
        for cookie in cookies {
            group.enter()
            store.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { view.load(URLRequest(url: url)) }
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate {
        var loading: Binding<Bool>
        init(loading: Binding<Bool>) { self.loading = loading }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.loading.wrappedValue = false }
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            // Stay on boplo.app; anything else (links out) opens in Safari.
            if let url = action.request.url, let host = url.host, !host.hasSuffix("boplo.app"), action.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }
    }
}
