import SwiftUI

/// The 3D simulator stays on the web (photo-real Google scenery), shown full screen inside the app.
struct SimulatorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(AppModel.self) private var model
    @State private var loading = true
    @State private var failed = false
    @State private var token = 0

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Theme.night.ignoresSafeArea()
            BoploWebView(url: WebFeature.sim.url, reloadToken: token, loading: $loading, failed: $failed) { message in
                switch message["type"] as? String {
                case "upgrade":
                    dismiss()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { model.upgrade(message["message"] as? String) }
                case "close": dismiss()
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
        }
        .onDisappear { Task { await model.refresh() } }
    }
}
