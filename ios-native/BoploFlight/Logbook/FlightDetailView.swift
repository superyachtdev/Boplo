import SwiftUI
import MapKit

struct FlightDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let flight: Flight
    @State private var editing = false
    @State private var confirmDelete = false
    @State private var error: String?

    static let long: DateFormatter = {
        let f = DateFormatter(); f.dateStyle = .long; f.timeZone = TimeZone(identifier: "UTC"); return f
    }()

    private var points: [CLLocationCoordinate2D] { (flight.points ?? []).map(\.coordinate) }

    var body: some View {
        List {
            if points.count >= 2 {
                Section {
                    Map(initialPosition: .automatic) {
                        MapPolyline(coordinates: points)
                            .stroke(Theme.electric, lineWidth: 4)
                        if let first = points.first { Marker(flight.departure ?? "Start", coordinate: first).tint(.green) }
                        if let last = points.last { Marker(flight.arrival ?? "End", coordinate: last).tint(.red) }
                    }
                    .mapStyle(.hybrid(elevation: .realistic))
                    .frame(height: 260)
                    .listRowInsets(EdgeInsets())
                }
            }
            Section {
                row("Date", flight.day.map { FlightDetailView.long.string(from: $0) } ?? flight.date)
                row("Route", flight.route)
                row("Time", hoursText(flight.mins))
                row("Role", flight.roleLabel)
                row("Landings", "\(Int(flight.landings ?? 0))" + ((flight.nightLandings ?? 0) > 0 ? " (\(Int(flight.nightLandings!)) at night)" : ""))
                if let a = flight.aircraft, !a.isEmpty { row("Aircraft", [a, flight.registration ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")) }
                if let i = flight.instructor, !i.isEmpty { row("Instructor", i) }
                if let l = flight.lesson, !l.isEmpty { row("Lesson", l) }
                if let c = flight.cost { row("Cost", c.formatted(.number.precision(.fractionLength(0...2)))) }
            }
            if let win = flight.win, !win.isEmpty {
                Section("What went well") { Text(win) }
            }
            if let notes = flight.notes, !notes.isEmpty {
                Section("Debrief notes") { Text(notes) }
            }
            Section {
                ErrorText(text: error)
                Button("Delete flight", role: .destructive) { confirmDelete = true }
            }
        }
        .navigationTitle(flight.route)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { Button("Edit") { editing = true } }
        .sheet(isPresented: $editing) { FlightFormView(editing: flight) }
        .confirmationDialog("Delete this flight?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await delete() } }
        } message: { Text("This removes it from your logbook and totals.") }
    }

    private func row(_ label: String, _ value: String) -> some View {
        LabeledContent(label, value: value)
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
