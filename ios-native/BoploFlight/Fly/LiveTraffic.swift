import SwiftUI
import MapKit

// Live traffic from ADS-B (FlyItalyADSB, through boplo.app so the key stays on the server).
// The map asks for the area it's showing; positions are refreshed every 15 s and moved along
// their track every second in between, so planes glide instead of jumping.

struct TrafficPlane: Identifiable, Hashable {
    let id: String
    let callsign: String
    let registration: String
    let type: String
    var lat: Double
    var lng: Double
    let altitude: Int?
    let ground: Bool
    let speed: Int?
    let track: Int?
    let verticalSpeed: Int?
    let military: Bool

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
    var title: String { callsign.isEmpty ? (registration.isEmpty ? id.uppercased() : registration) : callsign }

    var altitudeText: String {
        if ground { return "On ground" }
        guard let a = altitude else { return "—" }
        return a >= 18000 ? "FL\(a / 100)" : "\(a.formatted()) ft"
    }

    /// Altitude bands, like a traffic display: ground, circuit height, low, mid, high.
    var color: Color {
        if ground { return Color(hex: 0xA9B4CC) }
        let a = altitude ?? 0
        switch a {
        case ..<2500: return Color(hex: 0x5CF2A0)
        case ..<10000: return Color(hex: 0xFFD24A)
        case ..<25000: return Color(hex: 0xFF9248)
        default: return Color(hex: 0xE58BFF)
        }
    }

    init?(_ d: [String: Any]) {
        guard let id = d["id"] as? String, let lat = (d["lat"] as? NSNumber)?.doubleValue, let lng = (d["lng"] as? NSNumber)?.doubleValue else { return nil }
        self.id = id
        callsign = d["cs"] as? String ?? ""
        registration = d["reg"] as? String ?? ""
        type = d["type"] as? String ?? ""
        self.lat = lat; self.lng = lng
        altitude = (d["alt"] as? NSNumber)?.intValue
        ground = d["ground"] as? Bool ?? false
        speed = (d["gs"] as? NSNumber)?.intValue
        track = (d["trk"] as? NSNumber)?.intValue
        verticalSpeed = (d["vs"] as? NSNumber)?.intValue
        military = d["mil"] as? Bool ?? false
    }
}

@MainActor
@Observable
final class LiveTraffic {
    private(set) var isOn = false
    var on: Bool {
        get { isOn }
        set {
            guard newValue != isOn else { return }
            isOn = newValue
            if remember { UserDefaults.standard.set(newValue, forKey: Self.key) }
            if newValue { start() } else { stop() }
        }
    }
    private(set) var planes: [TrafficPlane] = []
    private(set) var message: String?
    private(set) var loading = false
    var selected: TrafficPlane.ID?

    private static let key = "boplo.liveTraffic"
    private var raw: [TrafficPlane] = []
    private var fetchedAt = Date()
    private var center: CLLocationCoordinate2D?
    private var km: Double = 80
    private var fetchedCenter: CLLocationCoordinate2D?
    private var fetchedKm: Double = 0
    private var loop: Task<Void, Never>?

    private let remember: Bool

    init(remember: Bool = true) {
        self.remember = remember
        if remember { isOn = UserDefaults.standard.bool(forKey: Self.key) }
    }

    var selectedPlane: TrafficPlane? { planes.first { $0.id == selected } }

    /// Call when the visible map area settles.
    func show(_ region: MKCoordinateRegion) {
        let c = region.center
        let r = max(region.span.latitudeDelta, region.span.longitudeDelta * cos(c.latitude * .pi / 180)) * 111 / 2 * 1.15
        center = c
        km = min(500, max(15, r))
        // Moved well outside what we last fetched, or zoomed out past it: fetch now.
        if on, let f = fetchedCenter {
            let moved = CLLocation(latitude: c.latitude, longitude: c.longitude).distance(from: CLLocation(latitude: f.latitude, longitude: f.longitude)) / 1000
            if moved > fetchedKm * 0.4 || km > fetchedKm * 1.3 { restart() }
        } else if on, loop == nil { start() }
    }

