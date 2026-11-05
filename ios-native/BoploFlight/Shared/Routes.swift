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
            case .web(let feature): WebFeatureView(feature: feature)
            case .trackMap: TrackMapView()
            case .analytics: AnalyticsView()
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

/// A flight as a white card: route, date · role · landings, lesson, time.
struct FlightCard: View {
    let flight: Flight
    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("\(flight.dep.isEmpty ? "—" : flight.dep) → \(flight.arr.isEmpty ? "—" : flight.arr)")
                    .font(.archivo(16, .semibold))
                    .foregroundStyle(Theme.ink)
                Text([Day.short(flight.date), flight.roleLabel, "\(Int(flight.landings ?? 0)) ldg"].joined(separator: " · "))
                    .font(.archivo(13.5))
                    .foregroundStyle(Theme.ink3)
                if let l = flight.lesson ?? flight.aircraft, !l.isEmpty {
                    Text(l).font(.archivo(13.5)).foregroundStyle(Theme.ink3).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text(hoursText(flight.mins))
                .font(.archivo(18, .semibold))
                .monospacedDigit()
                .foregroundStyle(Theme.ink)
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
        .contentShape(Rectangle())
    }
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
