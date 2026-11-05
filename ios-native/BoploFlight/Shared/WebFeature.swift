import SwiftUI
import WebKit

/// Tools that open the web app's own page inside the app (boplo.app/flight-app.html?embed=1#page).
/// In embed mode the web page drops its menus and tab bar, and hands purchases, new flights and
/// sign-in back to the app through the "boplo" message handler.
enum WebFeature: String, Identifiable, Hashable, CaseIterable {
    case progress, budget, radio, currency, navlog, preflight, weather, community, leaderboards, school, sim, checkride, map, analytics

    var id: String { rawValue }

    var title: String {
        switch self {
        case .progress: return "Progress"
        case .budget: return "Budget"
        case .radio: return "Radio practice"
        case .currency: return "Currency"
        case .navlog: return "Nav log"
        case .preflight: return "Preflight"
        case .weather: return "Weather"
        case .community: return "Q&A"
        case .leaderboards: return "Leaderboards"
        case .school: return "Flight school"
        case .sim: return "Simulator"
        case .checkride: return "Mock checkride"
        case .map: return "Map"
        case .analytics: return "Analytics"
        }
    }

    var subtitle: String {
        switch self {
        case .progress: return "Syllabus, milestones and your licence checklist"
        case .budget: return "What your licence will cost, and your runway"
        case .radio: return "Speak your calls and get each element checked"
        case .currency: return "Medical, rating and recency, from your logbook"
        case .navlog: return "Plan legs with headings, times and fuel"
        case .preflight: return "Weather, NOTAMs and a briefing for your route"
        case .weather: return "Decode METARs and TAFs for any airfield"
        case .community: return "Questions and answers from other student pilots"
        case .leaderboards: return "Simulator landing scores"
        case .school: return "Join your school with its code, or set one up"
        case .sim: return "Short finals and circuits over real 3D scenery"
        case .checkride: return "An AI examiner runs a practice oral exam"
        case .map: return "Every track you’ve logged"
        case .analytics: return "Hours, roles and trends"
        }
    }

    var icon: String {
        switch self {
        case .progress: return "checklist"
        case .budget: return "sterlingsign.circle"
        case .radio: return "headphones"
        case .currency: return "calendar.badge.clock"
        case .navlog: return "point.topleft.down.to.point.bottomright.curvepath"
        case .preflight: return "doc.text.magnifyingglass"
        case .weather: return "cloud.sun"
        case .community: return "bubble.left.and.bubble.right"
        case .leaderboards: return "trophy"
        case .school: return "graduationcap"
        case .sim: return "airplane"
        case .checkride: return "person.wave.2"
        case .map: return "map"
        case .analytics: return "chart.bar.xaxis"
        }
    }

    var url: URL {
        let page = self == .checkride ? "ask" : rawValue
        return URL(string: "https://boplo.app/flight-app.html?embed=1#\(page)")!
    }
}

/// A web feature pushed onto a navigation stack, with the native title bar.
struct WebFeatureView: View {
    let feature: WebFeature
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var title: String?
    @State private var loading = true
    @State private var failed = false
    @State private var reloadToken = 0

    var body: some View {
        ZStack {
            Theme.cloud.ignoresSafeArea()
            BoploWebView(url: feature.url, prelude: feature == .checkride ? "try{localStorage.setItem('boplo-ask-mode','exam')}catch(e){}" : nil,
                         reloadToken: reloadToken, loading: $loading, failed: $failed) { message in
                handle(message)
            }
            .ignoresSafeArea(edges: .bottom)
            if loading && !failed {
                ProgressView().controlSize(.large).tint(Theme.electric)
            }
            if failed {
                VStack(spacing: 12) {
                    Text("This page didn’t load.").font(.archivo(17, .semibold))
                    Text("Check your connection and try again.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                    Button("Try again") { failed = false; loading = true; reloadToken += 1 }
                        .buttonStyle(.pill(.line, height: 42))
                }
                .padding(24)
            }
        }
        .navigationTitle(title ?? feature.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Theme.cloud, for: .navigationBar)
        .onDisappear { Task { await model.refresh() } }
    }

    private func handle(_ message: [String: Any]) {
        switch message["type"] as? String {
        case "page":
            if let t = message["title"] as? String, !t.isEmpty { title = t }
        case "upgrade":
            model.upgrade(message["message"] as? String)
        case "logFlight":
            model.logFlight()
        case "record":
            model.tab = .fly
            dismiss()
        case "flight":
            if let id = message["id"] as? String, let f = model.flights.first(where: { $0.id == id }) { model.openedFlight = f }
        case "close":
            dismiss()
        case "signedOut":
            Task { await model.refresh() }
        default:
            break
        }
    }
}

/// WKWebView that opens signed in (the app's session cookie is copied in first) and posts bridge messages back.
struct BoploWebView: UIViewRepresentable {
    let url: URL
    var prelude: String? = nil
    var reloadToken: Int = 0
    @Binding var loading: Bool
    @Binding var failed: Bool
    var onMessage: ([String: Any]) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "BoploFlightNative"
        let controller = WKUserContentController()
        controller.add(WeakHandler(context.coordinator), name: "boplo")
        if let prelude {
            controller.addUserScript(WKUserScript(source: prelude, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        config.userContentController = controller

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = UIColor(Theme.cloud)
        view.scrollView.backgroundColor = UIColor(Theme.cloud)
        view.allowsBackForwardNavigationGestures = false
        context.coordinator.lastToken = reloadToken
        Self.load(url, into: view)
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {
        context.coordinator.parent = self
        if context.coordinator.lastToken != reloadToken {
            context.coordinator.lastToken = reloadToken
            Self.load(url, into: view)
        }
    }

    static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
        view.configuration.userContentController.removeScriptMessageHandler(forName: "boplo")
    }

    /// Copies the app's cookies for boplo.app into the web view, then loads.
    static func load(_ url: URL, into view: WKWebView) {
        let store = view.configuration.websiteDataStore.httpCookieStore
        let cookies = HTTPCookieStorage.shared.cookies(for: API.origin) ?? []
        let group = DispatchGroup()
        for cookie in cookies {
            group.enter()
            store.setCookie(cookie) { group.leave() }
        }
        group.notify(queue: .main) { view.load(URLRequest(url: url)) }
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: BoploWebView
        var lastToken = 0
        init(_ parent: BoploWebView) { self.parent = parent }

        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else { return }
            parent.onMessage(body)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.parent.loading = false }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }

        private func fail(_ error: Error) {
            if (error as NSError).code == NSURLErrorCancelled { return }
            parent.loading = false
            parent.failed = true
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url else { return decisionHandler(.allow) }
            let scheme = url.scheme ?? ""
            if ["mailto", "tel", "sms"].contains(scheme) {
                UIApplication.shared.open(url); return decisionHandler(.cancel)
            }
            // Stay on boplo.app; links out open in Safari.
            if let host = url.host, !host.hasSuffix("boplo.app"), action.navigationType == .linkActivated {
                UIApplication.shared.open(url); return decisionHandler(.cancel)
            }
            decisionHandler(.allow)
        }

        // target="_blank" links
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let url = action.request.url { UIApplication.shared.open(url) }
            return nil
        }
    }

    /// Avoids WKUserContentController keeping the coordinator alive.
    final class WeakHandler: NSObject, WKScriptMessageHandler {
        weak var target: WKScriptMessageHandler?
        init(_ target: WKScriptMessageHandler) { self.target = target }
        func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
            target?.userContentController(controller, didReceive: message)
        }
    }
}
