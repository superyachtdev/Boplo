import SwiftUI
import Charts

/// Preflight: weight and balance, runway performance and a weather go/no-go, computed by the web app's
/// own preflight maths (flight-preflight.js) running natively. Settings are saved in the profile like the web.
struct PreflightPage: View {
    @Environment(AppModel.self) private var model

    @State private var ac = "c172"
    @State private var reg = ""
    @State private var loads: [String: String] = [:]
    @State private var fuelStart = ""
    @State private var mins = ""
    @State private var mine: [String: String] = [:]   // emptyW, emptyArm, mtow, burn, fuelArm, fuelUsable, to50, ld50
    @State private var apText = ""
    @State private var airfield: Airfield?
    @State private var ends: [RunwayEnd] = []
    @State private var rw = ""
    @State private var surface = "paved"
    @State private var slope = "0"
    @State private var oat = ""
    @State private var qnh = ""
    @State private var wdir = ""
    @State private var wspd = ""
    @State private var limits: [String: String] = ["wind": "15", "gust": "20", "cross": "10", "visKm": "8", "ceil": "1500"]
    @State private var station: [String: Any]?
    @State private var metarNote: String?
    @State private var loaded = false
    @State private var saveTask: Task<Void, Never>?

    private var js: JSEngine { JSEngine.shared }
    private var types: [String: [String: Any]] { js.value("BoploPreflight.TYPES") as? [String: [String: Any]] ?? [:] }
    private var surfaces: [String: [String: Any]] { js.value("BoploPreflight.SURF") as? [String: [String: Any]] ?? [:] }

    private func numOrEmpty(_ s: String?) -> Any { if let s, let d = Double(s.replacingOccurrences(of: ",", with: ".")) { return d }; return "" }

    private var mineObject: [String: Any] {
        var o: [String: Any] = ["reg": reg]
        for k in ["emptyW", "emptyArm", "mtow", "burn", "fuelArm", "fuelUsable"] { o[k] = numOrEmpty(mine[k]) }
        var perf: [String: Any] = [:]
        if let v = Double(mine["to50"] ?? "") { perf["to50"] = v }
        if let v = Double(mine["ld50"] ?? "") { perf["ld50"] = v }
        o["perf"] = perf
        if let prev = (model.json("preflight")["mine"] as? [String: Any])?[ac] as? [String: Any] {
            if let env = prev["envelope"] { o["envelope"] = env }
            if let arms = prev["arms"] { o["arms"] = arms }
        }
        return o
    }

    private var aircraft: [String: Any] { js.value("BoploPreflight.aircraft(\(JSEngine.lit(ac)), \(JSEngine.lit(mineObject)))") as? [String: Any] ?? [:] }
    private var fuel: [String: Any] { aircraft["fuel"] as? [String: Any] ?? [:] }
    private var units: String { aircraft["units"] as? String ?? "lb" }
    private var armUnit: String { units == "lb" ? "in" : "m" }
    private func d(_ v: Any?) -> Double? { (v as? NSNumber)?.doubleValue }

    private var fuelUsed: Double { (Double(mins) ?? 0) / 60 * (d(fuel["burn"]) ?? 0) }
    private var loadsObject: [String: Any] { loads.compactMapValues { Double($0) } }
    private var wb: [String: Any] {
        js.value("BoploPreflight.wb(BoploPreflight.aircraft(\(JSEngine.lit(ac)), \(JSEngine.lit(mineObject))), \(JSEngine.lit(loadsObject)), \(JSEngine.lit(["start": Double(fuelStart) ?? 0, "burn": fuelUsed])))") as? [String: Any] ?? [:]
    }

