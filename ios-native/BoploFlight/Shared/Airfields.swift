import Foundation
import CoreLocation

/// Airfield data the website uses (OurAirports, public domain): boplo.app/airfields/<CC>.json and runways/<CC>.json.
struct Airfield: Identifiable, Hashable {
    let code: String
    let name: String
    let lat: Double
    let lng: Double
    let type: String
    let elevationFt: Double
    let city: String
    let runways: [(ident: String, lengthM: Double, surface: String)]
    let country: String

    var id: String { code }
    var point: TrackPoint { TrackPoint(lat: lat, lng: lng) }
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }

    static func == (a: Airfield, b: Airfield) -> Bool { a.code == b.code }
    func hash(into h: inout Hasher) { h.combine(code) }
}

struct RunwayEnd: Identifiable, Hashable {
    let id: String
    let heading: Double
    let length: Double
    let lda: Double
    let surface: String
}

actor AirfieldStore {
    static let shared = AirfieldStore()
    private var byCountry: [String: [Airfield]] = [:]
    private var codeIndex: [String: String]?
    private var runwayRows: [String: [String: [[Any]]]] = [:]

    private func fetch(_ path: String) async -> Any? {
        guard let url = URL(string: path, relativeTo: API.origin) else { return nil }
        let cache = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("af-" + path.replacingOccurrences(of: "/", with: "-"))
        if let (data, resp) = try? await URLSession.shared.data(from: url), (resp as? HTTPURLResponse)?.statusCode == 200 {
            try? data.write(to: cache)
            return try? JSONSerialization.jsonObject(with: data)
        }
        if let data = try? Data(contentsOf: cache) { return try? JSONSerialization.jsonObject(with: data) }
        return nil
    }

    func airfields(_ cc: String) async -> [Airfield] {
        let cc = cc.uppercased()
        guard !cc.isEmpty else { return [] }
        if let hit = byCountry[cc] { return hit }
        guard let obj = await fetch("airfields/\(cc).json") as? [String: Any], let rows = obj["rows"] as? [[Any]] else { return [] }
        let list: [Airfield] = rows.compactMap { r in
            guard r.count >= 4, let code = r[0] as? String, let lat = (r[2] as? NSNumber)?.doubleValue, let lng = (r[3] as? NSNumber)?.doubleValue else { return nil }
            let rw = (r.count > 8 ? r[8] as? [[Any]] : nil) ?? []
            return Airfield(code: code, name: r[1] as? String ?? code, lat: lat, lng: lng, type: r.count > 4 ? (r[4] as? String ?? "") : "",
                            elevationFt: r.count > 5 ? ((r[5] as? NSNumber)?.doubleValue ?? 0) : 0, city: r.count > 6 ? (r[6] as? String ?? "") : "",
                            runways: rw.map { (ident: $0.first as? String ?? "", lengthM: ($0.count > 1 ? ($0[1] as? NSNumber)?.doubleValue : nil) ?? 0, surface: $0.count > 2 ? ($0[2] as? String ?? "") : "") },
                            country: cc)
        }
        byCountry[cc] = list
        return list
    }

    /// Finds an airfield by code anywhere, starting with the pilot's own country.
    func find(_ raw: String, home: String?) async -> Airfield? {
        let code = Self.code(raw)
        guard !code.isEmpty else { return nil }
        if let home, let a = await airfields(home).first(where: { $0.code.uppercased() == code }) { return a }
        if codeIndex == nil, let idx = await fetch("airfields/codes.json") as? [String: String] { codeIndex = idx }
        if let cc = codeIndex?.first(where: { (" " + $0.value + " ").contains(" " + code + " ") })?.key {
            return await airfields(cc).first { $0.code.uppercased() == code }
        }
        return nil
    }

    func search(_ text: String, home: String?) async -> [Airfield] {
        let t = text.trimmingCharacters(in: .whitespaces).uppercased()
        guard t.count >= 2, let home else { return [] }
        let list = await airfields(home)
        return Array(list.filter { $0.code.uppercased().hasPrefix(t) || $0.name.uppercased().contains(t) }.prefix(12))
    }

    func runwayEnds(_ af: Airfield) async -> [RunwayEnd] {
        if runwayRows[af.country] == nil, let obj = await fetch("runways/\(af.country).json") as? [String: Any], let rows = obj["rows"] as? [String: [[Any]]] {
            runwayRows[af.country] = rows
        }
        let rows = runwayRows[af.country]?[af.code] ?? []
        func d(_ r: [Any], _ i: Int) -> Double? { r.count > i ? (r[i] as? NSNumber)?.doubleValue : nil }
        if !rows.isEmpty {
            return rows.flatMap { r -> [RunwayEnd] in
                guard let a1 = d(r, 2), let o1 = d(r, 3), let a2 = d(r, 4), let o2 = d(r, 5) else { return [] }
                let len = d(r, 6) ?? 0, surf = r.count > 8 ? (r[8] as? String ?? "") : ""
                let p1 = TrackPoint(lat: a1, lng: o1), p2 = TrackPoint(lat: a2, lng: o2)
                return [RunwayEnd(id: r[0] as? String ?? "", heading: Geo.bearing(p1, p2), length: len, lda: len - (d(r, 10) ?? 0), surface: surf),
                        RunwayEnd(id: r[1] as? String ?? "", heading: Geo.bearing(p2, p1), length: len, lda: len - (d(r, 11) ?? 0), surface: surf)]
            }.filter { !$0.id.isEmpty }
        }
        return af.runways.flatMap { rw in
            rw.ident.split(separator: "/").map { id in
                RunwayEnd(id: String(id), heading: Double(Int(id.prefix(2)) ?? 0) * 10, length: rw.lengthM, lda: rw.lengthM, surface: rw.surface)
            }
        }.filter { $0.id.first?.isNumber == true }
    }

    /// "EGHP · Popham" → "EGHP"
    static func code(_ raw: String?) -> String {
        let a = (raw ?? "").trimmingCharacters(in: .whitespaces).uppercased()
        return String(a.split(whereSeparator: { $0 == " " || $0 == "·" }).first ?? "")
    }
}
