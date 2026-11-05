import SwiftUI
import MapKit

/// Nav log: build a route from airfields or map taps, add the wind, and get heading, groundspeed, time and fuel per leg.
struct NavLogPage: View {
    @Environment(AppModel.self) private var model

    struct Waypoint: Identifiable, Equatable {
        var id = UUID()
        var lat: Double
        var lng: Double
        var code: String
        var point: TrackPoint { TrackPoint(lat: lat, lng: lng) }
    }

    struct Leg: Identifiable {
        let id = UUID()
        let from: String, to: String
        let tt: Double, d: Double, wca: Double, th: Double, mh: Double, gs: Double, mins: Double, fuel: Double
        let ok: Bool
    }

    @State private var name = ""
    @State private var points: [Waypoint] = []
    @State private var tas = "95"
    @State private var alt = ""
    @State private var wdir = ""
    @State private var wspd = ""
    @State private var vari = ""
    @State private var vdir = "W"
    @State private var burn = ""
    @State private var unit = "L"
    @State private var taxi = ""
    @State private var reserve = "45"
    @State private var search = ""
    @State private var results: [Airfield] = []
    @State private var camera: MapCameraPosition = .automatic
    @State private var addOnTap = false
    @State private var note: String?
    @State private var error: String?

    private func n(_ s: String) -> Double { Double(s.replacingOccurrences(of: ",", with: ".")) ?? 0 }

    private var legs: [Leg] {
        guard points.count > 1 else { return [] }
        let tasV = n(tas), wd = n(wdir), ws = n(wspd), vr = n(vari) * (vdir == "E" ? -1 : 1), burnV = n(burn)
        return (1..<points.count).map { i in
            let a = points[i - 1], b = points[i]
            let tt = Geo.bearing(a.point, b.point), d = Geo.nm(a.point, b.point), rel = (wd - tt) * .pi / 180
            let x = tasV > 0 ? ws * sin(rel) / tasV : 0, ok = abs(x) < 1
            let wca = ok ? asin(x) * 180 / .pi : .nan
            let gs = ok ? tasV * cos(wca * .pi / 180) - ws * cos(rel) : .nan
            let th = tt + wca, mh = th + vr, mins = gs > 0 ? d / gs * 60 : .nan
            return Leg(from: a.code.isEmpty ? "TP\(i)" : a.code, to: b.code.isEmpty ? (i == points.count - 1 ? "END" : "TP\(i + 1)") : b.code,
                       tt: tt, d: d, wca: wca, th: th, mh: mh, gs: gs, mins: mins, fuel: mins.isFinite ? burnV * mins / 60 : .nan, ok: ok && gs > 0)
        }
    }

    private func fmtM(_ m: Double) -> String {
        guard m.isFinite else { return "—" }
        let h = Int(m) / 60
        return h > 0 ? "\(h):" + String(format: "%02d", Int(m.rounded()) % 60) : "\(Int(m.rounded())) min"
    }

