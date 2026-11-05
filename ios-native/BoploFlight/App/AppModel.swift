import Foundation
import Observation

/// The app's state: who is signed in and their desk (profile, flights, plan).
@MainActor
@Observable
final class AppModel {
    enum Phase { case loading, signedOut, setup, ready }

    enum Tab: Hashable { case desk, logbook, study, fly, you }

    var phase: Phase = .loading
    var tab: Tab = .desk
    /// App-wide sheets, so any screen (including embedded web pages) can open them.
    var showPaywall = false
    var paywallMessage: String?
    var showNewFlight = false
    var openedFlight: Flight?
    var workspace: Workspace?
    var lastError: String?

    /// The profile exactly as the server sent it. The server replaces the whole profile on save,
    /// so edits are merged into this and sent back complete, never as a partial record.
    private(set) var rawProfile: [String: Any] = [:]

    var profile: Profile? { workspace?.profile }
    var flights: [Flight] { workspace?.flights ?? [] }
    var billing: Billing? { workspace?.billing }
    var isAdvanced: Bool { billing?.isAdvanced == true }

    init() {
        NotificationCenter.default.addObserver(forName: .boploSignedOut, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.handleSignedOut() }
        }
    }

    func start() async {
        guard API.shared.hasSessionCookie else { phase = .signedOut; return }
        await refresh()
    }

    func refresh() async {
        do {
            let data = try await API.shared.send("flight/workspace")
            let ws = try JSONDecoder().decode(Workspace.self, from: data)
            let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
            rawProfile = (json["profile"] as? [String: Any]) ?? [:]
            workspace = ws
            lastError = nil
            phase = ws.profile?.isComplete == true ? .ready : .setup
        } catch let error as APIError where error.status == 401 {
            handleSignedOut()
        } catch {
            lastError = error.localizedDescription
            if workspace == nil { phase = .signedOut }
        }
    }

    /// Saves profile changes, keeping every field the app doesn't show.
    func saveProfile(_ changes: [String: Any]) async throws {
        var merged = rawProfile
        for (key, value) in changes { merged[key] = value }
        merged.removeValue(forKey: "shareOn")
        merged.removeValue(forKey: "calOn")
        try await API.shared.send("flight/profile", method: "PUT", body: merged)
        await refresh()
    }

    func signOut() async {
        _ = try? await API.shared.send("auth/auth/logout", method: "POST", body: [:])
        handleSignedOut()
    }

    func deleteAccount() async throws {
        try await API.shared.send("flight/account/delete", method: "POST", body: ["confirm": "DELETE"])
        handleSignedOut()
    }

    private func handleSignedOut() {
        API.shared.clearCookies()
        workspace = nil
        rawProfile = [:]
        phase = .signedOut
    }

    // MARK: - Totals for the desk

    var totalMinutes: Int {
        Int(profile?.openingMinutes ?? 0) + flights.reduce(0) { $0 + $1.mins }
    }

    var goalMinutes: Int { Int((profile?.goalHours ?? 0) * 60) }

    var progress: Double {
        guard goalMinutes > 0 else { return 0 }
        return min(1, Double(totalMinutes) / Double(goalMinutes))
    }

    func minutes(role: String) -> Int {
        flights.filter { ($0.role ?? "dual") == role }.reduce(0) { $0 + $1.mins }
    }

    var landings: Int { flights.reduce(0) { $0 + Int($1.landings ?? 0) } }

    /// Newest first.
    var sortedFlights: [Flight] { flights.sorted { $0.date > $1.date } }

    func flights(inLast days: Int) -> [Flight] {
        let cutoff = Day.adding(-days, to: Day.todayISO)
        return flights.filter { $0.date >= cutoff }
    }

    var regime: String { profile?.regimeKey ?? "uk" }
    var passMark: Int { regime == "faa" ? 70 : 75 }

    // MARK: - Gates

    func upgrade(_ message: String? = nil) {
        paywallMessage = message
        showPaywall = true
    }

    /// Opens the new-flight form, or the paywall when the Free logbook is full.
    func logFlight() {
        if !isAdvanced, let limit = billing?.flightLimit, flights.count >= limit {
            upgrade("The Free plan holds \(limit) flights. Advanced gives you an unlimited logbook.")
            return
        }
        showNewFlight = true
    }

    // MARK: - Momentum (same rules as the web desk)

    struct Momentum {
        let gap: Int?
        let weeks: [Int]
        let streak: Int
        let target: Double
        let lately: Double
        let message: String
    }

    var momentum: Momentum {
        let list = sortedFlights
        let gap = list.first.flatMap { Day.daysUntil($0.date) }.map { -$0 }
        let today = Day.todayISO
        let weeks: [Int] = (0..<8).map { i in
            let end = Day.adding(-i * 7, to: today), start = Day.adding(-i * 7 - 6, to: today)
            return list.filter { $0.date >= start && $0.date <= end }.count
        }.reversed()
        var streak = 0
        for n in weeks.reversed() { if n > 0 { streak += 1 } else { break } }
        let target: Double = ["Twice a week": 2, "Weekly": 1, "Monthly": 0.25, "Intensive course": 4][profile?.frequency ?? ""] ?? 2
        let lately = Double(weeks.suffix(4).reduce(0, +)) / 4
        let message: String
        switch gap {
        case nil: message = "Log your first flight and Boplo keeps an eye on your momentum."
        case let g? where g <= 7: message = lately >= target ? "Great rhythm. Flying this often is how students finish in fewer hours." : "Nice and recent. Keep the next lesson close to stay sharp."
        case let g? where g <= 20: message = "A good moment to book your next lesson, before skills start to slip."
        case let g? where g <= 59: message = "Skills fade fastest in the first few weeks off. Getting back up soon saves hours later."
        case let g? where g <= 89: message = "You’re getting close to 90 days. After that, passenger currency lapses and skills need rebuilding."
        default: message = "It’s been over 90 days. Most students restart with a dual lesson to brush up, and that’s normal."
        }
        return Momentum(gap: gap, weeks: weeks, streak: streak, target: target, lately: lately, message: message)
    }
}

