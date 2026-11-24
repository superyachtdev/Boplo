import SwiftUI

/// The 3D simulator stays on the web (photo-real Google scenery), shown full screen inside the app.
struct SimulatorView: View {
    /// Defaults to the simulator page; a practice URL opens straight into an approach (leaderboard challenge).
    var url: URL = WebFeature.sim.url
    /// A sortie's approach reports how it went (JSON from the web simulator) before handing back.
    var onResult: ((SortieFlight) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var loading = true
    @State private var failed = false
    @State private var token = 0
    /// True while a flight is running: the simulator draws its own close button then.
    @State private var flying = false

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Theme.night.ignoresSafeArea()
            BoploWebView(url: url, reloadToken: token, loading: $loading, failed: $failed) { message in
                switch message["type"] as? String {
                case "upgrade":
                    dismiss()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { model.upgrade(message["message"] as? String) }
                case "close": dismiss()
                case "simResult":
                    if let json = message["result"] as? String, let data = json.data(using: .utf8), let r = try? JSONDecoder().decode(SortieFlight.self, from: data) { onResult?(r) }
                case "sim": withAnimation(.easeInOut(duration: 0.2)) { flying = (message["active"] as? Bool) ?? false }
                case "shareVideo":
                    // a landing clip recorded in the replay: save it and open the share sheet
                    if let b64 = message["data"] as? String, let data = Data(base64Encoded: b64) {
                        let ext = (message["ext"] as? String) == "webm" ? "webm" : "mp4"
                        let url = FileManager.default.temporaryDirectory.appendingPathComponent("boplo-landing.\(ext)")
                        try? data.write(to: url, options: .atomic)
                        Task { @MainActor in ShareSheet.present([url]) }
                    }
                default: break
                }
            }
            .ignoresSafeArea()
            if loading || failed {
                ZStack {
                    LinearGradient(colors: [Theme.navy, Theme.night], startPoint: .top, endPoint: .bottom).ignoresSafeArea()
                    Contours(seed: 1.3).opacity(0.5).ignoresSafeArea()
                    VStack(spacing: 14) {
                        if failed {
                            Text("The simulator didn’t load.").font(.archivo(17, .semibold)).foregroundStyle(.white)
                            Button("Try again") { failed = false; loading = true; token += 1 }.buttonStyle(.pill(.light, height: 44))
                        } else {
                            ProgressView().tint(.white)
                            Text("Loading the simulator…").font(.archivo(14.5)).foregroundStyle(Theme.mist)
                        }
                    }
                }
            }
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .padding(.trailing, 16)
            .padding(.top, 6)
            .accessibilityLabel("Close simulator")
            .opacity(flying ? 0 : 1)
            .allowsHitTesting(!flying)
        }
        // The simulator is landscape only; the rest of the app stays portrait.
        .onAppear { Orientation.allow(.landscape) }
        .onDisappear { Orientation.allow(.portrait); Task { await model.refresh() } }
    }
}


/// Presents the system share sheet over whatever is on screen (used from inside the full-screen simulator).
enum ShareSheet {
    @MainActor
    static func present(_ items: [Any]) {
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first(where: { $0.activationState == .foregroundActive }),
              var top = scene.windows.first(where: \.isKeyWindow)?.rootViewController else { return }
        while let next = top.presentedViewController { top = next }
        let vc = UIActivityViewController(activityItems: items, applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = top.view
        vc.popoverPresentationController?.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 1, height: 1)
        top.present(vc, animated: true)
    }
}
