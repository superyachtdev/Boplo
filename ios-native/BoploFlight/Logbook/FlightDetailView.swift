import SwiftUI
import MapKit

struct FlightDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let flight: Flight
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var showSim = false
    @State private var error: String?

    /// The latest copy after an edit.
    private var f: Flight { model.flights.first { $0.id == flight.id } ?? flight }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("\(f.dep) → \(f.arr)").font(Theme.display(36)).tracking(-1)
                    Text([Day.long(f.date), f.lesson].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                }
                .padding(.top, 4)

                if f.track.count >= 2 {
                    Map(initialPosition: .rect(TrackPreview.rect(f.track))) {
                        MapPolyline(coordinates: f.track.map(\.coordinate)).stroke(Theme.electric.opacity(0.55), lineWidth: 8)
                        MapPolyline(coordinates: f.track.map(\.coordinate)).stroke(Theme.ice, lineWidth: 2.5)
                        if let first = f.track.first { Marker(f.dep.isEmpty ? "Start" : f.dep, coordinate: first.coordinate).tint(Theme.electric) }
                        if let last = f.track.last, f.track.count > 2 { Marker(f.arr.isEmpty ? "End" : f.arr, coordinate: last.coordinate).tint(Theme.ink) }
                    }
                    .mapStyle(.imagery(elevation: .realistic))
                    .frame(height: 260)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
                }

                HStack(spacing: 8) {
                    big("Time", hoursText(f.mins))
                    big("Landings", "\(Int(f.landings ?? 0))")
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Role").font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                        RolePill(role: f.role)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
                    .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
                }

                Tile(spacing: 0) {
                    row("Date", Day.full(f.date))
                    if let a = f.aircraft, !a.isEmpty { row("Aircraft", [a, f.registration ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")) }
                    if let i = f.instructor, !i.isEmpty { row("Instructor", i) }
                    if (f.nightLandings ?? 0) > 0 { row("Night landings", "\(Int(f.nightLandings ?? 0))") }
                    if let c = f.cost, c > 0 { row("Cost", c.formatted(.number.precision(.fractionLength(0...2)))) }
                    row("Route", f.routeKind == "track" ? "Recorded track" : f.track.count >= 2 ? "Planned route" : "Airfields only", last: true)
                }

                if let win = f.win, !win.isEmpty {
                    Tile(spacing: 8) {
                        TileHead("What went well")
                        Text(win).font(.archivo(15)).foregroundStyle(Theme.ink2)
                    }
                }
                Tile(spacing: 8) {
                    TileHead("Debrief")
                    Text(f.notes?.isEmpty == false ? f.notes! : "No debrief notes for this flight. Add what you practised and what to work on next.")
                        .font(.archivo(15)).foregroundStyle(f.notes?.isEmpty == false ? Theme.ink2 : Theme.ink3)
                    Button("Edit debrief") { editing = true }.buttonStyle(.pill(.line, height: 40))
                }

                if f.track.count >= 2 {
                    Button { showSim = true } label: { Text("Fly it again in the simulator") }
                        .buttonStyle(.pill(.ink, height: 48, full: true, spark: true))
                }
                ErrorText(text: error)
                Button("Delete flight", role: .destructive) { confirmDelete = true }
                    .buttonStyle(.pill(.danger, height: 46, full: true))
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .background(Theme.cloud.ignoresSafeArea())
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { Button("Edit") { editing = true }.fontWeight(.semibold) }
        .sheet(isPresented: $editing) { FlightFormView(editing: f) }
        .fullScreenCover(isPresented: $showSim) { SimulatorView() }
        .confirmationDialog("Delete this flight?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        } message: { Text("This removes it from your logbook and totals.") }
    }

    private func big(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            Text(value).font(Theme.display(28)).monospacedDigit()
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 78, alignment: .topLeading)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
    }

    private func row(_ label: String, _ value: String, last: Bool = false) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                Spacer(minLength: 12)
                Text(value).font(.archivo(14.5, .semibold)).multilineTextAlignment(.trailing)
            }
            .padding(.vertical, 11)
            if !last { Divider().overlay(Theme.hair) }
        }
    }

    private func delete() async {
        do {
            try await API.shared.send("flight/flights/\(flight.id)", method: "DELETE", body: [:])
            await model.refresh()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
