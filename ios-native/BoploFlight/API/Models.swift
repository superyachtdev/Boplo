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
    @Lenient var airport: String?
    @Lenient var aircraft: String?
    @Lenient var nextLesson: String?
    @Lenient var lessonDate: String?
    @Lenient var lessonTime: String?
    @Lenient var questions: String?
    @Lenient var openingMinutes: Double?
    @Lenient var goalHours: Double?
    @Lenient var complete: Bool?

    var isComplete: Bool { complete == true }
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

    static func == (a: Flight, b: Flight) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    var route: String { "\(departure ?? "—") → \(arrival ?? "—")" }
    var mins: Int { Int(minutes ?? 0) }
    var roleLabel: String {
        switch role { case "solo": return "Solo"; case "pic": return "PIC"; default: return "Dual" }
    }
    var day: Date? { Flight.dayFormat.date(from: date) }

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

    var isAdvanced: Bool { plan == "advanced" }

    struct SchoolSeat: Decodable {
        @Lenient var name: String?
        @Lenient var role: String?
    }
}

/// "1:25" style hours and minutes, like a logbook.
func hoursText(_ minutes: Int) -> String {
    "\(minutes / 60):" + String(format: "%02d", minutes % 60)
}
