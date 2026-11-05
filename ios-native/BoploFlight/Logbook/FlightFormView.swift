import SwiftUI

/// Log a new flight, or edit one. Sends the fields the server validates (validateFlight).
struct FlightFormView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var editing: Flight? = nil
    /// A recorded GPS track to save with the flight.
    var track: [TrackPoint] = []
    /// Duration of a recorded flight, in minutes.
    var recordedMinutes: Int? = nil

    @State private var date = Date()
    @State private var departure = ""
    @State private var arrival = ""
    @State private var hours = 1
    @State private var minutes = 0
    @State private var role = "dual"
    @State private var landings = 1
    @State private var nightLandings = 0
    @State private var aircraft = ""
    @State private var registration = ""
    @State private var instructor = ""
    @State private var lesson = ""
    @State private var win = ""
    @State private var notes = ""
    @State private var busy = false
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            Form {
                Section("Flight") {
                    DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                    HStack {
                        TextField("From", text: $departure)
                        Image(systemName: "arrow.right").foregroundStyle(.secondary)
                        TextField("To", text: $arrival)
                    }
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    Picker("Role", selection: $role) {
                        Text("Dual").tag("dual"); Text("Solo").tag("solo"); Text("PIC").tag("pic")
                    }
                    .pickerStyle(.segmented)
                }
                Section("Time and landings") {
                    Stepper("Hours: \(hours)", value: $hours, in: 0...24)
                    Stepper("Minutes: \(minutes)", value: $minutes, in: 0...55, step: 5)
                    Stepper("Landings: \(landings)", value: $landings, in: 0...100)
                    Stepper("Night landings: \(nightLandings)", value: $nightLandings, in: 0...max(0, landings))
                }
                Section("Aircraft and lesson") {
                    TextField("Aircraft (e.g. PA-28 Warrior)", text: $aircraft)
                    TextField("Registration", text: $registration)
                        .textInputAutocapitalization(.characters)
                    TextField("Instructor", text: $instructor)
                    TextField("Lesson", text: $lesson)
                }
                Section("Debrief") {
                    TextField("One thing that went well", text: $win)
                    TextField("Notes", text: $notes, axis: .vertical).lineLimit(3...8)
                }
                if !track.isEmpty {
                    Section { Label("\(track.count) GPS points from your recording", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                }
                Section { ErrorText(text: error) }
            }
            .navigationTitle(editing == nil ? "Log a flight" : "Edit flight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Saving…" : "Save") { Task { await save() } }.disabled(busy)
                }
            }
        }
        .onAppear(perform: load)
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let f = editing {
            if let d = f.day {
                var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(identifier: "UTC")!
                date = Calendar.current.date(from: utc.dateComponents([.year, .month, .day], from: d)) ?? Date()
            }
            departure = f.departure ?? ""; arrival = f.arrival ?? ""
            hours = f.mins / 60; minutes = f.mins % 60
            role = f.role ?? "dual"
            landings = Int(f.landings ?? 0); nightLandings = Int(f.nightLandings ?? 0)
            aircraft = f.aircraft ?? ""; registration = f.registration ?? ""
            instructor = f.instructor ?? ""; lesson = f.lesson ?? ""
            win = f.win ?? ""; notes = f.notes ?? ""
        } else {
            departure = model.profile?.airport ?? ""
            arrival = departure
            aircraft = model.profile?.aircraft ?? ""
            lesson = model.profile?.nextLesson ?? ""
            if let m = recordedMinutes, m > 0 { hours = m / 60; minutes = m % 60 }
        }
    }

    private func save() async {
        let total = hours * 60 + minutes
        guard !departure.isEmpty, !arrival.isEmpty else { error = "Enter departure and arrival airfields."; return }
        guard total >= 1 else { error = "Enter how long the flight was."; return }
        busy = true; error = nil
        defer { busy = false }
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        var payload: [String: Any] = [
            "date": String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0),
            "departure": departure.uppercased(), "arrival": arrival.uppercased(),
            "minutes": total, "role": role,
            "landings": landings, "nightLandings": min(nightLandings, landings),
            "aircraft": aircraft, "registration": registration.uppercased(),
            "instructor": instructor, "lesson": lesson, "win": win, "notes": notes
        ]
        let points = editing?.points ?? track
        if !points.isEmpty {
            payload["points"] = points.prefix(2000).map { ["lat": $0.lat, "lng": $0.lng] }
            payload["routeKind"] = "track"
        }
        if let cost = editing?.cost { payload["cost"] = cost }
        do {
            if let f = editing {
                try await API.shared.send("flight/flights/\(f.id)", method: "PUT", body: payload)
            } else {
                try await API.shared.send("flight/flights", method: "POST", body: payload)
            }
            await model.refresh()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
