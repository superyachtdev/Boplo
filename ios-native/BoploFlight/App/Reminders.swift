import SwiftUI
import StoreKit
import UserNotifications

/// Local reminders, up to three a day, each with its own job:
///  • morning (08:00): today's sortie, and whether the student is still current
///  • midday (12:30): a question of the day the student can answer straight from the lock screen
///  • evening (their chosen time): streak, due reviews, their weakest stat, their rank
/// Plus a heads-up the day before an App Store free trial ends.
///
/// Everything is scheduled on the phone and rebuilt whenever the app opens or a study session ends, so a
/// slot is skipped when it isn't needed (sortie already flown, already studied today). If the app isn't
/// opened, reminders thin out by themselves: full set for 3 days, then the evening one only, then nothing
/// after a week until the app is opened again.
enum Reminders {
    private static let onKey = "boplo.remind.on"
    private static let hourKey = "boplo.remind.hour"
    private static let minuteKey = "boplo.remind.minute"
    private static let askedKey = "boplo.remind.asked"
    private static let perDayKey = "boplo.remind.perDay"
    static let answersKey = "boplo.remind.answers"
    private static let daysAhead = 7
    private static let fullDays = 3

    static var isOn: Bool { UserDefaults.standard.bool(forKey: onKey) }
    /// The student has either turned reminders on or dismissed the offer.
    static var decided: Bool { isOn || UserDefaults.standard.bool(forKey: askedKey) }
    /// 3 (morning, midday, evening) or 1 (evening only).
    static var perDay: Int { (UserDefaults.standard.object(forKey: perDayKey) as? Int) == 1 ? 1 : 3 }
    static var time: DateComponents {
        let d = UserDefaults.standard
        let h = d.object(forKey: hourKey) as? Int ?? 19
        let m = d.object(forKey: minuteKey) as? Int ?? 0
        return DateComponents(hour: h, minute: m)
    }

    /// Asks for permission (the first time) and turns reminders on, with the evening one at the given time.
    @MainActor
    static func enable(hour: Int, minute: Int, model: AppModel) async -> Bool {
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        let d = UserDefaults.standard
        d.set(true, forKey: askedKey)
        d.set(granted, forKey: onKey)
        d.set(hour, forKey: hourKey)
        d.set(minute, forKey: minuteKey)
        await refresh(model)
        return granted
    }

    @MainActor
    static func setPerDay(_ n: Int, model: AppModel) async {
        UserDefaults.standard.set(n == 1 ? 1 : 3, forKey: perDayKey)
        await refresh(model)
    }

    @MainActor
    static func disable(_ model: AppModel) async {
        UserDefaults.standard.set(false, forKey: onKey)
        UserDefaults.standard.set(true, forKey: askedKey)
        await refresh(model)
    }

    static func dismissOffer() { UserDefaults.standard.set(true, forKey: askedKey) }

    private static var allIds: [String] {
        (0..<daysAhead).flatMap { ["boplo-am-\($0)", "boplo-noon-\($0)", "boplo-study-\($0)"] } + ["boplo-trial-end"]
    }

