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
    /// What Boplo worked out from a recorded flight: airfields, landings, night, landing scores.
    var recorded: RecordedFlight? = nil
    /// Called once the flight is safely in the logbook.
    var onSaved: (() -> Void)? = nil

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
                    if let r = recorded { recordedSummary(r) }
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
                    if !recordedTrack.isEmpty || !(editing?.track.isEmpty ?? true) {
                        let pts = recordedTrack.isEmpty ? (editing?.track ?? []) : recordedTrack
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

    private var recordedTrack: [TrackPoint] { recorded?.points ?? track }

    @ViewBuilder
    private func recordedSummary(_ r: RecordedFlight) -> some View {
        Tile(spacing: 10) {
            TileHead("From your recording")
            let tg = max(0, r.landingTimes.count - 1)
            Text([
                r.landingTimes.isEmpty ? "No landings detected" : "\(r.landingTimes.count) landing\(r.landingTimes.count == 1 ? "" : "s")\(tg > 0 ? " (including touch-and-goes)" : "")",
                r.nightMinutes > 0 ? "\(hoursText(r.nightMinutes)) at night" : nil,
                r.xcNM >= 1 ? String(format: "furthest %.0f NM from the departure", r.xcNM) : nil
            ].compactMap { $0 }.joined(separator: " · "))
                .font(.archivo(15, .medium))
            Text("Worked out from your phone’s GPS. Check the airfields, time and landings below before you save.")
                .font(.archivo(13)).foregroundStyle(Theme.ink3)
            if !r.scores.isEmpty {
                ForEach(Array(r.scores.enumerated()), id: \.offset) { i, sc in LandingScoreRow(index: i + 1, score: sc) }
            }
        }
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
            if let r = recorded {
                date = r.date
                hours = r.minutes / 60; minutes = r.minutes % 60
                if let d = r.departure { departure = d }
                if let a = r.arrival { arrival = a }
                if !r.landingTimes.isEmpty { landings = r.landingTimes.count }
                nightLandings = min(r.nightLandings, landings)
            }
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
        let points = editing?.points ?? recordedTrack
        if !points.isEmpty {
            payload["points"] = points.prefix(2000).map { p -> [String: Any] in
                var o: [String: Any] = ["lat": (p.lat * 1e5).rounded() / 1e5, "lng": (p.lng * 1e5).rounded() / 1e5]
                if let a = p.alt { o["alt"] = Int(a.rounded()) }
                if let t = p.t { o["t"] = Int(t.rounded()) }
                if let k = p.kt { o["kt"] = Int(k.rounded()) }
                return o
            }
            payload["routeKind"] = editing?.routeKind ?? "track"
        }
        // what the recording worked out, kept when the entry is edited later
        let nightMins = recorded.map { Double($0.nightMinutes) } ?? editing?.nightMinutes
        let xc = recorded?.xcNM ?? editing?.xcNM
        let times = recorded?.landingTimes ?? editing?.landingsAt ?? []
        let scores = recorded?.scores ?? editing?.landingScores ?? []
        if let nightMins { payload["nightMinutes"] = Int(nightMins) }
        if let xc { payload["xcNM"] = xc }
        if !times.isEmpty { payload["landingsAt"] = times.map { Int($0.rounded()) } }
        if !scores.isEmpty {
            payload["landingScores"] = scores.map { sc -> [String: Any] in
                var o: [String: Any] = ["s": Int(sc.s), "t": Int(sc.t.rounded())]
                if let v = sc.spd { o["spd"] = v }; if let v = sc.gp { o["gp"] = v }; if let v = sc.cl { o["cl"] = v }; if let v = sc.tz { o["tz"] = v }
                if let v = sc.rw { o["rw"] = v }; if let v = sc.ap { o["ap"] = v }
                return o
            }
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
            onSaved?()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}


/// One landing's score from a recorded flight, with what went into it.
struct LandingScoreRow: View {
    let index: Int
    let score: LandingScore
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text("\(Int(score.s))")
                .font(Theme.display(28)).monospacedDigit()
                .foregroundStyle(score.s >= 75 ? Theme.ok : score.s >= 50 ? Theme.ink : Theme.danger)
                .frame(width: 52, alignment: .leading)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.archivo(14.5, .semibold))
                Text(details).font(.archivo(13)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
    private var title: String {
        let place = [score.ap, score.rw.map { "runway " + $0 }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ")
        return place.isEmpty ? "Landing \(index)" : "Landing \(index) · \(place)"
    }
    private var details: String {
        [
            score.spd.map { String(format: "speed held within ±%.0f kt", $0) },
            score.gp.map { String(format: "%.0f ft off a 3° glidepath on average", $0) },
            score.cl.map { String(format: "%.0f m from the centreline", $0) },
            score.tz.map { $0 < 0 ? "touched down before the threshold" : String(format: "touched down %.0f ft past the threshold", $0) }
        ].compactMap { $0 }.joined(separator: " · ")
    }
}
