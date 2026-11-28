import SwiftUI

/// Boplo's own usage events, for the owner's retention dashboard: which screen people are on, where they
/// leave, and how the trial goes. Events go only to Boplo's server (POST /flight/events), never to a
/// third party, and carry no names, emails or flight details: a screen name, an event name and a few labels.
///
/// Events are queued and sent in small batches: every 20 seconds, when 15 are waiting, and when the app
/// goes to the background. Anything not sent yet is saved and tried again on the next launch.
@MainActor
enum Track {
    private static let deviceKey = "boplo.track.device"
    private static let queueKey = "boplo.track.queue"
    /// A random ID for this install, so the steps before sign-in join up with the account afterwards.
    static let device: String = {
        let d = UserDefaults.standard
        if let id = d.string(forKey: deviceKey) { return id }
        let id = UUID().uuidString.lowercased()
        d.set(id, forKey: deviceKey)
        return id
    }()

    /// A visit: a new one starts on every launch, and after 5 minutes in the background.
    private(set) static var session = newSession()
    private(set) static var screenName = ""
    private static var queue: [[String: Any]] = loadQueue()
    private static var backgroundAt: Date?
    private static var timer: Timer?
    private static var sending = false
    private static var backgroundTask: UIBackgroundTaskIdentifier = .invalid

    private static func newSession() -> String { String(UUID().uuidString.lowercased().prefix(13)) }

    /// The screen someone is now looking at. A repeat of the same screen is ignored.
    static func screen(_ name: String) {
        guard name != screenName else { return }
        screenName = name
        add(kind: "screen", name: name, props: [:])
    }

    /// Something that happened: `onboarding_done`, `purchase_success`, and so on.
    static func event(_ name: String, _ props: [String: Any] = [:]) {
        add(kind: "event", name: name, props: props)
    }

    /// Called once at launch.
    static func start() {
        add(kind: "event", name: "app_open", props: ["v": appVersion])
        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { _ in Task { @MainActor in flush() } }
    }

    static func didEnterBackground() {
        backgroundAt = Date()
        add(kind: "event", name: "app_background", props: ["screen": screenName])
        save()
        flush(background: true)
    }

    static func willEnterForeground() {
        if let at = backgroundAt, Date().timeIntervalSince(at) > 300 {
            session = newSession()
            add(kind: "event", name: "app_resume", props: ["screen": screenName])
            // the first screen of a new visit is recorded again, so each visit starts with a screen
            let s = screenName; screenName = ""; if !s.isEmpty { screen(s) }
        }
        backgroundAt = nil
    }

    private static var appVersion: String {
        let i = Bundle.main.infoDictionary
        return "\(i?["CFBundleShortVersionString"] as? String ?? "?") (\(i?["CFBundleVersion"] as? String ?? "?"))"
    }

    private static func add(kind: String, name: String, props: [String: Any]) {
        var e: [String: Any] = ["t": Int(Date().timeIntervalSince1970 * 1000), "k": kind, "n": name, "s": session]
        if !props.isEmpty { e["p"] = props }
        queue.append(e)
        if queue.count > 500 { queue.removeFirst(queue.count - 500) }
        if queue.count >= 15 { flush() }
    }

    static func flush(background: Bool = false) {
        guard !sending, !queue.isEmpty else { return }
        sending = true
        let batch = Array(queue.prefix(100))
        if background && backgroundTask == .invalid {
            backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "boplo.track") { Task { @MainActor in endBackground() } }
        }
        Task { @MainActor in
            defer {
                sending = false
                endBackground()
            }
            do {
                try await API.shared.send("flight/events", method: "POST", body: ["device": device, "platform": "ios", "v": appVersion, "events": batch])
                queue.removeFirst(min(batch.count, queue.count))
                save()
            } catch {
                // kept for the next try; a 4xx means the batch itself is bad, so it is dropped
                if let e = error as? APIError, (400..<500).contains(e.status), e.status != 401, e.status != 429 {
                    queue.removeFirst(min(batch.count, queue.count)); save()
                }
            }
        }
    }

    private static func endBackground() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private static func save() {
        guard let data = try? JSONSerialization.data(withJSONObject: queue) else { return }
        UserDefaults.standard.set(data, forKey: queueKey)
    }

    private static func loadQueue() -> [[String: Any]] {
        guard let data = UserDefaults.standard.data(forKey: queueKey),
              let list = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return Array(list.suffix(300))
    }
}

extension View {
    /// Records this screen for the retention dashboard each time it appears.
    @MainActor func screen(_ name: String) -> some View {
        onAppear { Track.screen(name) }
    }
}
