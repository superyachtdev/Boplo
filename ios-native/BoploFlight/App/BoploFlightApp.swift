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

    var body: some View {
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
