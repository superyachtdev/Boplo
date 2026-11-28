import SwiftUI
import MapKit

/// Record a flight with GPS, or open the 3D simulator.
struct FlyView: View {
    @State private var recorder = FlightRecorder()
    @State private var saving = false
    @State private var recorded: RecordedFlight?
    @State private var analysing = false
    @State private var showSim = false
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var traffic = LiveTraffic()
    @State private var confirmDiscard = false
    @Environment(AppModel.self) private var model

    var body: some View { screenBody.screen("fly") }
    @ViewBuilder private var screenBody: some View {
        NavigationStack {
            Page(title: "Fly") {
                simCard
                recorderCard
                tools
            }
            .logFlightButton(model)
            .boploDestinations()
            // closing the form without saving keeps the recording, so it can be saved later
            .sheet(isPresented: $saving) {
                FlightFormView(track: recorder.points, recordedMinutes: recorder.elapsedMinutes, recorded: recorded) {
                    recorder.saved(); recorded = nil
                }
            }
            .fullScreenCover(isPresented: $showSim) { SimulatorView() }
        }
    }

    private var tools: some View {
        VStack(spacing: 0) {
            NavigationLink(value: Route.liveTraffic) {
                MenuRow(icon: "airplane.circle", title: "Live traffic", subtitle: "Planes around \(model.homeCode.isEmpty ? "you" : model.homeCode) right now, from ADS-B")
            }
            Divider().overlay(Theme.hair).padding(.leading, 58)
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
            Map(position: $camera, selection: $traffic.selected) {
                UserAnnotation()
                if recorder.points.count >= 2 {
                    MapPolyline(coordinates: recorder.points.map(\.coordinate))
                        .stroke(Theme.electric, lineWidth: 4)
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
            .mapControlVisibility(.hidden)
            .onMapCameraChange(frequency: .onEnd) { ctx in traffic.show(ctx.region) }
            .frame(height: 300)
            .overlay(alignment: .top) {
                HStack {
                    TrafficToggle(traffic: traffic)
                    Spacer()
                    NavigationLink(value: Route.liveTraffic) {
                        Image(systemName: "arrow.up.left.and.arrow.down.right").font(.system(size: 14, weight: .semibold))
                    }
                    .floatingIcon()
                    .accessibilityLabel("Open the live traffic map")
                    Button { camera = .userLocation(followsHeading: false, fallback: .automatic) } label: {
                        Image(systemName: "location.fill").font(.system(size: 15, weight: .semibold))
                    }
                    .floatingIcon()
                    .accessibilityLabel("Centre on me")
                }
                .glassGroup(spacing: 10)
                .padding(10)
            }
            .overlay(alignment: .bottom) {
                if let p = traffic.selectedPlane {
                    PlaneCard(plane: p) { traffic.selected = nil }
                        .padding(8)
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                } else if traffic.on {
                    TrafficCredit().frame(maxWidth: .infinity, alignment: .leading).padding(.bottom, recorder.isRecording ? 52 : 8)
                }
            }
            .animation(.snappy, value: traffic.selected)
            .sensoryFeedback(.selection, trigger: traffic.selected)
            .onDisappear { traffic.stop() }
            .onAppear { if traffic.on { traffic.start() } }
            .overlay(alignment: .bottomLeading) {
                if recorder.isRecording && traffic.selected == nil {
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
                Text("Start before you taxi and stop after you shut down. It records with the screen locked and no signal, spots your takeoffs and landings, scores each landing, and fills in the logbook for you.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            }

            ErrorText(text: recorder.message)

            if recorder.isRecording {
                Button {
                    recorder.stop()
                    Haptic.tap(.heavy)
                    Task { await review() }
                } label: {
                    Label("Stop and save", systemImage: "stop.fill")
                }
                .primaryStyle(tint: Theme.danger)
            } else if recorder.unsaved {
                // a recording that isn't in the logbook yet: no signal at the airfield, the form was closed, or the app was closed
                VStack(alignment: .leading, spacing: 10) {
                    Text("Recorded flight not in your logbook yet")
                        .font(.archivo(15.5, .semibold))
                    Text("\(recorder.startedAt.map { $0.formatted(date: .abbreviated, time: .shortened) } ?? "") · \(hoursText(recorder.elapsedMinutes)) · kept on this phone until you save it.")
                        .font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                    HStack(spacing: 10) {
                        Button { Task { await review() } } label: {
                            HStack { if analysing { ProgressView().tint(.white) }; Text(analysing ? "Working it out…" : "Save to logbook") }
                        }
                        .primaryStyle(full: false)
                        .disabled(analysing)
                        Button("Discard", role: .destructive) { confirmDiscard = true }
                            .buttonStyle(.pill(.line, height: 46))
                    }
                }
                .confirmationDialog("Discard this recording?", isPresented: $confirmDiscard, titleVisibility: .visible) {
                    Button("Discard recording", role: .destructive) { recorder.discard(); recorded = nil }
                } message: { Text("The track is deleted from this phone. This can’t be undone.") }
            } else {
                Button {
                    recorder.start()
                    Haptic.tap(.medium)
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

    /// Works out takeoffs, landings, airfields, night and landing scores, then opens the logbook form.
    private func review() async {
        guard let start = recorder.startedAt else { return }
        analysing = true
        recorded = await FlightAnalysis.analyse(recorder.points, startedAt: start, endedAt: recorder.endedAt ?? Date(), country: model.countryCode)
        analysing = false
        saving = true
    }

    private func readout(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.archivo(20, .semibold)).monospacedDigit()
            Text(label).font(.archivo(12)).foregroundStyle(Theme.ink3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
