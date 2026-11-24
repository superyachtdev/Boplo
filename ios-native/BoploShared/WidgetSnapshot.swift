import Foundation

/// What the Home Screen widgets show, written by the app into the shared App Group whenever the
/// desk refreshes. Kept tiny and Codable so the widget never needs the network or the session.
struct WidgetSnapshot: Codable, Equatable {
    static let group = "group.app.boplo.flight"
    static let key = "boplo.widget.snapshot"

    var name: String = ""
    var hours: Double = 0
    var goal: Double = 0
    var dual: Double = 0
    var solo: Double = 0
    var pic: Double = 0
    var flights: Int = 0
    var last30: Double = 0
    var licence: String = ""
    var home: String = ""
    var nextLesson: String = ""
    /// yyyy-MM-dd
    var lessonDate: String = ""
    var lessonTime: String = ""
    var updated: Date = .distantPast
    // the Pilot widget: rating, stats, today's sortie and the study streak
    var rating: Int = 0
    var tier: String = ""
    var knowledge: Int = 0
    var handling: Int = 0
    var airmanship: Int = 0
    var rank: Int = 0
    var total: Int = 0
    /// yyyy-MM-dd of the last sortie flown
    var sortieDay: String = ""
    var streak: Int = 0
    /// yyyy-MM-dd of the last day the streak counted (today, or yesterday if not studied yet today)
    var streakDay: String = ""

    var progress: Double { goal > 0 ? min(1, hours / goal) : 0 }

    var lessonDay: Date? {
        guard !lessonDate.isEmpty else { return nil }
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: lessonDate)
    }

    /// Today where the phone is, as yyyy-MM-dd (matches how the app writes sortie and streak days).
    static func iso(_ d: Date = .now) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
    }
    static func iso(daysAgo n: Int) -> String { iso(Calendar.current.date(byAdding: .day, value: -n, to: .now) ?? .now) }

    var hasStats: Bool { total > 0 }
    var sortieDoneToday: Bool { sortieDay == Self.iso() }
    /// Days the pilot stays current after the last sortie (3 days, as on the pilot card).
    var currentDays: Int {
        guard !sortieDay.isEmpty else { return 0 }
        for n in 0..<3 where sortieDay == Self.iso(daysAgo: n) { return 3 - n }
        return 0
    }
    /// The streak still alive: studied today, or yesterday and can still be kept today.
    var liveStreak: Int { streakDay == Self.iso() || streakDay == Self.iso(daysAgo: 1) ? streak : 0 }
    var streakAtRisk: Bool { streak > 0 && streakDay == Self.iso(daysAgo: 1) }

    static func load() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.group)?.set(data, forKey: Self.key)
    }

    static let sample = WidgetSnapshot(name: "Alex", hours: 23.4, goal: 45, dual: 17.2, solo: 4.8, pic: 1.4, flights: 19, last30: 5.2,
                                       licence: "PPL(A)", home: "EGHP", nextLesson: "Circuits and glide approaches", lessonDate: "", lessonTime: "10:00",
                                       rating: 54, tier: "Solo", knowledge: 61, handling: 48, airmanship: 52, rank: 38, total: 412, sortieDay: "", streak: 6, streakDay: iso(daysAgo: 1))
}
