import SwiftUI

/// METAR and TAF for any airfield, with every group explained (same decoder as the web app).
struct WeatherPage: View {
    var initial: String? = nil
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var loading = false
    @State private var error: String?
    @State private var stations: [[String: Any]] = []
    @State private var exact = true
    @State private var source = ""
    @State private var airfield: Airfield?
    @State private var ends: [RunwayEnd] = []
    @State private var hideDecode = false
    @State private var searched = ""

    var body: some View {
        Page(title: "Weather", subtitle: "Look up the live METAR and TAF for any airport or airfield, with every group explained.") {
            HStack(spacing: 8) {
                HStack(spacing: 10) {
                    Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
                    TextField("ICAO code, e.g. EGLL, KJFK", text: $query)
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                        .submitLabel(.search).onSubmit { Task { await load(query) } }
                        .font(.archivo(15.5))
                }
                .padding(.horizontal, 16).frame(height: 48)
                .background(Theme.paper, in: Capsule()).overlay(Capsule().strokeBorder(Theme.hair))
                Button("Get") { Task { await load(query) } }.buttonStyle(.pill(.blue, height: 48))
            }
            if !model.homeCode.isEmpty && searched != model.homeCode {
                Button("\(model.homeCode) (home)") { query = ""; Task { await load(model.homeCode) } }.buttonStyle(.pill(.line, height: 36))
            }
            Text("A learning tool, not a weather briefing. Before any flight, get an official briefing and talk to your instructor.")
                .font(.archivo(13.5)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(hex: 0xF5A623).opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            if loading {
                Tile { HStack { ProgressView(); Text("Fetching the latest reports…").font(.archivo(14.5)).foregroundStyle(Theme.ink3) } }
            } else if let error {
                Tile {
                    Text("Weather reports didn’t load.").font(.archivo(17, .semibold))
                    Text(error).font(.archivo(14)).foregroundStyle(Theme.ink3)
                    Button("Try again") { Task { await load(searched) } }.buttonStyle(.pill(.line, height: 40))
                }
            } else if searched.isEmpty {
                Tile {
                    Text("Search for an airfield.").font(.archivo(17, .semibold))
                    Text("Type an ICAO code like EGLL or KJFK, or set your home airfield in your profile.").font(.archivo(14)).foregroundStyle(Theme.ink3)
                }
            } else if stations.isEmpty {
                Tile {
                    Text("No reports for \(searched).").font(.archivo(17, .semibold))
                    Text(airfield.map { "\($0.name) doesn’t publish a METAR and there are no reporting stations within about 200 NM." } ?? "We couldn’t find a METAR for \(searched). Check the code, or try a larger airport nearby.")
                        .font(.archivo(14)).foregroundStyle(Theme.ink3)
                }
            } else {
                if !exact {
                    Text("\(airfield?.name ?? searched) doesn’t publish its own METAR. These are the nearest stations that do.")
                        .font(.archivo(13.5)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.electric.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                ForEach(Array(stations.enumerated()), id: \.offset) { i, s in station(s, first: i == 0) }
                Footnote(text: "Live data from \(source).")
            }
        }
        .task { if searched.isEmpty { await load(initial ?? model.homeCode) } }
    }

    private func station(_ s: [String: Any], first: Bool) -> some View {
        let id = s["id"] as? String ?? ""
        let raw = s["raw"] as? String ?? ""
        let taf = s["taf"] as? String ?? ""
        let dist = (s["dist"] as? NSNumber)?.intValue ?? 0
        let cat = s["fltCat"] as? String ?? ""
        let wdir = (s["wdir"] as? NSNumber)?.doubleValue
        let wspd = (s["wspd"] as? NSNumber)?.doubleValue ?? 0
        return Tile(spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(id).font(.archivo(20, .semibold))
                Text([s["name"] as? String ?? "", dist > 0 ? "\(dist) NM away" : ""].filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.archivo(13)).foregroundStyle(Theme.ink3).lineLimit(1)
                Spacer()
                if !cat.isEmpty { Chip(text: cat, tone: cat == "VFR" ? .ok : cat == "MVFR" ? .blue : .bad) }
            }
            Text(raw).font(.system(size: 14, design: .monospaced)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).textSelection(.enabled)
            if first { Toggle("Try reading it yourself first", isOn: $hideDecode).font(.archivo(14)) }
            if !(first && hideDecode) { decodeList(MetarDecoder.decodeAll(raw)) }
            if let wdir, wspd > 0, !ends.isEmpty, let af = airfield {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Wind on \(af.code) runways").font(.archivo(15, .semibold))
                    ForEach(uniqueEnds, id: \.self) { rw in
                        let a = (wdir - Double(rw) * 10) * .pi / 180
                        let head = Int((cos(a) * wspd).rounded()), cross = Int((sin(a) * wspd).rounded())
                        HStack {
                            Text("Runway \(String(format: "%02d", rw))").font(.archivo(14, .semibold))
                            Spacer()
                            Text("\(head >= 0 ? "\(head) kt headwind" : "\(-head) kt tailwind") · \(abs(cross)) kt cross from the \(cross >= 0 ? "right" : "left")")
                                .font(.archivo(13.5)).foregroundStyle(head < 0 ? Theme.danger : Theme.ink2)
                        }
                    }
                    Footnote(text: "Practice maths using \(id)’s wind (true) on \(af.code)’s runways (magnetic), so it’s approximate.\(dist > 0 ? " Wind \(dist) NM away can differ." : "")")
                }
            }
            if !taf.isEmpty {
                DisclosureGroup {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(taf).font(.system(size: 13.5, design: .monospaced)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        decodeList(MetarDecoder.decodeAll(taf))
                    }
                    .padding(.top, 8)
                } label: { Text("Forecast (TAF)").font(.archivo(15, .semibold)) }
                .tint(Theme.ink)
            }
        }
    }

    private var uniqueEnds: [Int] {
        var seen = Set<Int>(), out: [Int] = []
        for e in ends { if let n = Int(e.id.prefix(2)), !seen.contains(n) { seen.insert(n); out.append(n) } }
        return out
    }

    private func decodeList(_ rows: [(String, String, String)]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(r.0).font(.system(size: 13, weight: .semibold, design: .monospaced)).foregroundStyle(Theme.electric)
                        .frame(width: 96, alignment: .leading).lineLimit(2).minimumScaleFactor(0.7)
                    (Text(r.1.isEmpty ? "Code " : r.1 + " ").font(.archivo(14, .semibold)) + Text(r.2.isEmpty ? "Not decoded here." : r.2).font(.archivo(14)).foregroundColor(Theme.ink2))
                }
            }
        }
    }

    private func load(_ raw: String) async {
        let q = raw.trimmingCharacters(in: .whitespaces).uppercased()
        guard !q.isEmpty else { searched = ""; return }
        loading = true; error = nil
        defer { loading = false }
        var code = AirfieldStore.code(q)
        if !(code.count >= 3 && code.count <= 4 && code.allSatisfy({ $0.isLetter || $0.isNumber })) {
            if let hit = await AirfieldStore.shared.search(q, home: model.countryCode).first { code = hit.code }
        }
        searched = code
        airfield = await AirfieldStore.shared.find(code, home: model.countryCode)
        var path = "flight/weather?ids=\(code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code)"
        if let a = airfield { path += "&lat=\(a.lat)&lng=\(a.lng)" }
        do {
            let obj = try await API.shared.object(path)
            stations = obj["stations"] as? [[String: Any]] ?? []
            exact = obj["exact"] as? Bool ?? true
            source = obj["source"] as? String ?? ""
            if let a = airfield { ends = await AirfieldStore.shared.runwayEnds(a) } else { ends = [] }
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// METAR/TAF group decoder, ported from the web app.
enum MetarDecoder {
    static let cloud = ["FEW": "Few (1–2 oktas)", "SCT": "Scattered (3–4 oktas)", "BKN": "Broken (5–7 oktas)", "OVC": "Overcast (8 oktas)", "NSC": "No significant cloud", "SKC": "Sky clear", "CLR": "Clear below 12,000 ft", "NCD": "No cloud detected", "VV": "Vertical visibility (sky obscured)"]
    static let wx = ["RA": "rain", "DZ": "drizzle", "SN": "snow", "SG": "snow grains", "GR": "hail", "GS": "small hail", "PL": "ice pellets", "BR": "mist", "FG": "fog", "HZ": "haze", "FU": "smoke", "DU": "dust", "SA": "sand", "SQ": "squalls", "FC": "funnel cloud", "TS": "thunderstorm", "SH": "showers", "FZ": "freezing", "MI": "shallow", "BC": "patches", "PR": "partial", "DR": "drifting", "BL": "blowing", "VC": "in the vicinity", "UP": "unknown precipitation"]

    private static func m(_ t: String, _ pattern: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern), let r = re.firstMatch(in: t, range: NSRange(t.startIndex..., in: t)) else { return nil }
        return (0..<r.numberOfRanges).map { i in Range(r.range(at: i), in: t).map { String(t[$0]) } ?? "" }
    }
    private static func grouped(_ n: Int) -> String { n.formatted(.number.grouping(.automatic)) }

    static func token(_ t: String, _ i: Int) -> (String, String)? {
        if i == 0, m(t, "^[A-Z]{4}$") != nil { return ("Station", "\(t) is the reporting airfield’s ICAO code.") }
        if let g = m(t, "^(\\d{2})(\\d{2})(\\d{2})Z$") { return ("Time", "Observed on day \(Int(g[1]) ?? 0) at \(g[2]):\(g[3]) UTC.") }
        if t == "AUTO" { return ("Automatic", "Made by an automatic station without a human observer.") }
        if t == "COR" { return ("Corrected", "A corrected report.") }
        if let g = m(t, "^(\\d{3}|VRB)(\\d{2,3})(?:G(\\d{2,3}))?(KT|MPS)$") {
            return ("Wind", "\(g[1] == "VRB" ? "Variable direction" : "From \(g[1])° true") at \(Int(g[2]) ?? 0) \(g[4] == "KT" ? "knots" : "m/s")\(g[3].isEmpty ? "" : ", gusting \(Int(g[3]) ?? 0)").")
        }
        if let g = m(t, "^(\\d{3})V(\\d{3})$") { return ("Wind varies", "Direction varying between \(g[1])° and \(g[2])°.") }
        if t == "CAVOK" { return ("CAVOK", "Visibility 10 km or more, no cloud below 5,000 ft (or MSA), no CB or TCU, no significant weather.") }
        if t == "9999" { return ("Visibility", "10 km or more.") }
        if m(t, "^\\d{4}$") != nil { return ("Visibility", "\(grouped(Int(t) ?? 0)) metres.") }
        if t == "P6SM" { return ("Visibility", "More than 6 statute miles.") }
        if let g = m(t, "^(\\d{1,2}(?:/\\d)?|\\d \\d/\\d)SM$") { return ("Visibility", "\(g[1]) statute miles.") }
        if let g = m(t, "^(FEW|SCT|BKN|OVC|VV)(\\d{3})(CB|TCU)?$") {
            return ("Cloud", "\(cloud[g[1]] ?? g[1]) at \(grouped((Int(g[2]) ?? 0) * 100)) ft above the airfield\(g[3].isEmpty ? "" : ", \(g[3] == "CB" ? "cumulonimbus (thunderstorm cloud)" : "towering cumulus")").")
        }
        if let c = cloud[t] { return ("Cloud", c + ".") }
        if let g = m(t, "^(M?\\d{2})/(M?\\d{2})?$") {
            func c(_ s: String) -> Int? { s.isEmpty ? nil : (s.hasPrefix("M") ? -(Int(s.dropFirst()) ?? 0) : Int(s)) }
            let a = c(g[1]) ?? 0, b = c(g[2])
            var out = "\(a) °C, dew point \(b.map(String.init) ?? "–") °C"
            if let b { out += ". Spread \(a - b) °C" + (a - b <= 2 ? ": close to saturation, watch for mist or fog" : "") }
            return ("Temperature", out + ".")
        }
        if let g = m(t, "^Q(\\d{4})$") { return ("QNH", "Pressure \(Int(g[1]) ?? 0) hPa. Set this to read altitude above sea level.") }
        if let g = m(t, "^A(\\d{4})$") { return ("Altimeter", "\(g[1].prefix(2)).\(g[1].suffix(2)) inHg.") }
        if t == "NOSIG" { return ("Trend", "No significant change expected in the next 2 hours.") }
        if t == "BECMG" { return ("Change group", "Becoming: a lasting change.") }
        if t == "TEMPO" { return ("Change group", "Temporarily: fluctuations lasting under an hour each.") }
        if let g = m(t, "^FM(\\d{2})(\\d{2})(\\d{2})$") { return ("Change group", "From \(g[2]):\(g[3]) UTC on day \(Int(g[1]) ?? 0).") }
        if let g = m(t, "^PROB(\\d{2})$") { return ("Change group", "\(g[1])% probability.") }
        if let g = m(t, "^(-|\\+|VC)?((?:MI|BC|PR|DR|BL|SH|TS|FZ)?)((?:RA|DZ|SN|SG|GR|GS|PL|BR|FG|HZ|FU|DU|SA|SQ|FC|UP)+)$") {
            let ph = stride(from: 0, to: g[3].count, by: 2).map { i -> String in
                let s = g[3].index(g[3].startIndex, offsetBy: i)
                return wx[String(g[3][s..<g[3].index(s, offsetBy: 2)])] ?? ""
            }.joined(separator: " and ")
            let d = g[2]
            let txt = d == "SH" ? "\(ph) showers" : d == "TS" ? "thunderstorm\(ph.isEmpty ? "" : " with " + ph)" : "\(d.isEmpty ? "" : (wx[d] ?? "") + " ")\(ph)"
            let out = (g[1] == "-" ? "Light " : g[1] == "+" ? "Heavy " : "") + txt
            let cap = String(out.prefix(1)).uppercased() + String(out.dropFirst())
            return ("Weather", cap + (g[1] == "VC" ? " in the vicinity" : "") + ".")
        }
        if m(t, "^\\d{4}/\\d{4}$") != nil {
            let c = Array(t)
            return ("Valid", "From day \(Int(String(c[0...1])) ?? 0) \(String(c[2...3])):00 to day \(Int(String(c[5...6])) ?? 0) \(String(c[7...8])):00 UTC.")
        }
        if t.hasPrefix("R"), m(t, "^R\\d{2}") != nil { return ("Runway", "Runway visual range or runway condition.") }
        return nil
    }

    static func remark(_ t: String) -> (String, String)? {
        if t == "AO1" || t == "A01" { return ("Station type", "Automated station without a precipitation sensor.") }
        if t == "AO2" || t == "A02" { return ("Station type", "Automated station with a precipitation sensor.") }
        if let g = m(t, "^SLP(\\d{3})$") { let v = Double(Int(g[1]) ?? 0) / 10; return ("Sea-level pressure", String(format: "%.1f hPa.", v < 50 ? 1000 + v : 900 + v)) }
        if t == "SLPNO" { return ("Sea-level pressure", "Not available.") }
        if let g = m(t, "^T([01])(\\d{3})([01])(\\d{3})$") {
            func f(_ s: String, _ n: String) -> Double { (s == "1" ? -1 : 1) * Double(Int(n) ?? 0) / 10 }
            return ("Precise temperature", String(format: "%.1f °C, dew point %.1f °C.", f(g[1], g[2]), f(g[3], g[4])))
        }
        if let g = m(t, "^1([01])(\\d{3})$") { return ("6-hour maximum", String(format: "%.1f °C.", (g[1] == "1" ? -1 : 1) * Double(Int(g[2]) ?? 0) / 10)) }
        if let g = m(t, "^2([01])(\\d{3})$") { return ("6-hour minimum", String(format: "%.1f °C.", (g[1] == "1" ? -1 : 1) * Double(Int(g[2]) ?? 0) / 10)) }
        if let g = m(t, "^5(\\d)(\\d{3})$") { return ("3-hour pressure trend", String(format: "Changed by %.1f hPa (trend type %@).", Double(Int(g[2]) ?? 0) / 10, g[1])) }
        if let g = m(t, "^P(\\d{4})$") { return ("Precipitation", String(format: "%.2f in in the last hour.", Double(Int(g[1]) ?? 0) / 100)) }
        if t == "PRESRR" { return ("Pressure", "Rising rapidly.") }
        if t == "PRESFR" { return ("Pressure", "Falling rapidly.") }
        if t == "TSNO" { return ("Sensor", "Thunderstorm sensor not available.") }
        if t == "$" { return ("Maintenance", "The station needs maintenance.") }
        return nil
    }

    static func decodeAll(_ raw: String) -> [(String, String, String)] {
        var out: [(String, String, String)] = []
        var rmk = false
        for t in raw.split(whereSeparator: \.isWhitespace).map(String.init) {
            if ["METAR", "SPECI", "TAF"].contains(t) { continue }
            if t == "RMK" { rmk = true; out.append((t, "Remarks", "Everything after this is extra local information.")); continue }
            let d = rmk ? remark(t) : token(t, out.count)
            out.append((t, d?.0 ?? (rmk ? "Remark" : ""), d?.1 ?? (rmk ? "Local remark." : "")))
        }
        return out
    }
}
