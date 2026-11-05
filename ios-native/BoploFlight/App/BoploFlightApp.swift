import SwiftUI

@main
struct BoploFlightApp: App {
    @State private var model = AppModel()
    @State private var store = StoreModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .environment(store)
                .tint(Theme.electric)
                .task {
                    await model.start()
                    await store.start(model: model)
                }
        }
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
            Theme.night.ignoresSafeArea()
            VStack(spacing: 16) {
                BoploWordmark(color: .white)
                ProgressView().tint(.white)
            }
        }
    }
}

struct MainTabs: View {
    var body: some View {
        TabView {
            DeskView()
                .tabItem { Label("Desk", systemImage: "square.grid.2x2") }
            LogbookView()
                .tabItem { Label("Logbook", systemImage: "book.closed") }
            FlyView()
                .tabItem { Label("Fly", systemImage: "airplane") }
            YouView()
                .tabItem { Label("You", systemImage: "person.crop.circle") }
        }
    }
}
