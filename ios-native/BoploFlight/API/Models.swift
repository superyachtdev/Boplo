import Foundation
import CoreLocation

/// Decodes a value that may be missing or of an unexpected type as nil, so one odd field never breaks a screen.
@propertyWrapper
struct Lenient<T: Decodable>: Decodable {
    var wrappedValue: T?
    init(wrappedValue: T?) { self.wrappedValue = wrappedValue }
    init(from decoder: Decoder) throws {
        wrappedValue = try? decoder.singleValueContainer().decode(T.self)
    }
}

extension KeyedDecodingContainer {
    func decode<T>(_ type: Lenient<T>.Type, forKey key: Key) throws -> Lenient<T> {
        (try? decodeIfPresent(type, forKey: key)) ?? Lenient(wrappedValue: nil)
    }
}

struct Workspace: Decodable {
    let user: User
    let profile: Profile?
    let flights: [Flight]
    let billing: Billing
}

struct User: Decodable {
    @Lenient var email: String?
    @Lenient var display_name: String?
}

struct Profile: Decodable {
    @Lenient var name: String?
    @Lenient var country: String?
    @Lenient var countryCode: String?
    @Lenient var authority: String?
    @Lenient var licence: String?
    @Lenient var regime: String?
    @Lenient var airport: String?
    @Lenient var aircraft: String?
    @Lenient var registration: String?
    @Lenient var school: String?
    @Lenient var target: String?
    @Lenient var frequency: String?
    @Lenient var checklist: String?
    @Lenient var notes: String?
    @Lenient var study: String?
    @Lenient var exams: String?
    @Lenient var reminders: Bool?
    @Lenient var nextLesson: String?
    @Lenient var lessonDate: String?
    @Lenient var lessonTime: String?
    @Lenient var questions: String?
    @Lenient var openingMinutes: Double?
    @Lenient var goalHours: Double?
    @Lenient var complete: Bool?

    var isComplete: Bool { complete == true }

    /// "faa", "uk" or "easa", worked out like the web app when older profiles have no regime saved.
    var regimeKey: String {
        if let regime, ["faa", "uk", "easa"].contains(regime) { return regime }
        let a = (authority ?? "").lowercased()
        if a.contains("faa") || countryCode == "US" { return "faa" }
        if a.contains("easa") { return "easa" }
        return "uk"
    }

    /// The preparation checklist, stored as "[x] item" / "[ ] item" lines.
    var checks: [CheckItem] { CheckItem.parse(checklist) }
    var questionList: [String] { (questions ?? "").split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty } }
    var firstName: String { (name ?? "").split(separator: " ").first.map(String.init) ?? "" }
}

struct TrackPoint: Codable, Hashable {
    let lat: Double
    let lng: Double
    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }
}

struct Flight: Decodable, Identifiable, Hashable {
    let id: String
    let date: String
    @Lenient var departure: String?
    @Lenient var arrival: String?
    @Lenient var aircraft: String?
    @Lenient var registration: String?
    @Lenient var instructor: String?
    @Lenient var lesson: String?
    @Lenient var minutes: Double?
    @Lenient var role: String?
    @Lenient var landings: Double?
    @Lenient var nightLandings: Double?
    @Lenient var notes: String?
    @Lenient var win: String?
    @Lenient var cost: Double?
    @Lenient var points: [TrackPoint]?
    @Lenient var routeKind: String?

    static func == (a: Flight, b: Flight) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    var route: String { "\(departure ?? "—") → \(arrival ?? "—")" }
    var mins: Int { Int(minutes ?? 0) }
    var roleLabel: String {
        switch role { case "solo": return "Solo"; case "pic": return "PIC"; default: return "Dual" }
    }
    var day: Date? { Flight.dayFormat.date(from: date) }
    var dep: String { (departure ?? "").uppercased() }
    var arr: String { (arrival ?? "").uppercased() }
    var track: [TrackPoint] { points ?? [] }

    static let dayFormat: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}

struct Billing: Decodable {
    @Lenient var plan: String?
    @Lenient var status: String?
    @Lenient var interval: String?
    @Lenient var owner: Bool?
    @Lenient var cancelAtPeriodEnd: Bool?
    @Lenient var school: SchoolSeat?
    @Lenient var limits: Limits?

    var isAdvanced: Bool { plan == "advanced" }
    var flightLimit: Int { Int(limits?.flights ?? 15) }

    struct Limits: Decodable {
        @Lenient var flights: Double?
    }

    struct SchoolSeat: Decodable {
        @Lenient var name: String?
        @Lenient var role: String?
    }
}


struct CheckItem: Identifiable, Hashable {
    var id = UUID()
    var done: Bool
    var text: String

    static func parse(_ raw: String?) -> [CheckItem] {
        (raw ?? "").split(whereSeparator: \.isNewline).compactMap { line in
            let l = line.trimmingCharacters(in: .whitespaces)
            guard !l.isEmpty else { return nil }
            if l.count >= 3, l.hasPrefix("["), l.dropFirst(2).first == "]" {
                let mark = l[l.index(after: l.startIndex)]
                let text = l.dropFirst(3).trimmingCharacters(in: .whitespaces)
                return text.isEmpty ? nil : CheckItem(done: mark == "x" || mark == "X", text: text)
            }
            return CheckItem(done: false, text: l)
        }
    }

    static func write(_ list: [CheckItem]) -> String {
        String(list.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
            .map { "[\($0.done ? "x" : " ")] \($0.text.trimmingCharacters(in: .whitespaces))" }
            .joined(separator: "\n").prefix(3000))
    }
}
