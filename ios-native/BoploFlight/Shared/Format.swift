import Foundation

/// Dates in Boplo are calendar days ("2026-11-05") with no time zone, like a paper logbook.
/// They're parsed at UTC midnight and always formatted in UTC so a day never shifts.
enum Day {
    private static let iso: DateFormatter = make("yyyy-MM-dd")

    static func make(_ format: String) -> DateFormatter {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_GB")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = format
        return f
    }

    static func date(_ s: String?) -> Date? {
        guard let s, s.count >= 10 else { return nil }
        return iso.date(from: String(s.prefix(10)))
    }

    /// Today's calendar day where the pilot is.
    static var todayISO: String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        return String(format: "%04d-%02d-%02d", c.year ?? 2000, c.month ?? 1, c.day ?? 1)
    }

    static func isoString(_ d: Date) -> String { iso.string(from: d) }

    /// Whole days since 1970 for a calendar day, for gaps and spaced repetition.
    static func number(_ s: String?) -> Int? {
        guard let d = date(s) else { return nil }
        return Int((d.timeIntervalSince1970 / 86400).rounded(.down))
    }
    static var today: Int { number(todayISO) ?? 0 }

    static func daysUntil(_ s: String?) -> Int? {
        guard let n = number(s) else { return nil }
        return n - today
    }

    static func adding(_ days: Int, to s: String) -> String {
        guard let d = date(s) else { return s }
        return isoString(d.addingTimeInterval(Double(days) * 86400))
    }

    private static let shortF = make("EEE d MMM")
    private static let shortNoDayF = make("d MMM")
    private static let longF = make("EEEE d MMMM")
    private static let fullF = make("d MMM yyyy")
    private static let monthYearF = make("MMMM yyyy")

    /// "Wed 28 Oct"
    static func short(_ s: String?) -> String { date(s).map { shortF.string(from: $0) } ?? "" }
    /// "28 Oct"
    static func dayMonth(_ s: String?) -> String { date(s).map { shortNoDayF.string(from: $0) } ?? "" }
    /// "Saturday 24 October"
    static func long(_ s: String?) -> String { date(s).map { longF.string(from: $0) } ?? "" }
    /// "28 Oct 2026"
    static func full(_ s: String?) -> String { date(s).map { fullF.string(from: $0) } ?? "" }
    /// "July 2027"
    static func monthYear(_ s: String?) -> String { date(s).map { monthYearF.string(from: $0) } ?? "" }
}

/// "1:25" style hours and minutes, like a logbook.
func hoursText(_ minutes: Int) -> String {
    "\(minutes / 60):" + String(format: "%02d", minutes % 60)
}

/// "11.8" decimal hours.
func decimalHours(_ minutes: Int) -> String {
    String(format: "%.1f", Double(minutes) / 60)
}

func plural(_ n: Int, _ one: String, _ many: String? = nil) -> String {
    "\(n) \(n == 1 ? one : (many ?? one + "s"))"
}
