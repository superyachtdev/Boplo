import SwiftUI

@main
struct BoploFlightApp: App {
    @State private var model = AppModel()
    @State private var store = StoreModel()

    init() {
        BoploFonts.register()
        Appearance.apply()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(store)
                .tint(Theme.electric)
                // The desk is designed light, like the web app.
                .preferredColorScheme(.light)
                .task {
                    await model.start()
                    await store.start(model: model)
                }
        }
    }
}

/// UIKit chrome in the web app's type and colours.
enum Appearance {
    /// Only the title fonts are set. Bar backgrounds stay the system's (Liquid Glass on iOS 26, with its
    /// scroll edge effect), so the bars keep adapting to the content behind them.
    static func apply() {
        let ink = UIColor(Theme.ink)
        let bar = UINavigationBar.appearance()
        if let f = UIFont(name: "Archivo-SemiBold", size: 17) { bar.titleTextAttributes = [.font: f, .foregroundColor: ink] }
        if let f = UIFont(name: "ArchivoDisplay-Italic", size: 36) { bar.largeTitleTextAttributes = [.font: f, .foregroundColor: ink, .kern: -1.0] }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    /// Every cold launch plays the take-off too.
    @State private var coldLaunch = true
    /// The take-off has reached white-out, so the app can mount underneath.
    @State private var aboveCloud = false

    private var playing: Bool { coldLaunch || model.takeoff }

    var body: some View {
        ZStack {
            if !playing || aboveCloud {
                content
            } else {
                // Matches the launch screen, so the first frame never flashes.
                Theme.night.ignoresSafeArea()
            }
            if playing {
                TakeoffSequence(name: model.profile?.firstName ?? "",
                                firstTime: model.takeoffFirstTime && !coldLaunch,
                                signedOut: model.phase == .signedOut,
                                hold: coldLaunch && model.phase == .loading,
                                onCovered: { aboveCloud = true },
                                onFinish: { coldLaunch = false; model.takeoff = false; aboveCloud = false })
                    .transition(.opacity)
                    .zIndex(2)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        Group {
            switch model.phase {
            case .loading:
                LaunchView()
            case .signedOut:
                SignInView()
            case .setup:
                SetupView()
            case .ready:
                MainTabs()
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.phase)
    }
}

struct LaunchView: View {
    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(hex: 0x0B1E4E), Theme.night], center: .top, startRadius: 0, endRadius: 600).ignoresSafeArea()
            VStack(spacing: 18) {
                BoploWordmark(height: 40)
                ProgressView().tint(.white)
            }
        }
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        TabView(selection: $model.tab) {
            DeskView()
                .tabItem { Label("Desk", systemImage: "square.grid.2x2") }
                .tag(AppModel.Tab.desk)
            LogbookView()
                .tabItem { Label("Logbook", systemImage: "book.closed") }
                .tag(AppModel.Tab.logbook)
            StudyView()
                .tabItem { Label("Study", systemImage: "graduationcap") }
                .tag(AppModel.Tab.study)
            FlyView()
                .tabItem { Label("Fly", systemImage: "airplane") }
                .tag(AppModel.Tab.fly)
            YouView()
                .tabItem { Label("You", systemImage: "person") }
                .tag(AppModel.Tab.you)
        }
        .minimizingTabBar()
        .sensoryFeedback(.selection, trigger: model.tab)
        .overlay(alignment: .top) {
            if let toast = model.toast {
                ToastView(toast: toast)
                    .padding(.top, 6)
                    .transition(.move(edge: .top).combined(with: .opacity))
                    .onTapGesture { model.toast = nil }
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.82), value: model.toast)
        .sheet(isPresented: $model.showNewFlight) {
            FlightFormView()
        }
        .sheet(isPresented: $model.showPaywall) {
            PlansView(message: model.paywallMessage)
        }
        .sheet(item: $model.openedFlight) { flight in
            NavigationStack { FlightDetailView(flight: flight) }
        }
    }
}

/// The confirmation that floats in under the status bar. It is transient chrome, so it is glass.
struct ToastView: View {
    let toast: AppModel.Toast
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: toast.symbol)
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(Theme.ok)
                .symbolEffect(.bounce, value: toast.id)
            VStack(alignment: .leading, spacing: 1) {
                Text(toast.title).font(.archivo(15, .semibold)).foregroundStyle(Theme.ink)
                if let d = toast.detail { Text(d).font(.archivo(13)).foregroundStyle(Theme.ink3).monospacedDigit() }
            }
        }
        .padding(.leading, 14).padding(.trailing, 20).padding(.vertical, 10)
        .glassSurface(Capsule())
        .shadow(color: Theme.ink.opacity(0.08), radius: 16, y: 8)
        .accessibilityElement(children: .combine)
    }
}
