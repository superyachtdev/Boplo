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
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Tile {
                        TileHead("Flight")
                        DatePicker("Date", selection: $date, in: ...Date(), displayedComponents: .date)
                            .font(.archivo(15.5, .medium))
                        HStack(spacing: 8) {
                            Labeled(label: "From") { codeField("EGHP", text: $departure) }
                            Image(systemName: "arrow.right").foregroundStyle(Theme.ink3).padding(.top, 22)
                            Labeled(label: "To") { codeField("EGHP", text: $arrival) }
                        }
                        Labeled(label: "Role") {
                            HStack(spacing: 4) {
                                ForEach([("dual", "Dual"), ("solo", "Solo"), ("pic", "PIC")], id: \.0) { id, label in
                                    Button { withAnimation(.snappy) { role = id } } label: {
                                        Text(label).font(.archivo(14.5, .semibold)).frame(maxWidth: .infinity).frame(height: 38)
                                            .foregroundStyle(role == id ? .white : Theme.ink2)
                                            .background(role == id ? Theme.ink : .clear, in: Capsule())
                                    }
                                    .buttonStyle(.plain)
                                }
                            }
                            .padding(4)
                            .background(Theme.well, in: Capsule())
                        }
                    }
                    Tile {
                        TileHead(title: "Time and landings") {
                            Text(hoursText(hours * 60 + minutes)).font(Theme.display(26)).monospacedDigit()
                        }
                        counter("Hours", value: $hours, range: 0...24, step: 1)
                        counter("Minutes", value: $minutes, range: 0...55, step: 5)
                        Divider().overlay(Theme.hair)
                        counter("Landings", value: $landings, range: 0...100, step: 1)
                        counter("Night landings", value: $nightLandings, range: 0...max(0, landings), step: 1)
                    }
                    Tile {
                        TileHead("Aircraft and lesson")
                        Labeled(label: "Aircraft") { TextField("e.g. PA-28 Warrior", text: $aircraft).boploField() }
                        Labeled(label: "Registration") {
                            TextField("G-BOPL", text: $registration).textInputAutocapitalization(.characters).autocorrectionDisabled().boploField()
                        }
                        Labeled(label: "Instructor") { TextField("Name", text: $instructor).textContentType(.name).boploField() }
                        Labeled(label: "Lesson") { TextField("e.g. Lesson 12 · Navigation", text: $lesson).boploField() }
                    }
                    Tile {
                        TileHead("Debrief")
                        Labeled(label: "One thing that went well") { TextField("Something to keep doing", text: $win).boploField() }
                        Labeled(label: "Notes") {
                            TextField("What you practised, what to work on next", text: $notes, axis: .vertical)
                                .lineLimit(4...10)
                                .padding(.vertical, 12)
                                .boploField()
                        }
                    }
                    if !track.isEmpty || !(editing?.track.isEmpty ?? true) {
                        let pts = track.isEmpty ? (editing?.track ?? []) : track
                        Tile(spacing: 10) {
                            TileHead(title: "Track") { Text("\(pts.count) GPS points").font(.archivo(13)).foregroundStyle(Theme.ink3) }
                            if pts.count >= 2 {
                                TrackPreview(points: pts).frame(height: 160).clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                            }
                        }
                    }
                    ErrorText(text: error)
                    Button { Task { await save() } } label: {
                        HStack { if busy { ProgressView().tint(.white) }; Text(editing == nil ? "Save flight" : "Save changes") }
                    }
                    .primaryStyle()
                    .disabled(busy)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.cloud.ignoresSafeArea())
            .navigationTitle(editing == nil ? "Log a flight" : "Edit flight")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Saving…" : "Save") { Task { await save() } }.disabled(busy).fontWeight(.semibold)
                }
            }
        }
        .onAppear(perform: load)
    }

    private func codeField(_ prompt: String, text: Binding<String>) -> some View {
        TextField(prompt, text: text)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled()
            .boploField(font: .archivo(17, .semibold))
    }

    private func counter(_ label: String, value: Binding<Int>, range: ClosedRange<Int>, step: Int) -> some View {
        HStack {
            Text(label).font(.archivo(15.5))
            Spacer()
            HStack(spacing: 0) {
                Button { value.wrappedValue = max(range.lowerBound, value.wrappedValue - step) } label: {
                    Image(systemName: "minus").frame(width: 40, height: 36)
                }
                .disabled(value.wrappedValue <= range.lowerBound)
                Text("\(value.wrappedValue)").font(.archivo(17, .semibold)).monospacedDigit().frame(minWidth: 34)
                Button { value.wrappedValue = min(range.upperBound, value.wrappedValue + step) } label: {
                    Image(systemName: "plus").frame(width: 40, height: 36)
                }
                .disabled(value.wrappedValue >= range.upperBound)
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.ink)
            .background(Theme.well, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.hair))
            .sensoryFeedback(.selection, trigger: value.wrappedValue)
        }
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        if let f = editing {
            if let d = Day.date(f.date) {
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
            departure = Self.code(model.profile?.airport)
            arrival = departure
            aircraft = model.profile?.aircraft ?? ""
            registration = model.profile?.registration ?? ""
            lesson = model.profile?.nextLesson ?? ""
            if let m = recordedMinutes, m > 0 { hours = m / 60; minutes = m % 60 }
        }
    }

    /// "EGHP · Popham" → "EGHP"
    static func code(_ airport: String?) -> String {
        let a = (airport ?? "").trimmingCharacters(in: .whitespaces)
        let first = a.components(separatedBy: " · ").first ?? a
        return (first.split(separator: " ").first.map(String.init) ?? first).uppercased()
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
            payload["routeKind"] = editing?.routeKind ?? "track"
        }
        if let cost = editing?.cost { payload["cost"] = cost }
        do {
            if let f = editing {
                try await API.shared.send("flight/flights/\(f.id)", method: "PUT", body: payload)
            } else {
                try await API.shared.send("flight/flights", method: "POST", body: payload)
            }
            await model.refresh()
            if editing == nil {
                let total = Double(model.totalMinutes) / 60
                let goal = model.profile?.goalHours ?? 0
                model.show(.init(symbol: "airplane.circle.fill", title: "Logged. Good flight.",
                                 detail: "+\(hoursText(hours * 60 + minutes)) h · " + (goal > 0 ? String(format: "%.1f of %d h", total, Int(goal)) : String(format: "%.1f h total", total))))
            } else {
                model.show(.init(title: "Entry amended"))
            }
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
