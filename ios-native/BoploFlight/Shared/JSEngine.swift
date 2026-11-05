import Foundation
import JavaScriptCore

/// Runs the web app's own licence rules (flight-rules.js) and preflight maths (flight-preflight.js) natively,
/// so the app and the website always agree. Bundled copies come from scripts/export-ios-data.cjs.
@MainActor
final class JSEngine {
    static let shared = JSEngine()
    private let ctx: JSContext

    private init() {
        ctx = JSContext()!
        ctx.exceptionHandler = { _, e in print("JS error:", e?.toString() ?? "") }
        ctx.evaluateScript("var window = this; var globalThis = this;")
        for name in ["flight-rules", "flight-preflight"] {
            let url = Bundle.main.url(forResource: name, withExtension: "js", subdirectory: "js") ?? Bundle.main.url(forResource: name, withExtension: "js")
            if let url, let src = try? String(contentsOf: url, encoding: .utf8) { ctx.evaluateScript(src, withSourceURL: url) }
        }
    }

    /// Evaluates a JavaScript expression and returns its JSON value (dictionary, array, number, string), or nil.
    func value(_ expression: String) -> Any? {
        guard let s = ctx.evaluateScript("JSON.stringify((function(){ return \(expression); })())")?.toString(),
              s != "undefined", let data = s.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
    }

    /// A Swift value as a JavaScript literal, for passing arguments.
    static func lit(_ v: Any?) -> String {
        guard let v else { return "null" }
        if let s = v as? String {
            let data = (try? JSONSerialization.data(withJSONObject: [s])) ?? Data("[\"\"]".utf8)
            let arr = String(data: data, encoding: .utf8) ?? "[\"\"]"
            return String(arr.dropFirst().dropLast())
        }
        if JSONSerialization.isValidJSONObject(v), let data = try? JSONSerialization.data(withJSONObject: v), let s = String(data: data, encoding: .utf8) { return s }
        if let n = v as? NSNumber { return n.stringValue }
        return "null"
    }
}

// MARK: - Rules (flight-rules.js)

struct LicenceInfo {
    let id: String
    let label: String
    let minHours: Int?
    let summary: String
    let source: String
    let url: String
}

struct SyllabusItem: Identifiable, Hashable {
    let id: String
    let name: String
    let stage: Int
}

struct Syllabus {
    let id: String
    let title: String
    let source: String
    let stages: [String]
    let items: [SyllabusItem]
}

struct Requirement {
    let k: String          // total, dual, solo, soloxc, nightldg, longxc, manual
    let id: String?
    let need: Double
    let nm: Double?
    let label: String
    let note: String
}

@MainActor
enum Rules {
    static func licence(_ regime: String, _ id: String?) -> LicenceInfo? {
        guard let d = JSEngine.shared.value("BOPLO_RULES.licence(\(JSEngine.lit(regime)), \(JSEngine.lit(id ?? "")))") as? [String: Any] else { return nil }
        return LicenceInfo(id: d["id"] as? String ?? "", label: d["label"] as? String ?? "", minHours: (d["minHours"] as? NSNumber)?.intValue,
                           summary: d["summary"] as? String ?? "", source: d["source"] as? String ?? "", url: d["url"] as? String ?? "")
    }

    static func licences(_ regime: String) -> [LicenceInfo] {
        guard let list = JSEngine.shared.value("BOPLO_RULES.licencesFor(\(JSEngine.lit(regime)))") as? [[String: Any]] else { return [] }
        return list.map { d in LicenceInfo(id: d["id"] as? String ?? "", label: d["label"] as? String ?? "", minHours: (d["minHours"] as? NSNumber)?.intValue,
                                           summary: d["summary"] as? String ?? "", source: d["source"] as? String ?? "", url: d["url"] as? String ?? "") }
    }

    static func syllabus(_ regime: String) -> Syllabus? {
        guard let d = JSEngine.shared.value("BOPLO_RULES.syllabusFor(\(JSEngine.lit(regime)))") as? [String: Any] else { return nil }
        let items = (d["items"] as? [[String: Any]] ?? []).map { SyllabusItem(id: $0["id"] as? String ?? "", name: $0["name"] as? String ?? "", stage: ($0["stage"] as? NSNumber)?.intValue ?? 0) }
        return Syllabus(id: d["id"] as? String ?? "", title: d["title"] as? String ?? "", source: d["source"] as? String ?? "", stages: d["stages"] as? [String] ?? [], items: items)
    }

    static func requirements(_ regime: String, _ licence: String?) -> [Requirement]? {
        guard let list = JSEngine.shared.value("BOPLO_RULES.requirementsFor(\(JSEngine.lit(regime)), \(JSEngine.lit(licence ?? "")))") as? [[String: Any]] else { return nil }
        return list.map { d in Requirement(k: d["k"] as? String ?? "manual", id: d["id"] as? String, need: (d["need"] as? NSNumber)?.doubleValue ?? 1,
                                           nm: (d["nm"] as? NSNumber)?.doubleValue, label: d["label"] as? String ?? "", note: d["note"] as? String ?? "") }
    }

    struct Country: Identifiable, Hashable { let code: String; let name: String; var id: String { code } }

    static var countries: [Country] {
        (JSEngine.shared.value("BOPLO_RULES.countries") as? [[String: Any]] ?? []).map { Country(code: $0["code"] as? String ?? "", name: $0["name"] as? String ?? "") }
    }
    static var popular: [String] { JSEngine.shared.value("BOPLO_RULES.popular") as? [String] ?? [] }
    static func regimeFor(_ code: String) -> String { JSEngine.shared.value("BOPLO_RULES.regimeFor(\(JSEngine.lit(code)))") as? String ?? "icao" }
    static func authorityFor(_ code: String) -> String { JSEngine.shared.value("BOPLO_RULES.authorityFor(\(JSEngine.lit(code)))") as? String ?? "" }
}

// MARK: - Geography

enum Geo {
    static func nm(_ a: TrackPoint, _ b: TrackPoint) -> Double {
        let r = Double.pi / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
        let h = pow(sin(dLat / 2), 2) + cos(a.lat * r) * cos(b.lat * r) * pow(sin(dLng / 2), 2)
        return 2 * 3440.065 * asin(min(1, sqrt(h)))
    }
    static func bearing(_ a: TrackPoint, _ b: TrackPoint) -> Double {
        let r = Double.pi / 180
        let y = sin((b.lng - a.lng) * r) * cos(b.lat * r)
        let x = cos(a.lat * r) * sin(b.lat * r) - sin(a.lat * r) * cos(b.lat * r) * cos((b.lng - a.lng) * r)
        return norm360(atan2(y, x) / r)
    }
    static func norm360(_ d: Double) -> Double { ((d.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360) }
    static func pad3(_ d: Double) -> String { String(format: "%03d", Int(norm360(d).rounded()) % 360) }
    static func trackNM(_ f: Flight) -> Double {
        let p = f.track
        guard p.count > 1 else { return 0 }
        return (1..<p.count).reduce(0) { $0 + nm(p[$1 - 1], p[$1]) }
    }
    static func isCrossCountry(_ f: Flight) -> Bool {
        if !f.dep.isEmpty, !f.arr.isEmpty, f.dep != f.arr { return true }
        guard trackNM(f) > 25, let first = f.track.first else { return false }
        return f.track.contains { nm(first, $0) > 12 }
    }
}