    /// Rebuilds every pending Boplo reminder from the current study state, stats and subscription.
    @MainActor
    static func refresh(_ model: AppModel) async {
        await flushLockScreenAnswers(model)
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        center.removePendingNotificationRequests(withIdentifiers: allIds)
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        if let end = await trialEnd() {
            let at = end.addingTimeInterval(-24 * 3600)
            if at > Date().addingTimeInterval(60) {
                let c = UNMutableNotificationContent()
                c.title = "Your free trial ends tomorrow"
                c.body = "Boplo Advanced carries on automatically. If it’s not for you, you can cancel any time before then in Settings › Apple Account › Subscriptions."
                c.sound = .default
                try? await center.add(UNNotificationRequest(identifier: "boplo-trial-end", content: c, trigger: trigger(at)))
            }
        }

        guard isOn else { return }
        let st = StudyState(json: model.profile?.study)
        let bank = QuestionBank.shared?.pack(for: model.regime)
        let due = bank.map { st.dueQuestions($0.questions).count } ?? 0
        let streak = st.streak
        let studiedToday = st.days.contains(Day.today)
        let sortieToday = model.jsonList("sorties").contains { ($0["d"] as? String) == Day.todayISO }
        let stats = PilotStatsStore.shared.stats
        let home = model.homeCode.isEmpty ? "your airport" : model.homeCode
        let questions = bank.map { questionsOfTheDay($0, st: st, count: min(fullDays, daysAhead)) } ?? []
        let cal = Calendar.current
        let evening = time
        var categories = Set<UNNotificationCategory>()

        // The evening lines that know something real about today, best first.
        var eveningLines: [(String, String)] = []
        if streak >= 2 { eveningLines.append(("🔥 \(streak)-day streak", "Two minutes of review keeps it going.")) }
        if let s = stats, let weak = StatKind.allCases.min(by: { $0.value(s) < $1.value(s) }), weak.value(s) < 70 {
            eveningLines.append(("Your \(weak.title) is at \(weak.value(s))", "Today’s sortie is the quickest way to raise it."))
        }
        if due > 0 { eveningLines.append(("\(due) question\(due == 1 ? "" : "s") due", "They’re the ones you missed. Clear them before they fade.")) }
        if let s = stats, s.rank > 1 { eveningLines.append(("You’re #\(s.rank) of \(s.total) Boplo pilots", "A sortie today could move you up.")) }
        eveningLines += [
            ("Five minutes, then done", "A short session a day is how the theory sticks."),
            ("Keep the momentum", "A few questions now beats a long cram later."),
            ("Checkride prep", "Practise your weakest subject while it’s quick.")
        ]
        let morningLines: [(String, String)] = [
            ("Today’s sortie is ready", "Go or no-go at \(home)? Three minutes trains all three of your stats."),
            ("New walkaround finding", "Today’s preflight has a problem hidden in it. Would you spot it?"),
            ("Would you fly today?", "Check today’s weather at \(home) and make the call."),
            ("Morning, pilot", "Brief, preflight, debrief: today’s sortie takes about three minutes.")
        ]

        for offset in 0..<daysAhead {
            guard let day = cal.date(byAdding: .day, value: offset, to: Date()) else { continue }
            let full = perDay == 3 && offset < fullDays

            // morning: today's sortie
            if full, !(offset == 0 && sortieToday), let at = cal.date(bySettingHour: 8, minute: 0, second: 0, of: day), at > Date() {
                let c = UNMutableNotificationContent()
                if offset == 0, let s = stats, s.current.days == 1 {
                    c.title = "You’re current for 1 more day"
                    c.body = "Fly today’s sortie to stay current: go or no-go at \(home)?"
                } else {
                    let l = morningLines[(Day.today + offset) % morningLines.count]
                    c.title = l.0; c.body = l.1
                }
                c.sound = .default
                c.userInfo = ["open": "sortie"]
                try? await center.add(UNNotificationRequest(identifier: "boplo-am-\(offset)", content: c, trigger: trigger(at)))
            }

            // midday: a question answered straight from the lock screen
            if full, offset < questions.count, let at = cal.date(bySettingHour: 12, minute: 30, second: 0, of: day), at > Date() {
                let q = questions[offset]
                let order = Array(q.options.indices).shuffled()
                let category = "boplo-q-\(offset)"
                let actions = order.map { UNNotificationAction(identifier: "ans-\($0)", title: q.options[$0], options: []) }
                categories.insert(UNNotificationCategory(identifier: category, actions: actions, intentIdentifiers: [], options: []))
                let c = UNMutableNotificationContent()
                c.title = "Question of the day"
                c.body = q.q + "\nPress and hold to answer."
                c.sound = .default
                c.categoryIdentifier = category
                c.userInfo = ["open": "study", "qid": q.id, "answer": q.answer, "options": q.options, "explain": q.explain]
                try? await center.add(UNNotificationRequest(identifier: "boplo-noon-\(offset)", content: c, trigger: trigger(at)))
            }

            // evening: streak, due reviews, weakest stat, rank (only one a day once the app has gone unopened for a while)
            if !(offset == 0 && (studiedToday || sortieToday)),
               let at = cal.date(bySettingHour: evening.hour ?? 19, minute: evening.minute ?? 0, second: 0, of: day), at > Date() {
                let l = eveningLines[min(offset, eveningLines.count - 1)]
                let c = UNMutableNotificationContent()
                c.title = l.0; c.body = l.1
                c.sound = .default
                c.userInfo = ["open": offset == 0 && due > 0 ? "study" : "sortie"]
                try? await center.add(UNNotificationRequest(identifier: "boplo-study-\(offset)", content: c, trigger: trigger(at)))
            }
        }
        center.setNotificationCategories(categories)
    }

