import SwiftUI
import StoreKit
import UserNotifications

/// Local study reminders: a daily nudge at a time the student picks (mentioning their study streak and
/// what's due), and a heads-up the day before an App Store free trial ends. Everything is scheduled on
/// the device and rebuilt whenever the app opens or a study session ends, so the wording stays current.
enum Reminders {
    private static let onKey = "boplo.remind.on"
    private static let hourKey = "boplo.remind.hour"
    private static let minuteKey = "boplo.remind.minute"
    private static let askedKey = "boplo.remind.asked"
    private static let daysAhead = 7

    static var isOn: Bool { UserDefaults.standard.bool(forKey: onKey) }
    /// The student has either turned reminders on or dismissed the offer.
    static var decided: Bool { isOn || UserDefaults.standard.bool(forKey: askedKey) }
    static var time: DateComponents {
        let d = UserDefaults.standard
        let h = d.object(forKey: hourKey) as? Int ?? 19
        let m = d.object(forKey: minuteKey) as? Int ?? 0
        return DateComponents(hour: h, minute: m)
    }

    /// Asks for permission (the first time) and turns the daily reminder on at the given time.
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
    static func disable(_ model: AppModel) async {
        UserDefaults.standard.set(false, forKey: onKey)
        UserDefaults.standard.set(true, forKey: askedKey)
        await refresh(model)
    }

    static func dismissOffer() { UserDefaults.standard.set(true, forKey: askedKey) }

    /// Rebuilds every pending Boplo reminder from the current study state and subscription.
    @MainActor
    static func refresh(_ model: AppModel) async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        center.removePendingNotificationRequests(withIdentifiers: (0..<daysAhead).map { "boplo-study-\($0)" } + ["boplo-trial-end"])
        guard settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional else { return }

        if let end = await trialEnd() {
            let at = end.addingTimeInterval(-24 * 3600)
            if at > Date().addingTimeInterval(60) {
                let c = UNMutableNotificationContent()
                c.title = "Your free trial ends tomorrow"
                c.body = "Boplo Advanced carries on automatically. If it’s not for you, you can cancel any time before then in Settings › Apple Account › Subscriptions."
                c.sound = .default
                let trigger = UNCalendarNotificationTrigger(dateMatching: Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: at), repeats: false)
                try? await center.add(UNNotificationRequest(identifier: "boplo-trial-end", content: c, trigger: trigger))
            }
        }

        guard isOn else { return }
        let st = StudyState(json: model.profile?.study)
        let bank = QuestionBank.shared?.pack(for: model.regime)
        let due = bank.map { st.dueQuestions($0.questions).count } ?? 0
        let streak = st.streak
        let studiedToday = st.days.contains(Day.today)
        let cal = Calendar.current
        let t = time

        for offset in 0..<daysAhead {
            guard let day = cal.date(byAdding: .day, value: offset, to: Date()),
                  let fire = cal.date(bySettingHour: t.hour ?? 19, minute: t.minute ?? 0, second: 0, of: day),
                  fire > Date() else { continue }
            if offset == 0 && studiedToday { continue }
            let c = UNMutableNotificationContent()
            c.sound = .default
            c.userInfo = ["open": "study"]
            if offset == 0 || (offset == 1 && studiedToday) {
                // The next reminder knows the most about today.
                if streak >= 2 {
                    c.title = "Keep your \(streak)-day streak"
                    c.body = due > 0 ? "\(due) question\(due == 1 ? "" : "s") due for review. Five minutes keeps it going." : "Five minutes of study keeps it going."
                } else {
                    c.title = "Time for a little theory"
                    c.body = due > 0 ? "\(due) question\(due == 1 ? "" : "s") due for review today." : "Learn 10 new questions in about five minutes."
                }
            } else {
                let lines = [
                    ("Today’s review is ready", "Questions you missed come back until they stick."),
                    ("Five minutes, then done", "A short session a day is how the theory sticks."),
                    ("Checkride prep", "Practise your weakest subject while it’s quick."),
                    ("Keep the momentum", "A few questions now beats a long cram later.")
                ]
                let l = lines[offset % lines.count]
                c.title = l.0
                c.body = l.1
            }
            let trigger = UNCalendarNotificationTrigger(dateMatching: cal.dateComponents([.year, .month, .day, .hour, .minute], from: fire), repeats: false)
            try? await center.add(UNNotificationRequest(identifier: "boplo-study-\(offset)", content: c, trigger: trigger))
        }
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
}

/// Offer on the Study page: turn on a daily reminder at a chosen time.
struct ReminderOffer: View {
    @Environment(AppModel.self) private var model
    @State private var at = Calendar.current.date(bySettingHour: 19, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var hidden = Reminders.decided
    @State private var denied = false

    var body: some View {
        if !hidden {
            Tile(spacing: 10) {
                TileHead("Daily study reminder")
                Text("Pick a time and Boplo nudges you once a day with what’s due, so your streak keeps going.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                DatePicker("Remind me at", selection: $at, displayedComponents: .hourAndMinute)
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
            }
        }
    }
}

/// A row for settings: reminder on/off and its time, once the offer has been answered.
struct ReminderSettingsRow: View {
    @Environment(AppModel.self) private var model
    @State private var on = Reminders.isOn
    @State private var at: Date = {
        let t = Reminders.time
        return Calendar.current.date(bySettingHour: t.hour ?? 19, minute: t.minute ?? 0, second: 0, of: Date()) ?? Date()
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Toggle("Daily study reminder", isOn: $on)
                .font(.archivo(15.5, .medium))
                .onChange(of: on) { _, v in apply(v) }
            if on {
                DatePicker("Time", selection: $at, displayedComponents: .hourAndMinute)
                    .font(.archivo(15))
                    .onChange(of: at) { _, _ in apply(true) }
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
