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

    var progress: Double { goal > 0 ? min(1, hours / goal) : 0 }

    var lessonDay: Date? {
        guard !lessonDate.isEmpty else { return nil }
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f.date(from: lessonDate)
    }

    static func load() -> WidgetSnapshot? {
        guard let data = UserDefaults(suiteName: group)?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults(suiteName: Self.group)?.set(data, forKey: Self.key)
    }

    static let sample = WidgetSnapshot(name: "Alex", hours: 23.4, goal: 45, dual: 17.2, solo: 4.8, pic: 1.4, flights: 19, last30: 5.2,
                                       licence: "PPL(A)", home: "EGHP", nextLesson: "Circuits and glide approaches", lessonDate: "", lessonTime: "10:00")
}