extension AppModel {
    /// What Ask Boplo knows about this pilot, in the same shape the web app sends.
    var askContext: String {
        let p = profile
        let fl = sortedFlights
        func h(_ m: Int) -> String { decimalHours(m) }
        var lines: [String] = [
            "First name: \(p?.firstName.isEmpty == false ? p!.firstName : "unknown")",
            "Training: \([p?.licence, p?.authority].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " with ")) (licensing system: \(regime), country: \(p?.country ?? "—"))"
        ]
        if let a = p?.airport, !a.isEmpty { lines.append("Home airfield: \(a)") }
        if let a = p?.aircraft, !a.isEmpty { lines.append("Aircraft: \([a, p?.registration ?? ""].filter { !$0.isEmpty }.joined(separator: " "))") }
        if let s = p?.school, !s.isEmpty { lines.append("School: \(s)") }
        lines.append("Logged: \(fl.count) flights, \(h(totalMinutes)) h total (dual \(h(minutes(role: "dual"))) h, solo \(h(minutes(role: "solo"))) h, PIC \(h(minutes(role: "pic"))) h), \(landings) landings")
        if let g = p?.goalHours, g > 0 { lines.append("Hours goal: \(Int(g))") }
        if let t = p?.target, !t.isEmpty { lines.append("Target date: \(t)") }
        if let l = p?.nextLesson, !l.isEmpty { lines.append("Next lesson: \(l)\(p?.lessonDate?.isEmpty == false ? " on \(p!.lessonDate!)" : "")") }
        let checks = p?.checks ?? []
        if !checks.isEmpty { lines.append("Preparation checklist: " + checks.map { "\($0.done ? "[done]" : "[to do]") \($0.text)" }.joined(separator: "; ")) }
        let qs = p?.questionList ?? []
        if !qs.isEmpty { lines.append("Questions for the instructor: " + qs.joined(separator: "; ")) }
        let recent = fl.prefix(5).map { f -> String in
            var s = "- \(f.date) \(f.dep)→\(f.arr), \(f.roleLabel), \(hoursText(f.mins))"
            if let l = f.lesson, !l.isEmpty { s += ", \(l)" }
            if let n = f.notes, !n.isEmpty { s += ". Debrief: " + String(n.replacingOccurrences(of: "\n", with: " ").prefix(220)) }
            return s
        }
        if !recent.isEmpty { lines.append("Recent flights:\n" + recent.joined(separator: "\n")) }
        return String(lines.joined(separator: "\n").prefix(3400))
    }
}
