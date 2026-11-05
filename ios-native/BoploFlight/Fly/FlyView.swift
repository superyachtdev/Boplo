import SwiftUI
import MapKit

/// Record a flight with GPS, or open the 3D simulator.
struct FlyView: View {
    @State private var recorder = FlightRecorder()
    @State private var saving = false
    @State private var showSim = false
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    recorderCard
                    simCard
                }
                .padding(16)
            }
            .background(Theme.cloud.ignoresSafeArea())
            .navigationTitle("Fly")
            .sheet(isPresented: $saving, onDismiss: { recorder.reset() }) {
                FlightFormView(track: recorder.points, recordedMinutes: recorder.elapsedMinutes)
            }
            .fullScreenCover(isPresented: $showSim) { SimulatorView() }
        }
    }

    private var recorderCard: some View {
        Card {
            HStack {
                Text("Record a flight").font(.headline)
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
            .frame(height: 240)
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
                    .font(.subheadline).foregroundStyle(.secondary)
            }

            ErrorText(text: recorder.message)

            if recorder.isRecording {
                Button(role: .destructive) {
                    recorder.stop()
                    saving = true
                } label: {
                    Label("Stop and save", systemImage: "stop.fill").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
            } else {
                Button {
                    recorder.start()
                } label: {
                    Label("Start recording", systemImage: "record.circle").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
            }
            Text("GPS altitude is approximate. Use your instruments, not your phone, to fly.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private var simCard: some View {
        Button { showSim = true } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text("Simulator").font(.caption.weight(.semibold)).foregroundStyle(Theme.ice)
                Text("Fly the approach before you fly it.")
                    .font(Theme.display(24)).foregroundStyle(.white).multilineTextAlignment(.leading)
                Text("Short finals and circuits over real 3D scenery.")
                    .font(.subheadline).foregroundStyle(Theme.mist)
                HStack {
                    Spacer()
                    Label("Open simulator", systemImage: "arrow.right")
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.white, in: Capsule())
                        .foregroundStyle(Theme.ink)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(LinearGradient(colors: [Theme.deep, Theme.night], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func readout(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.bold()).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