    private static func trigger(_ at: Date) -> UNCalendarNotificationTrigger {
        UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at), repeats: false)
    }

    /// Short questions that fit a notification: missed ones and the weakest subject first, never the same two days running.
    private static func questionsOfTheDay(_ bank: QuestionBank.Pack, st: StudyState, count: Int) -> [QuestionBank.Question] {
        let fits = { (q: QuestionBank.Question) in q.q.count <= 170 && q.options.count >= 2 && q.options.count <= 4 && q.options.allSatisfy { $0.count <= 40 } }
        let pool = bank.questions.filter(fits)
        guard !pool.isEmpty else { return [] }
        let weakest = bank.subjects.compactMap { s in st.score(bank.questions, subject: s.id).map { (s.id, $0) } }.min { $0.1 < $1.1 }?.0
        let ranked = st.mistakes(pool).shuffled() + pool.filter { $0.subject == weakest }.shuffled() + pool.shuffled()
        var seen = Set<String>(), out: [QuestionBank.Question] = []
        for q in ranked where !seen.contains(q.id) {
            seen.insert(q.id); out.append(q)
            if out.count == count { break }
        }
        return out
    }

    /// Answers given on the lock screen are kept on the phone until the app opens, then added to study progress.
    @MainActor
    private static func flushLockScreenAnswers(_ model: AppModel) async {
        let d = UserDefaults.standard
        guard let list = d.array(forKey: answersKey) as? [[String: Any]], !list.isEmpty, model.profile != nil else { return }
        d.removeObject(forKey: answersKey)
        let answers = list.compactMap { a -> (id: String, ok: Bool)? in
            guard let id = a["id"] as? String, let ok = a["ok"] as? Bool else { return nil }
            return (id: id, ok: ok)
        }
        guard !answers.isEmpty else { return }
        var st = StudyState(json: model.profile?.study)
        st.record(answers)
        st.markStudied()
        try? await model.saveProfile(["study": st.json()])
    }

    /// When a subscription is in its introductory free trial, the date the trial ends.
    private static func trialEnd() async -> Date? {
        for await result in Transaction.currentEntitlements {
            guard case .verified(let t) = result, t.revocationDate == nil, let exp = t.expirationDate, exp > Date() else { continue }
            let intro: Bool
            if #available(iOS 17.2, *) { intro = t.offer?.type == .introductory } else { intro = t.offerType == .introductory }
            if intro { return exp }
        }
        return nil
    }

    /// Called by the app delegate when the student answers the question of the day on the lock screen:
    /// remembers the answer and tells them straight away whether they were right.
    static func handleLockScreenAnswer(qid: String, picked: Int, answer: Int, options: [String], explain: String) {
        let ok = picked == answer
        let d = UserDefaults.standard
        var list = d.array(forKey: answersKey) as? [[String: Any]] ?? []
        list.append(["id": qid, "ok": ok])
        d.set(list, forKey: answersKey)
        let c = UNMutableNotificationContent()
        c.title = ok ? "Correct. +1 Knowledge" : "Not quite"
        let right = options.indices.contains(answer) ? options[answer] : ""
        c.body = ok ? explain : "It’s “\(right)”. \(explain)"
        c.userInfo = ["open": "study"]
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "boplo-answer-\(qid)", content: c, trigger: nil))
    }
}