    func start() {
        guard loop == nil, center != nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.fetch()
                for _ in 0..<15 {
                    try? await Task.sleep(for: .seconds(1))
                    if Task.isCancelled { return }
                    self?.advance()
                }
            }
        }
    }

    func stop() {
        loop?.cancel(); loop = nil
        planes = []; raw = []; selected = nil; message = nil
        fetchedCenter = nil
    }

    private func restart() { loop?.cancel(); loop = nil; start() }

    private func fetch() async {
        guard let c = center else { return }
        loading = true
        defer { loading = false }
        let path = String(format: "flight/traffic?lat=%.4f&lng=%.4f&km=%.0f", c.latitude, c.longitude, km)
        do {
            let obj = try await API.shared.object(path)
            let list = (obj["aircraft"] as? [[String: Any]] ?? []).compactMap(TrafficPlane.init)
            // keep the nearest 300 so a busy hub stays smooth
            let here = CLLocation(latitude: c.latitude, longitude: c.longitude)
            raw = list.count > 300 ? Array(list.sorted { here.distance(from: CLLocation(latitude: $0.lat, longitude: $0.lng)) < here.distance(from: CLLocation(latitude: $1.lat, longitude: $1.lng)) }.prefix(300)) : list
            fetchedAt = Date()
            fetchedCenter = c
            fetchedKm = km
            message = raw.isEmpty ? "No traffic reporting here right now." : nil
            withAnimation(.linear(duration: 0.9)) { planes = raw }
        } catch {
            message = error.localizedDescription
        }
    }

    /// Dead reckoning: move each airborne plane along its track at its ground speed.
    private func advance() {
        let dt = min(30, Date().timeIntervalSince(fetchedAt))
        let moved = raw.map { p -> TrafficPlane in
            guard !p.ground, let gs = p.speed, let trk = p.track, gs > 30 else { return p }
            var q = p
            let nm = Double(gs) * dt / 3600
            let a = Double(trk) * .pi / 180
            q.lat += nm * cos(a) / 60
            q.lng += nm * sin(a) / (60 * max(0.2, cos(p.lat * .pi / 180)))
            return q
        }
        withAnimation(.linear(duration: 1)) { planes = moved }
    }
}

// MARK: - Drawing

/// A plane on the map: an airplane glyph pointed along its track, coloured by altitude band.
struct PlaneMarker: View {
    let plane: TrafficPlane
    var selected = false
    var body: some View {
        Image(systemName: "airplane")
            .font(.system(size: selected ? 22 : 15, weight: .bold))
            .foregroundStyle(plane.color)
            .shadow(color: .black.opacity(0.85), radius: 1.5)
            .shadow(color: .black.opacity(0.4), radius: 4)
            // the SF airplane points east; tracks are measured from north
            .rotationEffect(.degrees(Double(plane.track ?? 90) - 90))
            .padding(6)
            .background {
                if selected { Circle().strokeBorder(.white, lineWidth: 2).frame(width: 40, height: 40) }
            }
            .contentShape(Circle())
            .accessibilityLabel("\(plane.title), \(plane.altitudeText)")
    }
}

/// The glass button that turns live traffic on and off over any map.
struct TrafficToggle: View {
    @Bindable var traffic: LiveTraffic
    var body: some View {
        Button {
            Haptic.tap(.light, 0.6)
            traffic.on.toggle()
        } label: {
            HStack(spacing: 6) {
                if traffic.loading && traffic.on {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: traffic.on ? "airplane.circle.fill" : "airplane.circle")
                }
                Text(traffic.on ? "\(traffic.planes.count) live" : "Traffic").monospacedDigit()
            }
            .font(.archivo(13.5, .semibold))
            .foregroundStyle(traffic.on ? Theme.electric : Theme.ink)
            .padding(.horizontal, 12).frame(height: 36)
        }
        .buttonStyle(.plain)
        .glassSurface(Capsule(), interactive: true)
        .accessibilityLabel(traffic.on ? "Hide live traffic" : "Show live traffic")
    }
}

