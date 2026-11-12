import SwiftUI
import StoreKit

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
    @AppStorage("boplo.introSeen") private var introSeen = false

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
                if introSeen { SignInView() } else { IntroPagesView { withAnimation(.easeInOut(duration: 0.35)) { introSeen = true } } }
            case .setup:
                OnboardingFlow()
            case .ready:
                // The iPhone app needs Advanced: a free trial or a subscription. Owners, school members and web subscribers are already Advanced.
                if model.billing != nil && !model.isAdvanced { TrialGateView() } else { MainTabs() }
            }
        }
        .animation(.easeInOut(duration: 0.25), value: model.phase)
        .animation(.easeInOut(duration: 0.35), value: model.isAdvanced)
    }
}

struct LaunchView: View {
    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(hex: 0x0B1E4E), Theme.night], center: .top, startRadius: 0, endRadius: 600).ignoresSafeArea()
            Contours(seed: 0.7).opacity(0.35).ignoresSafeArea()
            VStack(spacing: 26) {
                BoploWordmark(height: 40)
                RouteArc()
                    .frame(width: 260, height: 60)
                Text("Opening your flight desk").font(.archivo(14.5)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.7))
            }
        }
    }
}

/// A dashed route with a glowing trail running along it, for loading moments.
struct RouteArc: View {
    @State private var t: CGFloat = 0
    var body: some View {
        GeometryReader { g in
            let path = Path { p in
                p.move(to: CGPoint(x: 4, y: g.size.height - 4))
                p.addQuadCurve(to: CGPoint(x: g.size.width - 4, y: g.size.height - 4), control: CGPoint(x: g.size.width / 2, y: -g.size.height * 0.9))
            }
            ZStack {
                path.stroke(Theme.ice.opacity(0.25), style: StrokeStyle(lineWidth: 2, dash: [4, 7]))
                path.trim(from: max(0, t - 0.35), to: t)
                    .stroke(Theme.electricHi, style: StrokeStyle(lineWidth: 2.5, lineCap: .round))
                    .shadow(color: Theme.electricHi.opacity(0.9), radius: 6)
                Circle().fill(Theme.ice).frame(width: 7, height: 7).position(x: 4, y: g.size.height - 4)
                Circle().fill(Theme.ice).frame(width: 7, height: 7).position(x: g.size.width - 4, y: g.size.height - 4)
            }
        }
        .onAppear {
            guard !UIAccessibility.isReduceMotionEnabled else { t = 1; return }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: false)) { t = 1.35 }
        }
        .accessibilityHidden(true)
    }
}

struct MainTabs: View {
    @Environment(AppModel.self) private var model
    @Environment(\.requestReview) private var requestReview
    @State private var celebrating: Milestone?

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
        .fullScreenCover(item: $celebrating) { MilestoneMoment(milestone: $0) }
        .task(id: model.flights.count) { await checkMilestones() }
        .task { await ReviewAsk.maybe(requestReview) }
    }
}

extension MainTabs {
    /// Celebrates a milestone the first time the app sees it. On the very first run everything you'd
    /// already reached is marked as seen, so nobody gets a backlog of celebrations.
    func checkMilestones() async {
        let all = Milestone.all(model)
        let d = UserDefaults.standard
        var seen = Set(d.stringArray(forKey: "boplo.seenMilestones") ?? [])
        defer { d.set(Array(seen), forKey: "boplo.seenMilestones") }
        guard d.bool(forKey: "boplo.milestonesPrimed") else {
            seen.formUnion(all.map(\.key))
            d.set(true, forKey: "boplo.milestonesPrimed")
            return
        }
        let fresh = all.filter { !seen.contains($0.key) }
        guard let newest = fresh.first else { return }
        seen.formUnion(fresh.map(\.key))
        try? await Task.sleep(for: .seconds(0.9))
        celebrating = newest
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
