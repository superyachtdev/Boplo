import SwiftUI

/// Screens any tab can push.
enum Route: Hashable {
    case prepare
    case profile
    case ask
    case plan
    case flight(Flight)
    case web(WebFeature)
    case trackMap
    case analytics
    case appIcon
    case aiFeatures
    case liveTraffic
}

extension View {
    /// Registers every pushable screen on a NavigationStack.
    func boploDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            switch route {
            case .prepare: PrepareView()
            case .profile: ProfileView()
            case .ask: AskView()
            case .plan: PlanView()
            case .flight(let f): FlightDetailView(flight: f)
            case .web(let feature): ToolScreen(feature: feature)
            case .trackMap: TrackMapView()
            case .analytics: AnalyticsView()
            case .appIcon: AppIconPage()
            case .aiFeatures: AIFeaturesPage()
            case .liveTraffic: LiveTrafficPage()
            }
        }
    }

    /// The "+" in the navigation bar that logs a flight, on every tab like the web app.
    func logFlightButton(_ model: AppModel) -> some View {
        toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { model.logFlight() } label: {
                    Image(systemName: "plus").font(.system(size: 17, weight: .semibold))
                }
                .accessibilityLabel("Log a flight")
            }
        }
    }
}

/// Every training and planning tool is native; only the 3D simulator stays on the web.
struct ToolScreen: View {
    let feature: WebFeature
    var body: some View {
        switch feature {
        case .progress: TrainingProgressPage()
        case .currency: CurrencyPage()
        case .budget: BudgetPage()
        case .radio: RadioPage()
        case .weather: WeatherPage()
        case .navlog: NavLogPage()
        case .preflight: PreflightPage()
        case .community: CommunityPage()
        case .leaderboards: LeaderboardsPage()
        case .school: SchoolPage()
        case .checkride: CheckrideView()
        case .map: TrackMapView()
        case .analytics: AnalyticsView()
        case .sim: WebFeatureView(feature: .sim)
        }
    }
}

/// A flight as a white card: route, date · role · landings, lesson, time.
struct FlightCard: View {
    let flight: Flight
    var body: some View { FlightStrip(flight: flight) }
}

/// The role chip colours from the web logbook.
struct RolePill: View {
    let role: String?
    var body: some View {
        let (label, color): (String, Color) = {
            switch role {
            case "solo": return ("Solo", Color(hex: 0x1B7FB8))
            case "pic": return ("PIC", Theme.pic)
            default: return ("Dual", Theme.electric)
            }
        }()
        Text(label)
            .font(.archivo(12, .semibold))
            .padding(.horizontal, 9)
            .frame(height: 22)
            .foregroundStyle(color)
            .background(color.opacity(0.1), in: Capsule())
    }
}
