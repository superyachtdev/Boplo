import Foundation

/// The theory question bank, bundled from dist/flight-questions.js (scripts/export-ios-questions.cjs).
/// FAA students get FAA subjects and wording; everyone else the ICAO-style bank.
struct QuestionBank: Decodable {
    struct Subject: Decodable, Identifiable, Hashable {
        let id: String
        let name: String
        let blurb: String
        let count: Int
    }
    struct Question: Decodable, Identifiable, Hashable {
        let id: String
        let subject: String
        let q: String
        let options: [String]
        let answer: Int
        let explain: String
    }
    struct Pack: Decodable {
        let subjects: [Subject]
        let questions: [Question]
    }
    struct Reviewed: Decodable { let by: String? }

    let status: String?
    let reviewed: Reviewed?
    let icao: Pack
    let faa: Pack

    static let shared: QuestionBank? = {
        guard let url = Bundle.main.url(forResource: "questions", withExtension: "json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(QuestionBank.self, from: data)
    }()

    func pack(for regime: String) -> Pack { regime == "faa" ? faa : icao }
}

/// Spaced repetition, identical to the web app so progress carries across devices.
/// The profile's `study` field is JSON: { questionId: [right, seen, box, dueDay], "_mocks": [{d, s}] }.
struct StudyState {
    static let boxDays = [0, 1, 3, 7, 16, 35]
    static let boxStrength = [0, 0.25, 0.5, 0.72, 0.88, 1]

    var records: [String: [Int]] = [:]
    var mocks: [(d: String, s: Int)] = []
    /// Keys the app doesn't use, kept so saving never drops them.
    private var extra: [String: Any] = [:]

    init(json: String?) {
        guard let data = json?.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        for (k, v) in obj {
            if k == "_mocks", let list = v as? [[String: Any]] {
                mocks = list.compactMap { m in
                    guard let d = m["d"] as? String, let s = (m["s"] as? NSNumber)?.intValue else { return nil }
                    return (d, s)
                }
            } else if let arr = v as? [NSNumber], arr.count >= 2 {
                records[k] = arr.map { $0.intValue }
            } else {
                extra[k] = v
            }
        }
    }

    func json() -> String {
        var obj = extra
        for (k, v) in records { obj[k] = v }
        if !mocks.isEmpty { obj["_mocks"] = mocks.suffix(20).map { ["d": $0.d, "s": $0.s] } }
        let data = (try? JSONSerialization.data(withJSONObject: obj)) ?? Data("{}".utf8)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    static func box(_ r: [Int]?) -> Int {
        guard let r, r.count >= 2 else { return 0 }
        if r.count >= 3 { return r[2] }
        return r[1] > 0 && Double(r[0]) / Double(r[1]) >= 0.75 ? 3 : (r[0] > 0 ? 2 : 1)
    }
    static func due(_ r: [Int]?) -> Int? {
        guard let r else { return nil }
        return r.count >= 4 ? r[3] : 0
    }
    static func strength(_ r: [Int]?) -> Double {
        guard let r else { return 0 }
        let b = box(r), late = Day.today - (due(r) ?? 0)
        return boxStrength[min(b, 5)] * (late > boxDays[min(b, 5)] * 2 + 7 ? 0.75 : 1)
    }

    func seen(_ qs: [QuestionBank.Question]) -> Int { qs.filter { records[$0.id] != nil }.count }

    func dueQuestions(_ qs: [QuestionBank.Question]) -> [QuestionBank.Question] {
        qs.filter { q in records[q.id] != nil && (Self.due(records[q.id]) ?? 0) <= Day.today }
    }

    /// 0–100: how well the bank (or one subject) is known, decaying when reviews are overdue.
    func readiness(_ qs: [QuestionBank.Question], subject: String? = nil) -> Int {
        let list = qs.filter { subject == nil || $0.subject == subject }
        guard !list.isEmpty else { return 0 }
        return Int((list.reduce(0) { $0 + Self.strength(records[$1.id]) } / Double(list.count) * 100).rounded())
    }

    /// Average score on a subject's practised questions, or nil if none practised.
    func score(_ qs: [QuestionBank.Question], subject: String) -> Int? {
        let seen = qs.filter { $0.subject == subject && records[$0.id] != nil }
        guard !seen.isEmpty else { return nil }
        let total = seen.reduce(0.0) { acc, q in
            let r = records[q.id]!
            return acc + (r[1] > 0 ? Double(r[0]) / Double(r[1]) : 0)
        }
        return Int((total / Double(seen.count) * 100).rounded())
    }

    mutating func record(_ answers: [(id: String, ok: Bool)]) {
        for (id, ok) in answers {
            let r = records[id] ?? [0, 0]
            let nextBox = ok ? min(5, (r[1] > 0 ? Self.box(r) : 1) + 1) : 1
            records[id] = [r[0] + (ok ? 1 : 0), r[1] + 1, nextBox, Day.today + Self.boxDays[nextBox]]
        }
    }

    static func readyLabel(_ n: Int) -> String {
        n >= 85 ? "Ready to book" : n >= 65 ? "Getting there" : n >= 30 ? "Building up" : "Just starting"
    }
}
