import SwiftUI
import MapKit
import Charts

/// Logbook tab: the flight list, the map of every track and analytics, switched with the chips like the web app.
struct LogbookView: View {
    @Environment(AppModel.self) private var model
    @State private var section = "logbook"

    var body: some View {
        NavigationStack {
            Group {
                switch section {
                case "map": TrackMapView(chips: chips)
                case "analytics": AnalyticsView(chips: chips)
                default: FlightListView(chips: chips)
                }
            }
            .logFlightButton(model)
            .boploDestinations()
        }
    }

    private var chips: AnyView {
        AnyView(ChipRow(items: [.init(id: "logbook", label: "Logbook"), .init(id: "map", label: "Map"), .init(id: "analytics", label: "Analytics")],
                        selected: section) { id in withAnimation(.snappy) { section = id } })
    }
}

struct FlightListView: View {
    @Environment(AppModel.self) private var model
    var chips: AnyView? = nil
    @State private var search = ""
    @State private var role = "all"

    private var list: [Flight] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        return model.sortedFlights.filter { f in
            (role == "all" || (f.role ?? "dual") == role) &&
            (q.isEmpty || [f.departure, f.arrival, f.aircraft, f.registration, f.instructor, f.lesson, f.notes, f.date]
                .compactMap { $0?.lowercased() }.contains { $0.contains(q) })
        }
    }

    var body: some View {
        Page(title: "Logbook") {
            chips
            if model.flights.isEmpty {
                Tile {
                    Text("Your logbook is empty.").font(.archivo(18, .semibold))
                    Text("Each flight you log keeps its time, role, landings and debrief together.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                    Button { model.logFlight() } label: { Text("Log your first flight") }.primaryStyle(full: false)
                }
            } else {
                Picker("Role", selection: $role.animation(.snappy)) {
                    Text("All").tag("all")
                    Text("Dual").tag("dual")
                    Text("Solo").tag("solo")
                    Text("PIC").tag("pic")
                }
                .pickerStyle(.segmented)
                countLine
                if list.isEmpty {
                    Tile {
                        Text("No flights match.").font(.archivo(17, .semibold))
                        Text("Try a different search or role.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                        Button("Clear filters") { search = ""; role = "all" }.buttonStyle(.pill(.line, height: 42))
                    }
                } else {
                    LazyVStack(spacing: 8) {
                        ForEach(list) { f in
                            NavigationLink(value: Route.flight(f)) { FlightCard(flight: f) }.buttonStyle(.pressable)
                        }
                    }
                }
            }
        }
        .refreshable { await model.refresh() }
        .searchable(text: $search, prompt: "Airfield, lesson, aircraft…")
        .minimizedSearch()
        .toolbar {
            ToolbarItemGroup(placement: .topBarLeading) {
                Button { model.tab = .fly } label: { Label("Record", systemImage: "record.circle") }
                if !model.flights.isEmpty, let url = CSVExport.file(model.sortedFlights) {
                    ShareLink(item: url) { Label("Export CSV", systemImage: "square.and.arrow.up") }
                }
            }
        }
    }

    private var countLine: some View {
        let total = list.reduce(0) { $0 + $1.mins }
        return HStack(spacing: 4) {
            Text("\(plural(list.count, "flight")) · \(hoursText(total)) h").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
            if !model.isAdvanced, let limit = model.billing?.flightLimit {
                Text("·").foregroundStyle(Theme.ink3)
                Button { model.upgrade() } label: {
                    Text("\(model.flights.count) of \(limit) on Free").font(.archivo(13.5, .semibold)).foregroundStyle(Theme.electric)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 2)
    }
}

/// Writes the logbook as CSV in the same columns as the web export.
enum CSVExport {
    static func file(_ flights: [Flight]) -> URL? {
        let cols = ["date", "departure", "arrival", "aircraft", "registration", "role", "minutes", "landings", "nightLandings", "instructor", "lesson", "notes"]
        func cell(_ s: String) -> String { s.contains(where: { ",\"\n".contains($0) }) ? "\"" + s.replacingOccurrences(of: "\"", with: "\"\"") + "\"" : s }
        var rows = [cols.joined(separator: ",")]
        for f in flights {
            let vals: [String] = [f.date, f.dep, f.arr, f.aircraft ?? "", f.registration ?? "", f.role ?? "dual", "\(f.mins)",
                                  "\(Int(f.landings ?? 0))", "\(Int(f.nightLandings ?? 0))", f.instructor ?? "", f.lesson ?? "", f.notes ?? ""]
            rows.append(vals.map(cell).joined(separator: ","))
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("boplo-logbook.csv")
        do { try rows.joined(separator: "\n").write(to: url, atomically: true, encoding: .utf8); return url } catch { return nil }
    }
}

// MARK: - Map

/// Every logged track on one satellite map; tap a flight to highlight it.
struct TrackMapView: View {
    @Environment(AppModel.self) private var model
    var chips: AnyView? = nil
    @State private var selected: String?
    @State private var camera: MapCameraPosition = .automatic

    private var withTracks: [Flight] { model.sortedFlights.filter { $0.track.count >= 2 } }

    var body: some View {
        Page(title: "Map") {
            chips
            if withTracks.isEmpty {
                Tile {
                    Text("No tracks yet.").font(.archivo(17, .semibold))
                    Text("Record a flight with GPS, or add a route to a flight, and it’s drawn here.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                    Button { model.tab = .fly } label: { Text("Record a flight") }.primaryStyle(full: false)
                }
            } else {
                Map(position: $camera) {
                    ForEach(withTracks) { f in
                        let on = selected == nil || selected == f.id
                        MapPolyline(coordinates: f.track.map(\.coordinate))
                            .stroke(Theme.electric.opacity(on ? 0.55 : 0.16), lineWidth: on ? 8 : 4)
                        MapPolyline(coordinates: f.track.map(\.coordinate))
                            .stroke(on ? Theme.ice : Theme.ice.opacity(0.35), lineWidth: on ? 2.5 : 1.4)
                    }
                }
                .mapStyle(.hybrid(elevation: .realistic))
                .frame(height: 380)
                .clipShape(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
                LazyVStack(spacing: 8) {
                    ForEach(withTracks) { f in
                        Button {
                            withAnimation(.snappy) {
                                selected = selected == f.id ? nil : f.id
                                camera = selected == nil ? .automatic : .rect(TrackPreview.rect(f.track))
                            }
                        } label: {
                            FlightCard(flight: f)
                                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(selected == f.id ? Theme.electric : .clear, lineWidth: 2))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

// MARK: - Analytics

struct AnalyticsView: View {
    @Environment(AppModel.self) private var model
    var chips: AnyView? = nil
    @State private var range = "365"

    private var list: [Flight] {
        range == "all" ? model.flights : model.flights(inLast: Int(range) ?? 365)
    }

    private struct MonthRole: Identifiable {
        let id = UUID()
        let month: String
        let role: String
        let hours: Double
    }

    private var perMonth: [MonthRole] {
        let n = range == "90" ? 3 : 12
        let cal = Calendar.current
        var out: [MonthRole] = []
        for i in 0..<n {
            guard let d = cal.date(byAdding: .month, value: -(n - 1) + i, to: Date()) else { continue }
            let c = cal.dateComponents([.year, .month], from: d)
            let key = String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
            let label = d.formatted(.dateTime.month(.abbreviated))
            let fs = model.flights.filter { $0.date.hasPrefix(key) }
            for role in ["dual", "solo", "pic"] {
                let mins = fs.filter { ($0.role ?? "dual") == role }.reduce(0) { $0 + $1.mins }
                out.append(MonthRole(month: label, role: role, hours: Double(mins) / 60))
            }
        }
        return out
    }

    var body: some View {
        let total = list.reduce(0) { $0 + $1.mins }
        let landings = list.reduce(0) { $0 + Int($1.landings ?? 0) }
        var airfields: [String: Int] = [:]
        for f in list { for k in Set([f.dep, f.arr]) where !k.isEmpty { airfields[k, default: 0] += 1 } }
        let top = airfields.sorted { $0.value > $1.value }.prefix(6)

        return Page(title: "Analytics", subtitle: "Your flying, measured from your own records.") {
            chips
            HStack(spacing: 4) {
                ForEach([("90", "90 days"), ("365", "12 months"), ("all", "All time")], id: \.0) { id, label in
                    Button { withAnimation(.snappy) { range = id } } label: {
                        Text(label).font(.archivo(14, .semibold)).padding(.horizontal, 14).frame(height: 34)
                            .foregroundStyle(range == id ? .white : Theme.ink2)
                            .background(range == id ? Theme.ink : .clear, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(4)
            .background(Theme.paper, in: Capsule())
            .overlay(Capsule().strokeBorder(Theme.hair))

            LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
                statBox("Flight time", decimalHours(total), "h", range == "all" ? "All logged flights" : range == "90" ? "Last 90 days" : "Last 12 months")
                statBox("Flights", "\(list.count)", nil, list.isEmpty ? "None in this period" : "Average \(hoursText(total / max(1, list.count)))")
                statBox("Landings", "\(landings)", nil, list.isEmpty ? "—" : String(format: "%.1f per flight", Double(landings) / Double(list.count)))
                statBox("Airfields", "\(airfields.count)", nil, "Visited or departed")
            }

            Tile {
                TileHead("Hours by month")
                Chart(perMonth) { item in
                    BarMark(x: .value("Month", item.month), y: .value("Hours", item.hours))
                        .foregroundStyle(by: .value("Role", item.role == "dual" ? "Dual" : item.role == "solo" ? "Solo" : "PIC"))
                        .cornerRadius(3)
                }
                .chartForegroundStyleScale(["Dual": Theme.electric, "Solo": Theme.ice, "PIC": Theme.pic])
                .chartLegend(position: .top, alignment: .trailing)
                .frame(height: 200)
            }

            Tile {
                TileHead("Time by role")
                ForEach([("dual", "Dual instruction", Theme.electric), ("solo", "Solo", Theme.ice), ("pic", "Pilot in command", Theme.pic)], id: \.0) { role, label, color in
                    let n = list.filter { ($0.role ?? "dual") == role }.reduce(0) { $0 + $1.mins }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(label).font(.archivo(14.5))
                            Spacer()
                            Text("\(decimalHours(n)) h").font(.archivo(14.5, .semibold)).monospacedDigit()
                        }
                        Bar(value: total > 0 ? Double(n) / Double(total) : 0, height: 8, fill: color)
                    }
                }
                Footnote(text: "From your own entries. It doesn’t decide what counts toward a licence.")
            }

            if !top.isEmpty {
                Tile {
                    TileHead("Airfields")
                    ForEach(Array(top), id: \.key) { code, n in
                        HStack {
                            Text(code).font(.archivo(15, .semibold))
                            Spacer()
                            Text(plural(n, "flight")).font(.archivo(14)).foregroundStyle(Theme.ink3)
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
    }

    private func statBox(_ label: String, _ value: String, _ unit: String?, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.archivo(13)).foregroundStyle(Theme.ink3)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.archivo(26, .semibold)).tracking(-0.6).monospacedDigit()
                if let unit { Text(unit).font(.archivo(13.5, .medium)).foregroundStyle(Theme.ink3) }
            }
            Text(note).font(.archivo(12)).foregroundStyle(Theme.ink3).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
    }
}
