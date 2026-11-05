import Foundation
import WidgetKit

extension AppModel {
    /// Writes what the widgets show into the App Group and asks WidgetKit to redraw, only when it changed.
    func publishWidgets() {
        guard let p = profile else { return }
        var s = WidgetSnapshot()
        s.name = p.firstName
        s.hours = Double(totalMinutes) / 60
        s.goal = p.goalHours ?? 0
        s.dual = Double(minutes(role: "dual")) / 60
        s.solo = Double(minutes(role: "solo")) / 60
        s.pic = Double(minutes(role: "pic")) / 60
        s.flights = flights.count
        s.last30 = Double(flights(inLast: 30).reduce(0) { $0 + $1.mins }) / 60
        s.licence = p.licence ?? ""
        s.home = homeCode
        s.nextLesson = p.nextLesson ?? ""
        s.lessonDate = p.lessonDate ?? ""
        s.lessonTime = p.lessonTime ?? ""
        var old = WidgetSnapshot.load()
        old?.updated = .distantPast
        guard old != s else { return }
        s.updated = Date()
        s.save()
        WidgetCenter.shared.reloadAllTimelines()
    }
}

#if canImport(ActivityKit)
import ActivityKit

/// Starts, updates and ends the recording Live Activity. Updates are throttled: the Lock Screen
/// doesn't need every GPS fix.
@MainActor
enum RecordingActivity {
    private static var activity: Activity<RecordingAttributes>?
    private static var lastUpdate = Date.distantPast

    static func start(at date: Date) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        end()
        let state = RecordingAttributes.ContentState(speedKt: 0, altitudeFt: 0, distanceNm: 0)
        activity = try? Activity.request(attributes: RecordingAttributes(startedAt: date), content: .init(state: state, staleDate: nil))
    }

    static func update(speedKt: Double, altitudeFt: Double, distanceNm: Double) {
        guard let activity, Date().timeIntervalSince(lastUpdate) > 5 else { return }
        lastUpdate = Date()
        let state = RecordingAttributes.ContentState(speedKt: Int(speedKt.rounded()), altitudeFt: Int(altitudeFt.rounded()), distanceNm: distanceNm)
        Task { await activity.update(.init(state: state, staleDate: nil)) }
    }

    static func end() {
        guard let a = activity else { return }
        activity = nil
        Task { await a.end(nil, dismissalPolicy: .immediate) }
    }
}
#endif