    var body: some View {
        Page(title: "Preflight", subtitle: "Weight and balance, runway performance and a weather go/no-go for your next flight, on one page.") {
            Text("A training aid. Use your aircraft’s own weight and balance report and POH, check every figure, and get an official briefing before you fly.")
                .font(.archivo(13.5)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: 0xF5A623).opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            loadingTile
            wbTile
            perfTile
            goTile
        }
        .navigationTitle("Preflight")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: load)
        .onChange(of: snapshot) { _, _ in scheduleSave() }
    }

    /// Everything that's saved, for change tracking.
    private var snapshot: String {
        [ac, reg, fuelStart, mins, apText, rw, surface, slope, oat, qnh, wdir, wspd,
         loads.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ","),
         mine.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ","),
         limits.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value)" }.joined(separator: ",")].joined(separator: "|")
    }

    // MARK: Aircraft and loading

    private var loadingTile: some View {
        let stations = aircraft["stations"] as? [[String: Any]] ?? []
        let fuelUnit = fuel["unit"] as? String ?? ""
        let base = types[ac] ?? [:]
        let baseEmpty = base["empty"] as? [NSNumber] ?? []
        let basePerf = base["perf"] as? [String: Any] ?? [:]
        let baseFuel = base["fuel"] as? [String: Any] ?? [:]
        return Tile(spacing: 12) {
            TileHead("Aircraft and loading")
            Labeled(label: "Aircraft type") {
                Menu {
                    Picker("Aircraft type", selection: $ac) {
                        ForEach(types.keys.sorted { (types[$0]?["name"] as? String ?? $0) < (types[$1]?["name"] as? String ?? $1) }, id: \.self) { k in
                            Text(types[k]?["name"] as? String ?? k).tag(k)
                        }
                    }
                } label: { menuLabel(types[ac]?["name"] as? String ?? ac) }
            }
            .onChange(of: ac) { _, _ in loadMine() }
            Labeled(label: "Registration") { TextField("e.g. G-ABCD", text: $reg).textInputAutocapitalization(.characters).boploField() }
            ForEach(Array(stations.enumerated()), id: \.offset) { _, s in
                let id = s["id"] as? String ?? ""
                let max = d(s["max"])
                Labeled(label: "\(s["label"] as? String ?? id) (\(units))\(max.map { " · max \(Int($0))" } ?? "")") {
                    TextField("0", text: Binding(get: { loads[id] ?? "" }, set: { loads[id] = $0 })).keyboardType(.decimalPad).boploField()
                }
            }
            HStack(spacing: 8) {
                Labeled(label: "Fuel at start (\(fuelUnit))") { TextField(d(fuel["usable"]).map { "max \($0.clean)" } ?? "0", text: $fuelStart).keyboardType(.decimalPad).boploField() }
                Labeled(label: "Flight time (min)") { TextField("60", text: $mins).keyboardType(.numberPad).boploField() }
            }
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 10) {
                    Footnote(text: "From the aircraft’s weight and balance report and POH. Arms in \(armUnit), weights in \(units). Blank fields use typical \(base["source"] as? String ?? "type") figures.")
                    HStack(spacing: 8) {
                        mineField("Empty weight (\(units))", "emptyW", baseEmpty.first?.stringValue)
                        mineField("Empty CG arm (\(armUnit))", "emptyArm", baseEmpty.count > 1 ? baseEmpty[1].stringValue : nil)
                    }
                    HStack(spacing: 8) {
                        mineField("Max take-off (\(units))", "mtow", d(base["mtow"])?.clean)
                        mineField("Fuel burn (\(fuelUnit)/h)", "burn", d(baseFuel["burn"])?.clean)
                    }
                    HStack(spacing: 8) {
                        mineField("Fuel arm (\(armUnit))", "fuelArm", d(baseFuel["arm"])?.clean)
                        mineField("Usable fuel (\(fuelUnit))", "fuelUsable", d(baseFuel["usable"])?.clean)
                    }
                    HStack(spacing: 8) {
                        mineField("Take-off to 50 ft (m)", "to50", d(basePerf["to50"])?.clean)
                        mineField("Landing from 50 ft (m)", "ld50", d(basePerf["ld50"])?.clean)
                    }
                }
                .padding(.top, 8)
            } label: {
                HStack {
                    Text("Your aircraft’s figures").font(.archivo(15, .semibold))
                    Spacer()
                    Chip(text: (mine["emptyW"] ?? "").isEmpty ? "Using typical figures" : "Entered", tone: (mine["emptyW"] ?? "").isEmpty ? .plain : .ok)
                }
            }
            .tint(Theme.ink)
        }
    }

    private func mineField(_ label: String, _ key: String, _ placeholder: String?) -> some View {
        Labeled(label: label) {
            TextField(placeholder ?? "", text: Binding(get: { mine[key] ?? "" }, set: { mine[key] = $0 })).keyboardType(.decimalPad).boploField()
        }
    }

    private func menuLabel(_ text: String) -> some View {
        HStack {
            Text(text).font(.archivo(16)).foregroundStyle(Theme.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3)
        }
        .boploField()
    }

    // MARK: Weight and balance

    private struct EnvPoint: Identifiable { let id: Int; let arm: Double; let w: Double }

    private var wbTile: some View {
        let r = wb
        let rows = (r["rows"] as? [[String: Any]] ?? []).filter { (d($0["w"]) ?? 0) != 0 || ($0["id"] as? String) == "empty" }
        let issues = r["issues"] as? [[String: Any]] ?? []
        let ok = r["ok"] as? Bool ?? false
        let bad = issues.contains { $0["bad"] as? Bool == true }
        let env = (aircraft["envelope"] as? [[NSNumber]] ?? []).enumerated().map { EnvPoint(id: $0.offset, arm: $0.element.first?.doubleValue ?? 0, w: $0.element.count > 1 ? $0.element[1].doubleValue : 0) }
        let W = d(r["W"]) ?? 0, cg = d(r["cg"]) ?? 0, lw = d(r["lw"]) ?? 0, lcg = d(r["lcg"]) ?? 0
        let fmtArm: (Double?) -> String = { v in v.map { String(format: self.armUnit == "m" ? "%.3f" : "%.1f", $0) } ?? "—" }
        return Tile(spacing: 12) {
            TileHead(title: "Weight and balance") { Chip(text: ok ? "Within limits" : bad ? "Out of limits" : "Needs figures", tone: ok ? .ok : bad ? .bad : .plain) }
            Grid(alignment: .trailing, horizontalSpacing: 12, verticalSpacing: 8) {
                GridRow {
                    Text("Item").gridColumnAlignment(.leading); Text("Weight"); Text("Arm"); Text("Moment")
                }
                .font(.archivo(12, .semibold)).foregroundStyle(Theme.ink3)
                ForEach(Array(rows.enumerated()), id: \.offset) { _, x in
                    GridRow {
                        Text(x["label"] as? String ?? "").gridColumnAlignment(.leading).lineLimit(2)
                        Text("\(Int((d(x["w"]) ?? 0).rounded()))")
                        Text(fmtArm(d(x["arm"])))
                        Text(d(x["m"]).map { String(Int($0.rounded())) } ?? "—")
                    }
                    .font(.archivo(13.5))
                }
                Divider().overlay(Theme.hair).gridCellUnsizedAxes(.horizontal)
                GridRow {
                    Text("Take-off").gridColumnAlignment(.leading); Text("\(Int(W.rounded())) \(units)"); Text(fmtArm(cg)).fontWeight(.bold); Text("")
                }
                .font(.archivo(13.5, .semibold))
                GridRow {
                    Text("Landing").gridColumnAlignment(.leading); Text("\(Int(lw.rounded())) \(units)"); Text(fmtArm(lcg)).fontWeight(.bold); Text("")
                }
                .font(.archivo(13.5, .semibold))
            }
            .monospacedDigit()
            if env.count >= 3 {
                Chart {
                    ForEach(env + [env[0]].map { EnvPoint(id: 999, arm: $0.arm, w: $0.w) }) { p in
                        LineMark(x: .value("Arm", p.arm), y: .value("Weight", p.w), series: .value("s", "env"))
                            .foregroundStyle(Theme.electric.opacity(0.6))
                    }
                    LineMark(x: .value("Arm", cg), y: .value("Weight", W), series: .value("s", "burn")).foregroundStyle(Theme.ink3)
                    LineMark(x: .value("Arm", lcg), y: .value("Weight", lw), series: .value("s", "burn")).foregroundStyle(Theme.ink3)
                    PointMark(x: .value("Arm", cg), y: .value("Weight", W)).foregroundStyle(r["toIn"] as? Bool == false ? Theme.danger : Theme.electric).symbolSize(120)
                        .annotation(position: .topTrailing) { Text("Take-off").font(.archivo(11, .semibold)) }
                    PointMark(x: .value("Arm", lcg), y: .value("Weight", lw)).foregroundStyle(r["ldIn"] as? Bool == false ? Theme.danger : Theme.ok).symbolSize(80)
                        .annotation(position: .bottomTrailing) { Text("Landing").font(.archivo(11, .semibold)) }
                }
                .chartXScale(domain: .automatic(includesZero: false))
                .chartYScale(domain: .automatic(includesZero: false))
                .chartXAxisLabel("CG arm (\(armUnit))")
                .chartYAxisLabel("Weight (\(units))")
                .frame(height: 220)
            }
            ForEach(Array(issues.enumerated()), id: \.offset) { _, i in
                Label(i["t"] as? String ?? "", systemImage: i["bad"] as? Bool == true ? "exclamationmark.triangle.fill" : "info.circle")
                    .font(.archivo(13.5)).foregroundStyle(i["bad"] as? Bool == true ? Theme.danger : Theme.ink2)
            }
            if let mtow = d(aircraft["mtow"]) {
                Footnote(text: "Max take-off weight \(Int(mtow)) \(units). Useful load left: \(Int(max(0, mtow - W))) \(units).")
            }
        }
    }

    // MARK: Runway performance

    private var conditions: [String: Any] { ["surface": surface, "slope": Double(slope) ?? 0, "oat": numOrEmpty(oat), "qnh": numOrEmpty(qnh), "wdir": numOrEmpty(wdir), "wspd": numOrEmpty(wspd)] }

    private var end: RunwayEnd? { ends.first { $0.id == rw } ?? ends.first }

    private var perfTile: some View {
        let e = end
        let comp = js.value("BoploPreflight.components(\(e?.heading ?? 0), \(JSEngine.lit(Double(wdir))), \(Double(wspd) ?? 0))") as? [String: Any] ?? [:]
        let head = d(comp["head"]) ?? 0, cross = d(comp["cross"]) ?? 0, from = comp["from"] as? String ?? ""
        let loaded = loadsObject.values.contains { ($0 as? Double ?? 0) > 0 } || (Double(fuelStart) ?? 0) > 0
        let weight = loaded ? (d(wb["W"]) ?? 0) : (d(aircraft["mtow"]) ?? 0)
        let c: [String: Any] = ["elevFt": airfield?.elevationFt ?? 0, "qnh": numOrEmpty(qnh), "oat": numOrEmpty(oat), "surface": surface, "slope": Double(slope) ?? 0, "head": head, "weight": weight]
        let pf = js.value("BoploPreflight.performance(BoploPreflight.aircraft(\(JSEngine.lit(ac)), \(JSEngine.lit(mineObject))), \(JSEngine.lit(c)))") as? [String: Any]
        let to = pf?["to"] as? [String: Any] ?? [:], ld = pf?["ld"] as? [String: Any] ?? [:]
        let toReq = d(to["req"]) ?? 0, ldReq = d(ld["req"]) ?? 0
        let toOK = (e?.length ?? 0) > 0 ? toReq <= e!.length : nil
        let ldOK = (e?.lda ?? 0) > 0 ? ldReq <= e!.lda : nil
        return Tile(spacing: 12) {
            TileHead(title: "Runway performance") {
                if let toOK, let ldOK { Chip(text: toOK && ldOK ? "Runway long enough" : "Runway too short", tone: toOK && ldOK ? .ok : .bad) }
            }
            Labeled(label: "Airfield") {
                TextField("Code, e.g. EGHP", text: $apText).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .submitLabel(.done).onSubmit { Task { await loadAirfield() } }.boploField()
            }
            if let af = airfield {
                Text("\(af.name) · elevation \(Int(af.elevationFt)) ft").font(.archivo(13)).foregroundStyle(Theme.ink3)
            }
            if !ends.isEmpty {
                Labeled(label: "Runway") {
                    Picker("Runway", selection: $rw) { ForEach(ends) { Text("\($0.id) · \(Int($0.length)) m").tag($0.id) } }.pickerStyle(.menu).tint(Theme.ink)
                }
            }
            Labeled(label: "Surface") {
                Picker("Surface", selection: $surface) {
                    ForEach(["paved", "paved-wet", "grass", "grass-wet", "grass-long"], id: \.self) { k in Text(surfaces[k]?["label"] as? String ?? k).tag(k) }
                }
                .pickerStyle(.menu).tint(Theme.ink)
            }
            HStack(spacing: 8) {
                Labeled(label: "Slope (% up)") { TextField("0", text: $slope).keyboardType(.numbersAndPunctuation).boploField() }
                Labeled(label: "Temp (°C)") { TextField("15", text: $oat).keyboardType(.numbersAndPunctuation).boploField() }
                Labeled(label: "QNH (hPa)") { TextField("1013", text: $qnh).keyboardType(.numberPad).boploField() }
            }
            HStack(spacing: 8) {
                Labeled(label: "Wind from (°)") { TextField("250", text: $wdir).keyboardType(.numberPad).boploField() }
                Labeled(label: "Wind (kt)") { TextField("10", text: $wspd).keyboardType(.numberPad).boploField() }
            }
            Button("Use the live METAR") { Task { await useMetar() } }.buttonStyle(.pill(.line, height: 38)).disabled(airfield == nil)
            if let metarNote { Footnote(text: metarNote) }
            if let pf {
                HStack(alignment: .top) {
                    stat("Pressure alt", "\(Int((d(pf["pa"]) ?? 0).rounded())) ft")
                    stat("Density alt", "\(Int((d(pf["da"]) ?? 0).rounded())) ft")
                    stat("Rwy \(e?.id ?? "—") wind", "\(head >= 0 ? "\(Int(head.rounded())) head" : "\(Int((-head).rounded())) TAIL") · \(Int(cross.rounded())) x\(from.isEmpty ? "" : " " + from.prefix(1).uppercased())")
                }
                perfBlock("Take-off", to, roll: "Ground roll", dist: "To 50 ft", sf: (pf["sf"] as? [String: Any])?["to"], avail: e?.length)
                perfBlock("Landing", ld, roll: "Ground roll", dist: "From 50 ft", sf: (pf["sf"] as? [String: Any])?["ld"], avail: e?.lda)
                Footnote(text: "Corrections from the UK CAA’s Safety Sense 7 (altitude, temperature, surface, slope and the recommended safety factors), weight by (weight ÷ max weight)², wind by the usual POH rule: 10% less per 9 kt headwind, 10% more per 2 kt tailwind. Always check against your POH charts.")
            } else {
                Text("Add your POH take-off and landing distances under “Your aircraft’s figures”.").font(.archivo(14)).foregroundStyle(Theme.ink3)
            }
        }
    }

    private func stat(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.archivo(12)).foregroundStyle(Theme.ink3)
            Text(v).font(.archivo(14.5, .semibold)).lineLimit(2).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func perfBlock(_ title: String, _ x: [String: Any], roll: String, dist: String, sf: Any?, avail: Double?) -> some View {
        let req = d(x["req"]) ?? 0
        let steps = (x["steps"] as? [[Any]] ?? []).compactMap { s -> (String, Double)? in
            guard s.count == 2, let l = s[0] as? String, let f = (s[1] as? NSNumber)?.doubleValue, abs(f - 1) > 0.005 else { return nil }
            return (l, f)
        }
        return VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.archivo(16, .semibold))
            HStack(alignment: .top) {
                stat(roll, "\(Int((d(x["roll"]) ?? 0).rounded())) m")
                stat(dist, "\(Int((d(x["d50"]) ?? 0).rounded())) m")
                stat("With factor ×\((sf as? NSNumber)?.stringValue ?? "")", "\(Int(req.rounded())) m")
            }
            if let avail, avail > 0 {
                Bar(value: req / avail, height: 8, fill: req > avail ? Theme.danger : req > avail * 0.85 ? Color(hex: 0xE0A21B) : Theme.ok)
                Text("\(Int(req.rounded())) m needed of \(Int(avail.rounded())) m available (\(Int(abs(avail - req).rounded())) m \(req > avail ? "short" : "spare"))")
                    .font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            }
            ForEach(Array(steps.enumerated()), id: \.offset) { _, s in
                HStack { Text(s.0).font(.archivo(13)).foregroundStyle(Theme.ink2); Spacer(); Text(String(format: "×%.2f", s.1)).font(.archivo(13, .semibold)) }
            }
        }
        .padding(14)
        .background(Theme.well, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    // MARK: Go / no-go

    private var goTile: some View {
        let st = station
        let facts = st.flatMap { js.value("BoploPreflight.metarFacts(\(JSEngine.lit($0)))") as? [String: Any] }
        let e = end
        var xw: Double? = nil
        if let f = facts, let e {
            let spd = max(d(f["wspd"]) ?? 0, d(f["gust"]) ?? 0)
            xw = d((js.value("BoploPreflight.components(\(e.heading), \(JSEngine.lit(d(f["wdir"]))), \(spd))") as? [String: Any])?["cross"])
        }
        let limitsObj = limits.compactMapValues { Double($0) }
        let mm = facts.flatMap { js.value("BoploPreflight.minimums(\(JSEngine.lit(limitsObj)), \(JSEngine.lit($0)), \(JSEngine.lit(xw)))") as? [String: Any] }
        let worst = mm?["worst"] as? String
        let sun = airfield.flatMap { js.value("BoploPreflight.sun(\($0.lat), \($0.lng), \(JSEngine.lit(Day.todayISO)))") as? [String: Any] }
        return Tile(spacing: 12) {
            TileHead(title: "Weather go / no-go") {
                if let worst { Chip(text: worst == "go" ? "Within your minimums" : worst == "caution" ? "Close to your minimums" : "Outside your minimums", tone: worst == "go" ? .ok : worst == "caution" ? .warn : .bad) }
            }
            HStack(spacing: 8) {
                limitField("Max wind (kt)", "wind")
                limitField("Max gust (kt)", "gust")
                limitField("Max cross (kt)", "cross")
            }
            HStack(spacing: 8) {
                limitField("Min vis (km)", "visKm")
                limitField("Min ceiling (ft)", "ceil")
            }
            Footnote(text: "Your personal minimums. Agree them with your instructor; they’re checked against the latest METAR for the airfield above.")
            if let st {
                ForEach(Array(((mm?["rows"] as? [[String: Any]]) ?? []).enumerated()), id: \.offset) { _, r in
                    let s = r["state"] as? String ?? "go"
                    HStack {
                        Circle().fill(s == "go" ? Theme.ok : s == "caution" ? Color(hex: 0xE0A21B) : Theme.danger).frame(width: 10, height: 10)
                        Text(r["label"] as? String ?? "").font(.archivo(14.5))
                        Spacer()
                        Text(r["value"] as? String ?? "").font(.archivo(14.5, .semibold))
                        Text("limit \(r["limit"] as? String ?? "")").font(.archivo(12)).foregroundStyle(Theme.ink3)
                    }
                }
                Text(st["raw"] as? String ?? "").font(.system(size: 13, design: .monospaced)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                NavigationLink(value: Route.web(.weather)) { Text("Decode it on the Weather page").font(.archivo(13.5, .semibold)).foregroundStyle(Theme.electric) }
            } else {
                Text(airfield == nil ? "Choose an airfield above." : "Tap “Use the live METAR” to check the weather.").font(.archivo(14)).foregroundStyle(Theme.ink3)
            }
            if let sun {
                HStack(alignment: .top) {
                    stat("Sunrise", time(sun["rise"]))
                    stat("Sunset", time(sun["set"]))
                    stat("Civil dusk", time(sun["dusk"]))
                }
            }
            if let link = notamLink {
                Link(destination: URL(string: link.1)!) { Label(link.0, systemImage: "arrow.up.right") }.font(.archivo(14, .semibold))
            }
            Footnote(text: "Times are your phone’s local time for today. Check NOTAMs, the TAF and any airfield restrictions in your official briefing.")
        }
    }

    private func limitField(_ label: String, _ key: String) -> some View {
        Labeled(label: label) { TextField("", text: Binding(get: { limits[key] ?? "" }, set: { limits[key] = $0 })).keyboardType(.decimalPad).boploField() }
    }

    private func time(_ v: Any?) -> String {
        guard let s = v as? String, let d = ISO8601DateFormatter.withFraction.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return "—" }
        return d.formatted(date: .omitted, time: .shortened)
    }

    private var notamLink: (String, String)? {
        let links = ["ES": ("ENAIRE NOTAM briefing (ICARO)", "https://notampib.enaire.es/"), "GB": ("NATS AIS pre-flight briefing", "https://nats-uk.ead-it.com/cms-nats/opencms/en/Pre-flight-briefing/"),
                     "US": ("FAA NOTAM Search", "https://notams.aim.faa.gov/notamSearch/"), "FR": ("SIA NOTAM (SOFIA)", "https://sofia-briefing.aviation-civile.gouv.fr/"),
                     "DE": ("DFS AIS", "https://secais.dfs.de/"), "IE": ("IAA NOTAM", "https://www.airnav.ie/"), "AU": ("Airservices NAIPS", "https://www.airservicesaustralia.com/naips/"),
                     "CA": ("NAV CANADA CFPS", "https://plan.navcanada.ca/"), "NZ": ("Airways IFIS", "https://www.ifis.airways.co.nz/")]
        guard let af = airfield else { return nil }
        return links[af.country] ?? ("EUROCONTROL EAD basic", "https://www.ead.eurocontrol.int/")
    }

    // MARK: Data

    private func load() {
        guard !loaded else { return }
        let S = model.json("preflight")
        ac = S["ac"] as? String ?? guessType(model.profile?.aircraft)
        loads = ((S["loads"] as? [String: Any]) ?? [:]).mapValues { ($0 as? NSNumber)?.stringValue ?? ($0 as? String ?? "") }
        let f = S["fuel"] as? [String: Any] ?? [:]
        fuelStart = (f["start"] as? NSNumber)?.stringValue ?? (f["start"] as? String ?? "")
        mins = (f["mins"] as? NSNumber)?.stringValue ?? (f["mins"] as? String ?? "")
        if let m = S["mins"] as? [String: Any] { limits = m.mapValues { ($0 as? NSNumber)?.stringValue ?? ($0 as? String ?? "") } }
        let c = S["cond"] as? [String: Any] ?? [:]
        func cs(_ k: String) -> String { (c[k] as? NSNumber)?.stringValue ?? (c[k] as? String ?? "") }
        rw = cs("rw"); surface = cs("surface").isEmpty ? "paved" : cs("surface"); slope = cs("slope").isEmpty ? "0" : cs("slope")
        oat = cs("oat"); qnh = cs("qnh"); wdir = cs("wdir"); wspd = cs("wspd")
        apText = (S["ap"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? model.homeCode
        loadMine()
        Task { await loadAirfield(); loaded = true }
    }

    private func loadMine() {
        let all = (model.json("preflight")["mine"] as? [String: Any]) ?? [:]
        let m = all[ac] as? [String: Any] ?? [:]
        func s(_ v: Any?) -> String { (v as? NSNumber)?.stringValue ?? (v as? String ?? "") }
        reg = s(m["reg"]).isEmpty ? (model.profile?.registration ?? "") : s(m["reg"])
        var out: [String: String] = [:]
        for k in ["emptyW", "emptyArm", "mtow", "burn", "fuelArm", "fuelUsable"] { out[k] = s(m[k]) }
        let perf = m["perf"] as? [String: Any] ?? [:]
        out["to50"] = s(perf["to50"]); out["ld50"] = s(perf["ld50"])
        mine = out
    }

    private func guessType(_ a: String?) -> String {
        let a = (a ?? "").lowercased()
        if a.contains("152") { return "c152" }
        if a.contains("172") { return "c172" }
        if a.contains("pa28") || a.contains("pa-28") || a.contains("warrior") || a.contains("archer") || a.contains("cherokee") { return "pa28" }
        if a.contains("da40") || a.contains("da-40") { return "da40" }
        if a.contains("da20") || a.contains("katana") { return "da20" }
        if a.contains("p2008") || a.contains("tecnam") { return "p2008" }
        if a.contains("dr400") || a.contains("robin") { return "dr400" }
        if a.contains("sr20") || a.contains("cirrus") { return "sr20" }
        if a.contains("cub") { return "cub" }
        return "c172"
    }

    private func loadAirfield() async {
        guard let af = await AirfieldStore.shared.find(apText, home: model.countryCode) else { airfield = nil; ends = []; return }
        airfield = af
        ends = await AirfieldStore.shared.runwayEnds(af)
        if !ends.contains(where: { $0.id == rw }) { rw = ends.first?.id ?? "" }
        if let s = ends.first(where: { $0.id == rw })?.surface.lowercased(), !s.isEmpty {
            let paved = ["asp", "con", "pav", "bit", "tar", "pem", "cop"].contains { s.contains($0) }
            if !paved && surface.hasPrefix("paved") { surface = "grass" }
        }
    }

    private func useMetar() async {
        guard let af = airfield else { return }
        do {
            let obj = try await API.shared.object("flight/weather?ids=\(af.code)&lat=\(af.lat)&lng=\(af.lng)")
            guard let st = (obj["stations"] as? [[String: Any]])?.first else { metarNote = "No weather report found near this airfield."; return }
            station = st
            if let v = (st["wdir"] as? NSNumber)?.intValue { wdir = String(v) }
            if let v = (st["wspd"] as? NSNumber)?.intValue { wspd = String(v) }
            if let v = (st["temp"] as? NSNumber)?.doubleValue { oat = v.clean }
            if let v = (st["altim"] as? NSNumber)?.doubleValue { qnh = String(Int(v.rounded())) }
            let id = st["id"] as? String ?? ""
            metarNote = id == af.code ? "From \(id)’s latest METAR." : "From \(id), the nearest report, \((st["dist"] as? NSNumber)?.intValue ?? 0) NM away."
        } catch { metarNote = error.localizedDescription }
    }

    private func scheduleSave() {
        guard loaded else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 900_000_000)
            guard !Task.isCancelled else { return }
            var S = model.json("preflight")
            S["ac"] = ac
            var all = (S["mine"] as? [String: Any]) ?? [:]
            all[ac] = mineObject
            S["mine"] = all
            S["loads"] = loadsObject
            S["fuel"] = ["start": Double(fuelStart) ?? "", "mins": Double(mins) ?? ""] as [String: Any]
            S["mins"] = limits.compactMapValues { Double($0) }
            var c = conditions; c["rw"] = rw
            S["cond"] = c
            S["ap"] = apText
            try? await model.saveJSON("preflight", S)
        }
    }
}

extension ISO8601DateFormatter {
    static let withFraction: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}