/// The selected plane's details, floating over the bottom of the map.
struct PlaneCard: View {
    let plane: TrafficPlane
    var from: CLLocationCoordinate2D?
    var fromLabel = "home"
    var close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(plane.title).font(.system(size: 22, weight: .bold, design: .monospaced)).foregroundStyle(Theme.ink)
                    Text([plane.type, plane.registration == plane.title ? "" : plane.registration, plane.military ? "Military" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                }
                Spacer()
                Button(action: close) { Image(systemName: "xmark").font(.system(size: 13, weight: .bold)) }
                    .floatingIcon()
                    .accessibilityLabel("Close")
            }
            HStack(spacing: 0) {
                stat(plane.altitudeText, "Altitude", trend: plane.verticalSpeed)
                stat(plane.speed.map { "\($0) kt" } ?? "—", "Ground speed")
                stat(plane.track.map { String(format: "%03d°", $0) } ?? "—", "Track")
                if let from {
                    let nm = CLLocation(latitude: from.latitude, longitude: from.longitude).distance(from: CLLocation(latitude: plane.lat, longitude: plane.lng)) / 1852
                    stat(String(format: nm < 10 ? "%.1f NM" : "%.0f NM", nm), "From \(fromLabel)")
                }
            }
        }
        .padding(16)
        .glassSurface(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func stat(_ value: String, _ label: String, trend: Int? = nil) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 3) {
                Text(value).font(.archivo(16, .semibold)).monospacedDigit().foregroundStyle(Theme.ink).lineLimit(1).minimumScaleFactor(0.7)
                if let v = trend, abs(v) >= 300 {
                    Image(systemName: v > 0 ? "arrow.up.right" : "arrow.down.right").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink3)
                }
            }
            Text(label).font(.archivo(11.5)).foregroundStyle(Theme.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The line every traffic map carries: the data licence, and that it's not for flying.
struct TrafficCredit: View {
    var body: some View {
        Text("Traffic: FlyItalyADSB (CC BY-SA 4.0). Not all aircraft are shown. Not for navigation or collision avoidance.")
            .font(.archivo(10.5))
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.8), radius: 2)
            .padding(.horizontal, 10)
            .multilineTextAlignment(.leading)
    }
}

// MARK: - Full map

/// Live traffic, full screen: opens on your home airfield, follows the map as you pan.
struct LiveTrafficPage: View {
    @Environment(AppModel.self) private var model
    @State private var traffic = LiveTraffic(remember: false)
    @State private var camera: MapCameraPosition = .automatic
    @State private var home: Airfield?

    var body: some View {
        Map(position: $camera, selection: $traffic.selected) {
            UserAnnotation()
            if let home {
                Annotation(home.code, coordinate: CLLocationCoordinate2D(latitude: home.lat, longitude: home.lng), anchor: .center) {
                    SectionalAirfield(code: "", color: .white).frame(width: 34, height: 34).shadow(color: .black.opacity(0.7), radius: 2)
                }
            }
            ForEach(traffic.planes) { p in
                Annotation(p.title, coordinate: p.coordinate, anchor: .center) {
                    PlaneMarker(plane: p, selected: traffic.selected == p.id)
                }
                .annotationTitles(.hidden)
                .tag(p.id)
            }
        }
        .mapStyle(.hybrid(elevation: .realistic, pointsOfInterest: .excludingAll))
        .mapControls { MapCompass(); MapScaleView() }
        .onMapCameraChange(frequency: .onEnd) { ctx in traffic.show(ctx.region) }
        .ignoresSafeArea(edges: .bottom)
        .overlay(alignment: .top) {
            HStack {
                TrafficToggle(traffic: traffic)
                Spacer()
                Button { recenter() } label: { Image(systemName: "scope").font(.system(size: 15, weight: .semibold)) }
                    .floatingIcon()
                    .accessibilityLabel("Back to \(home?.code ?? "home")")
            }
            .glassGroup(spacing: 12)
            .padding(.horizontal, 16).padding(.top, 8)
        }
        .overlay(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 8) {
                if let p = traffic.selectedPlane {
                    PlaneCard(plane: p, from: home.map { .init(latitude: $0.lat, longitude: $0.lng) }, fromLabel: home?.code ?? "home") { traffic.selected = nil }
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if let m = traffic.message, traffic.on {
                    Text(m).font(.archivo(13.5, .semibold)).foregroundStyle(Theme.ink)
                        .padding(.horizontal, 14).padding(.vertical, 10)
                        .glassSurface(Capsule())
                }
                TrafficCredit()
            }
            .padding(.horizontal, 12)
            .padding(.bottom, 12)
            .animation(.snappy, value: traffic.selected)
        }
        .navigationTitle("Live traffic")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            home = await AirfieldStore.shared.find(model.homeCode, home: model.countryCode)
            recenter()
            traffic.on = true
        }
        .onDisappear { traffic.stop() }
        .sensoryFeedback(.selection, trigger: traffic.selected)
    }

    private func recenter() {
        if let h = home {
            withAnimation { camera = .region(MKCoordinateRegion(center: .init(latitude: h.lat, longitude: h.lng), latitudinalMeters: 90_000, longitudinalMeters: 90_000)) }
        } else {
            camera = .userLocation(fallback: .automatic)
        }
    }
}