/// Where a tapped notification should take the student; the main screen and the pilot card watch this.
@MainActor
@Observable
final class NotificationRouter {
    static let shared = NotificationRouter()
    var route: String?
}

/// Offer on the Study page: turn on reminders and pick the evening time.
struct ReminderOffer: View {
    @Environment(AppModel.self) private var model
    @State private var at = Calendar.current.date(bySettingHour: 19, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var hidden = Reminders.decided
    @State private var denied = false

    var body: some View {
        if !hidden {
            Tile(spacing: 10) {
                TileHead("Reminders")
                Text("Up to three short nudges a day: today’s sortie in the morning, a question you can answer from your lock screen at lunch, and your streak in the evening. Pick the evening time.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                DatePicker("Evening reminder", selection: $at, displayedComponents: .hourAndMinute)
                    .font(.archivo(15, .medium))
                if denied {
                    Text("Notifications are off for Boplo. Turn them on in Settings › Notifications › Boplo.")
                        .font(.archivo(13.5)).foregroundStyle(Theme.danger)
                }
                HStack(spacing: 10) {
                    Button {
                        let c = Calendar.current.dateComponents([.hour, .minute], from: at)
                        Task {
                            let ok = await Reminders.enable(hour: c.hour ?? 19, minute: c.minute ?? 0, model: model)
                            withAnimation { if ok { hidden = true } else { denied = true } }
                        }
                    } label: { Text("Turn on reminders") }
                        .buttonStyle(.pill(.ink, height: 44))
                    Button("Not now") { Reminders.dismissOffer(); withAnimation { hidden = true } }
                        .font(.archivo(14.5, .semibold))
                        .foregroundStyle(Theme.ink3)
                }
                Text("You can switch to one a day, or off, in the You tab.").font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            }
        }
    }
}

/// Settings row: reminders on/off, how many a day, and the evening time.
struct ReminderSettingsRow: View {
    @Environment(AppModel.self) private var model
    @State private var on = Reminders.isOn
    @State private var perDay = Reminders.perDay
    @State private var at: Date = {
        let t = Reminders.time
        return Calendar.current.date(bySettingHour: t.hour ?? 19, minute: t.minute ?? 0, second: 0, of: Date()) ?? Date()
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("Reminders", isOn: $on)
                .font(.archivo(15.5, .medium))
                .onChange(of: on) { _, v in apply(v) }
            if on {
                Picker("How often", selection: $perDay) {
                    Text("3 a day").tag(3)
                    Text("Once a day").tag(1)
                }
                .pickerStyle(.segmented)
                .onChange(of: perDay) { _, n in Task { await Reminders.setPerDay(n, model: model) } }
                DatePicker(perDay == 3 ? "Evening reminder" : "Reminder time", selection: $at, displayedComponents: .hourAndMinute)
                    .font(.archivo(15))
                    .onChange(of: at) { _, _ in apply(true) }
                Text(perDay == 3 ? "Morning sortie at 8:00, a lock-screen question at 12:30, and your streak in the evening." : "One reminder a day with your streak and what’s due.")
                    .font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            }
        }
    }

    private func apply(_ v: Bool) {
        let c = Calendar.current.dateComponents([.hour, .minute], from: at)
        Task {
            if v {
                let ok = await Reminders.enable(hour: c.hour ?? 19, minute: c.minute ?? 0, model: model)
                if !ok { on = false }
            } else {
                await Reminders.disable(model)
            }
        }
    }
}
