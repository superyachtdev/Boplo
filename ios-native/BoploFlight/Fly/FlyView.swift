import SwiftUI
import MapKit

/// Record a flight with GPS, or open the 3D simulator.
struct FlyView: View {
    @State private var recorder = FlightRecorder()
    @State private var saving = false
    @State private var showSim = false
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            Page(title: "Fly") {
                simCard
                recorderCard
                tools
            }
            .logFlightButton(model)
            .boploDestinations()
            .sheet(isPresented: $saving, onDismiss: { recorder.reset() }) {
                FlightFormView(track: recorder.points, recordedMinutes: recorder.elapsedMinutes)
            }
            .fullScreenCover(isPresented: $showSim) { SimulatorView() }
        }
    }

    private var tools: some View {
        VStack(spacing: 0) {
            ForEach(Array([WebFeature.navlog, .preflight, .weather, .leaderboards].enumerated()), id: \.element) { i, f in
                if i > 0 { Divider().overlay(Theme.hair).padding(.leading, 58) }
                NavigationLink(value: Route.web(f)) { MenuRow(icon: f.icon, title: f.title, subtitle: f.subtitle) }
            }
        }
        .buttonStyle(.plain)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous).strokeBorder(Theme.hair))
    }

    private var recorderCard: some View {
        Tile {
            HStack {
                Text("Record a flight").font(.archivo(17, .semibold))
                Spacer()
                if recorder.isRecording {
                    Label("Recording", systemImage: "record.circle")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.red)
                        .symbolEffect(.pulse)
                }
            }
            Map(position: $camera) {
                UserAnnotation()
                if recorder.points.count >= 2 {
                    MapPolyline(coordinates: recorder.points.map(\.coordinate))
                        .stroke(Theme.electric, lineWidth: 4)
                }
            }
            .mapStyle(.hybrid(elevation: .realistic))
            .mapControlVisibility(.hidden)
            .frame(height: 260)
            .overlay(alignment: .topTrailing) {
                Button { camera = .userLocation(followsHeading: false, fallback: .automatic) } label: {
                    Image(systemName: "location.fill").font(.system(size: 15, weight: .semibold))
                }
                .floatingIcon()
                .accessibilityLabel("Centre on me")
                .padding(10)
            }
            .overlay(alignment: .bottomLeading) {
                if recorder.isRecording {
                    TimelineView(.periodic(from: .now, by: 1)) { _ in
                        HStack(spacing: 8) {
                            Circle().fill(Theme.danger).frame(width: 8, height: 8)
                            Text(hoursText(recorder.elapsedMinutes)).monospacedDigit()
                            Text("·").foregroundStyle(.secondary)
                            Text("\(Int(recorder.speedKnots)) kt").monospacedDigit()
                        }
                        .font(.archivo(14, .semibold))
                        .padding(.horizontal, 14).frame(height: 36)
                        .glassSurface(Capsule())
                    }
                    .padding(10)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))

            if recorder.isRecording || !recorder.points.isEmpty {
                TimelineView(.periodic(from: .now, by: 1)) { _ in
                    HStack {
                        readout("Time", hoursText(recorder.elapsedMinutes))
                        readout("Ground speed", "\(Int(recorder.speedKnots)) kt")
                        readout("GPS alt", "\(Int(recorder.altitudeFeet)) ft")
                    }
                }
            } else {
                Text("Start before you taxi and stop after you shut down. The track keeps recording with the screen locked, then saves to your logbook.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            }

            ErrorText(text: recorder.message)

            if recorder.isRecording {
                Button {
                    recorder.stop()
                    saving = true
                } label: {
                    Label("Stop and save", systemImage: "stop.fill")
                }
                .primaryStyle(tint: Theme.danger)
            } else {
                Button {
                    recorder.start()
                } label: {
                    Label("Start recording", systemImage: "record.circle")
                }
                .primaryStyle()
            }
            Footnote(text: "GPS altitude is approximate. Use your instruments, not your phone, to fly.")
        }
    }

    private var simCard: some View {
        DarkTile(spacing: 10, seed: 1.3) {
            Text("Simulator").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
            Text("Fly the approach before you fly it.")
                .font(Theme.display(32)).tracking(-1).foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            Text("Short finals, circuits and take-offs at any airfield, over real 3D scenery. Free includes two short finals a day.")
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
            Button { showSim = true } label: { Text("Open simulator") }
                .buttonStyle(.pill(.light, height: 48, spark: true))
                .padding(.top, 4)
        }
    }

    private func readout(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.archivo(20, .semibold)).monospacedDigit()
            Text(label).font(.archivo(12)).foregroundStyle(Theme.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