    var body: some View {
        let L = legs
        let totD = L.reduce(0) { $0 + $1.d }, totM = L.reduce(0) { $0 + ($1.mins.isFinite ? $1.mins : 0) }, totF = L.reduce(0) { $0 + ($1.fuel.isFinite ? $1.fuel : 0) }
        let resFuel = n(burn) * n(reserve) / 60, allFuel = totF + resFuel + n(taxi)
        return Page(title: "Nav log", subtitle: "Plot a route, add the forecast wind, and Boplo works out heading, groundspeed, time and fuel for each leg.") {
            Text("A planning aid for training. Check every figure against your own calculation, your chart and official weather before you fly.")
                .font(.archivo(13.5)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: 0xF5A623).opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            routeTile
            detailsTile
            if points.count > 1 {
                Tile(spacing: 10) {
                    TileHead(title: name.isEmpty ? "Planning log" : name) {
                        Button("Save") { Task { await save() } }.buttonStyle(.pill(.line, height: 34))
                    }
                    ScrollView(.horizontal, showsIndicators: false) {
                        Grid(alignment: .trailing, horizontalSpacing: 14, verticalSpacing: 8) {
                            GridRow {
                                ForEach(["Leg", "TT", "Dist", "WCA", "TH", "MH", "GS", "Time", "Fuel"], id: \.self) { h in
                                    Text(h).font(.archivo(12, .semibold)).foregroundStyle(Theme.ink3).gridColumnAlignment(h == "Leg" ? .leading : .trailing)
                                }
                            }
                            Divider().overlay(Theme.hair).gridCellUnsizedAxes(.horizontal)
                            ForEach(L) { l in
                                GridRow {
                                    Text("\(l.from) → \(l.to)").font(.archivo(13.5, .semibold))
                                    Text(Geo.pad3(l.tt) + "°")
                                    Text(String(format: "%.1f", l.d))
                                    Text(l.wca.isFinite ? (l.wca >= 0 ? "+" : "−") + String(Int(abs(l.wca).rounded())) + "°" : "—")
                                    Text(l.th.isFinite ? Geo.pad3(l.th) + "°" : "—")
                                    Text(l.mh.isFinite ? Geo.pad3(l.mh) + "°" : "—").font(.archivo(13.5, .bold))
                                    Text(l.gs.isFinite ? String(Int(l.gs.rounded())) : "—")
                                    Text(fmtM(l.mins)).font(.archivo(13.5, .bold))
                                    Text(l.fuel.isFinite && n(burn) > 0 ? String(format: "%.1f", l.fuel) : "—")
                                }
                                .font(.archivo(13.5))
                                .monospacedDigit()
                                .foregroundStyle(l.ok ? Theme.ink : Theme.danger)
                            }
                        }
                    }
                    HStack(alignment: .top) {
                        sum("Distance", String(format: "%.1f NM", totD))
                        sum("Flight time", fmtM(totM))
                        sum("Fuel needed", n(burn) > 0 ? String(format: "%.1f %@", allFuel, unit) : "—")
                    }
                    if n(burn) > 0 { Footnote(text: String(format: "Trip %.1f + taxi %.1f + reserve %.1f", totF, n(taxi), resFuel)) }
                    if L.contains(where: { !$0.ok }) { ErrorText(text: "The wind is too strong for this airspeed on at least one leg. Check the wind and TAS.") }
                    Footnote(text: "TT true track · WCA wind correction angle · TH true heading · MH magnetic heading (TH \(vdir == "E" ? "−" : "+") \(vari.isEmpty ? "0" : vari)° variation) · GS groundspeed in knots. Times exclude climb and descent.")
                    ShareLink(item: kneeboard(L, totD: totD, totM: totM, allFuel: allFuel)) { Label("Share kneeboard", systemImage: "square.and.arrow.up") }
                        .buttonStyle(.pill(.ink, height: 40))
                }
            }
            savedTile
            ErrorText(text: error)
        }
        .navigationTitle("Nav log")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if points.isEmpty, let ac = model.profile?.aircraft, !ac.isEmpty, tas == "95" {
                let a = ac.lowercased()
                if a.contains("152") { tas = "90" } else if a.contains("da40") || a.contains("sr20") { tas = "125" }
            }
        }
        .onChange(of: search) { _, t in Task { results = await AirfieldStore.shared.search(t, home: model.countryCode) } }
    }

    private func sum(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            Text(v).font(.archivo(17, .semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Route

    private var routeTile: some View {
        Tile(spacing: 12) {
            TileHead(title: "Route") {
                if !points.isEmpty { Button("Clear") { withAnimation { points = [] } }.font(.archivo(14, .semibold)).foregroundStyle(Theme.ink3) }
            }
            MapReader { proxy in
                Map(position: $camera) {
                    if points.count > 1 {
                        MapPolyline(coordinates: points.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) })
                            .stroke(Theme.electric, lineWidth: 3)
                    }
                    ForEach(Array(points.enumerated()), id: \.element.id) { i, p in
                        Annotation(p.code.isEmpty ? "TP\(i)" : p.code, coordinate: CLLocationCoordinate2D(latitude: p.lat, longitude: p.lng)) {
                            Circle().fill(Theme.night).overlay(Circle().strokeBorder(Theme.ice, lineWidth: 2)).frame(width: 12, height: 12)
                        }
                    }
                }
                .mapStyle(.hybrid(elevation: .flat))
                .onTapGesture { pt in
                    guard addOnTap, let c = proxy.convert(pt, from: .local) else { return }
                    withAnimation { points.append(Waypoint(lat: c.latitude, lng: c.longitude, code: "")) }
                }
            }
            .frame(height: 260)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            Toggle(isOn: $addOnTap) { Text("Tap the map to add turning points").font(.archivo(14)) }
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
                TextField("Add an airfield by code or name", text: $search).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .submitLabel(.done).onSubmit { Task { await addCode(search) } }
            }
            .boploField()
            if !results.isEmpty {
                VStack(spacing: 0) {
                    ForEach(results) { a in
                        Button { add(a) } label: {
                            HStack { Text(a.code).font(.archivo(14.5, .semibold)); Text(a.name).font(.archivo(14)).foregroundStyle(Theme.ink3).lineLimit(1); Spacer() }
                                .padding(.vertical, 8).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if !points.isEmpty {
                ForEach(Array(points.enumerated()), id: \.element.id) { i, p in
                    HStack {
                        Text("\(i + 1)").font(.archivo(12, .semibold)).foregroundStyle(.white).frame(width: 22, height: 22).background(Theme.ink, in: Circle())
                        Text(p.code.isEmpty ? String(format: "%.3f, %.3f", p.lat, p.lng) : p.code).font(.archivo(14.5, .medium))
                        Spacer()
                        Button { withAnimation { _ = points.remove(at: i) } } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3) }
                            .buttonStyle(.plain)
                    }
                }
            }
            let routeFlights = model.sortedFlights.filter { $0.track.count > 1 && $0.track.count <= 40 }
            if !routeFlights.isEmpty {
                Menu {
                    ForEach(routeFlights.prefix(30)) { f in
                        Button("\(Day.short(f.date)) · \(f.dep) → \(f.arr)") {
                            points = f.track.enumerated().map { i, t in Waypoint(lat: t.lat, lng: t.lng, code: i == 0 ? f.dep : i == f.track.count - 1 ? f.arr : "") }
                            camera = .rect(TrackPreview.rect(f.track))
                        }
                    }
                } label: { Label("Start from a flight’s route", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }
                    .font(.archivo(14, .semibold))
            }
        }
    }

    private func add(_ a: Airfield) {
        withAnimation { points.append(Waypoint(lat: a.lat, lng: a.lng, code: a.code)) }
        search = ""; results = []
        camera = .rect(TrackPreview.rect(points.map(\.point)))
    }

    private func addCode(_ raw: String) async {
        if let a = await AirfieldStore.shared.find(raw, home: model.countryCode) { add(a) }
        else if let a = results.first { add(a) }
    }

    // MARK: Details

    private var detailsTile: some View {
        Tile(spacing: 12) {
            TileHead("Flight details")
            Labeled(label: "Plan name (optional)") { TextField("e.g. Lesson 12 nav", text: $name).boploField() }
            HStack(spacing: 8) {
                Labeled(label: "True airspeed (kt)") { TextField("95", text: $tas).keyboardType(.numberPad).boploField() }
                Labeled(label: "Cruise altitude (ft)") { TextField("2400", text: $alt).keyboardType(.numberPad).boploField() }
            }
            HStack(spacing: 8) {
                Labeled(label: "Wind from (°T)") { TextField("250", text: $wdir).keyboardType(.numberPad).boploField() }
                Labeled(label: "Wind speed (kt)") { TextField("15", text: $wspd).keyboardType(.numberPad).boploField() }
            }
            HStack(spacing: 8) {
                Labeled(label: "Variation (°)") { TextField("From your chart", text: $vari).keyboardType(.decimalPad).boploField() }
                Labeled(label: "East or west") {
                    Picker("Variation", selection: $vdir) { Text("West (add)").tag("W"); Text("East (subtract)").tag("E") }
                        .pickerStyle(.segmented)
                }
            }
            HStack(spacing: 8) {
                Labeled(label: "Fuel burn per hour") { TextField("From the POH", text: $burn).keyboardType(.decimalPad).boploField() }
                Labeled(label: "Units") {
                    Picker("Units", selection: $unit) { ForEach(["L", "USG", "IG", "kg"], id: \.self) { Text($0).tag($0) } }.pickerStyle(.segmented)
                }
            }
            HStack(spacing: 8) {
                Labeled(label: "Taxi and run-up fuel") { TextField("0", text: $taxi).keyboardType(.decimalPad).boploField() }
                Labeled(label: "Reserve (minutes)") { TextField("45", text: $reserve).keyboardType(.numberPad).boploField() }
            }
            if points.count > 0 {
                Button("Use wind from the departure METAR") { Task { await metarWind() } }.buttonStyle(.pill(.line, height: 38))
            }
            Footnote(text: note ?? "Wind at height usually differs from the surface report. Use the forecast wind for your cruise level if you have it.")
        }
    }

    private func metarWind() async {
        guard let first = points.first else { return }
        let code = first.code.isEmpty ? model.homeCode : first.code
        do {
            let obj = try await API.shared.object("flight/weather?ids=\(code)&lat=\(first.lat)&lng=\(first.lng)")
            guard let s = (obj["stations"] as? [[String: Any]])?.first, let d = (s["wdir"] as? NSNumber)?.intValue else { note = "No usable wind in the nearest report."; return }
            wdir = String(d); wspd = String((s["wspd"] as? NSNumber)?.intValue ?? 0)
            note = "Surface wind from \(s["id"] as? String ?? code). Wind at height usually differs, so use the forecast for your cruise level if you have it."
        } catch { self.error = error.localizedDescription }
    }

    // MARK: Saved

    private var saved: [[String: Any]] { (model.json("navlogs")["logs"] as? [[String: Any]]) ?? [] }

    @ViewBuilder
    private var savedTile: some View {
        if !saved.isEmpty {
            Tile(spacing: 6) {
                TileHead("Saved plans")
                ForEach(Array(saved.enumerated()), id: \.offset) { i, s in
                    let pts = (s["points"] as? [[String: Any]]) ?? []
                    HStack {
                        Button { load(s) } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(s["name"] as? String ?? "Plan").font(.archivo(15, .semibold)).foregroundStyle(Theme.ink)
                                Text(pts.compactMap { $0["code"] as? String }.filter { !$0.isEmpty }.joined(separator: " → ")).font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading).contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Button { Task { await delete(i) } } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3) }
                            .buttonStyle(.plain)
                    }
                    .padding(.vertical, 6)
                }
            }
        }
    }

    private func inputs() -> [String: Any] {
        ["tas": n(tas), "wdir": wdir, "wspd": wspd, "vari": vari, "vdir": vdir, "burn": burn, "unit": unit, "taxi": taxi, "reserve": n(reserve), "alt": alt]
    }

    private func load(_ s: [String: Any]) {
        name = s["name"] as? String ?? ""
        points = ((s["points"] as? [[String: Any]]) ?? []).compactMap { p in
            guard let lat = (p["lat"] as? NSNumber)?.doubleValue, let lng = (p["lng"] as? NSNumber)?.doubleValue else { return nil }
            return Waypoint(lat: lat, lng: lng, code: p["code"] as? String ?? "")
        }
        let i = s["inp"] as? [String: Any] ?? [:]
        func str(_ k: String) -> String { if let n = i[k] as? NSNumber { return n.stringValue }; return i[k] as? String ?? "" }
        if !str("tas").isEmpty { tas = str("tas") }
        wdir = str("wdir"); wspd = str("wspd"); vari = str("vari"); vdir = str("vdir").isEmpty ? "W" : str("vdir")
        burn = str("burn"); unit = str("unit").isEmpty ? "L" : str("unit"); taxi = str("taxi"); reserve = str("reserve").isEmpty ? "45" : str("reserve"); alt = str("alt")
        if points.count > 0 { camera = .rect(TrackPreview.rect(points.map(\.point))) }
    }

    private func save() async {
        let limit = 1
        let others = saved.filter { ($0["name"] as? String) != name }
        if !model.isAdvanced && others.count >= limit {
            model.upgrade("The Free plan saves \(limit) nav plan. Advanced saves as many as you like.")
            return
        }
        let L = legs
        let title = name.isEmpty ? "\(L.first?.from ?? "") → \(L.last?.to ?? "")" : name
        let entry: [String: Any] = ["name": title, "points": points.map { ["lat": $0.lat, "lng": $0.lng, "code": $0.code] as [String: Any] }, "inp": inputs()]
        var st = model.json("navlogs")
        st["logs"] = Array(([entry] + others).prefix(8))
        do { try await model.saveJSON("navlogs", st); name = title } catch { self.error = error.localizedDescription }
    }

    private func delete(_ i: Int) async {
        var st = model.json("navlogs")
        var logs = saved
        if logs.indices.contains(i) { logs.remove(at: i) }
        st["logs"] = logs
        do { try await model.saveJSON("navlogs", st) } catch { self.error = error.localizedDescription }
    }

    private func kneeboard(_ L: [Leg], totD: Double, totM: Double, allFuel: Double) -> String {
        var lines = [name.isEmpty ? "Planning log" : name, "TAS \(tas) kt · W/V \(wdir.isEmpty ? "—" : wdir)°/\(wspd.isEmpty ? "—" : wspd) kt · Var \(vari.isEmpty ? "0" : vari)°\(vdir)", ""]
        lines.append("Leg            TT   Dist  MH   GS   Time")
        for l in L {
            lines.append("\(l.from) → \(l.to)  \(Geo.pad3(l.tt))  \(String(format: "%.1f", l.d))  \(l.mh.isFinite ? Geo.pad3(l.mh) : "—")  \(l.gs.isFinite ? String(Int(l.gs)) : "—")  \(fmtM(l.mins))")
        }
        lines.append("")
        lines.append(String(format: "Total %.1f NM · %@", totD, fmtM(totM)) + (n(burn) > 0 ? String(format: " · fuel %.1f %@", allFuel, unit) : ""))
        lines.append("Planning aid made with Boplo Flight. Check against your own calculation and official sources.")
        return lines.joined(separator: "\n")
    }
}
