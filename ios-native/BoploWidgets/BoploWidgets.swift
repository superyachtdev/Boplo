import WidgetKit
import SwiftUI

@main
struct BoploWidgetsBundle: WidgetBundle {
    var body: some Widget {
        HoursWidget()
        NextLessonWidget()
        RecordingLiveActivity()
    }
}

// MARK: - Look

enum W {
    static let night = Color(red: 0.008, green: 0.024, blue: 0.067)
    static let navy = Color(red: 0.039, green: 0.102, blue: 0.267)
    static let electric = Color(red: 0.039, green: 0.384, blue: 1)
    static let electricHi = Color(red: 0.184, green: 0.482, blue: 1)
    static let ice = Color(red: 0.62, green: 0.847, blue: 1)
    static let mist = Color(red: 0.56, green: 0.627, blue: 0.769)
    static let solo = Color(red: 0.275, green: 0.761, blue: 1)
    static let pic = Color(red: 0.612, green: 0.525, blue: 1)

    static func display(_ size: CGFloat, bold: Bool = false) -> Font { .custom(bold ? "ArchivoDisplay-BoldItalic" : "ArchivoDisplay-Italic", size: size) }
    static func text(_ size: CGFloat, _ semibold: Bool = false) -> Font { .custom(semibold ? "Archivo-SemiBold" : "Archivo-Regular", size: size) }

    static var sky: some View {
        LinearGradient(colors: [night, navy], startPoint: .top, endPoint: .bottom)
    }
}

// MARK: - Timeline

struct SnapshotEntry: TimelineEntry {
    let date: Date
    let snap: WidgetSnapshot?
}

struct SnapshotProvider: TimelineProvider {
    func placeholder(in context: Context) -> SnapshotEntry { SnapshotEntry(date: .now, snap: .sample) }
    func getSnapshot(in context: Context, completion: @escaping (SnapshotEntry) -> Void) {
        completion(SnapshotEntry(date: .now, snap: context.isPreview ? (WidgetSnapshot.load() ?? .sample) : WidgetSnapshot.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<SnapshotEntry>) -> Void) {
        let entry = SnapshotEntry(date: .now, snap: WidgetSnapshot.load())
        // Refresh hourly so "tomorrow" turns into "today" on time; the app also reloads on every change.
        completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(3600))))
    }
}

// MARK: - Hours widget

struct HoursWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BoploHours", provider: SnapshotProvider()) { entry in
            HoursWidgetView(entry: entry)
        }
        .configurationDisplayName("Hours")
        .description("Your hours toward the licence, on the dial.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

struct HoursWidgetView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if let s = entry.snap {
                switch family {
                case .accessoryCircular:
                    Gauge(value: s.progress) {
                        Image(systemName: "airplane")
                    } currentValueLabel: {
                        Text(String(format: "%.0f", s.hours))
                    }
                    .gaugeStyle(.accessoryCircular)
                case .accessoryRectangular:
                    VStack(alignment: .leading, spacing: 1) {
                        Text("\(String(format: "%.1f", s.hours)) h").font(.headline)
                        Gauge(value: s.progress) { EmptyView() }.gaugeStyle(.accessoryLinear)
                        Text(s.goal > 0 ? "of \(Int(s.goal)) h · \(s.licence)" : s.licence).font(.caption2)
                    }
                case .accessoryInline:
                    Text("\(String(format: "%.1f", s.hours)) of \(Int(s.goal)) h")
                case .systemMedium:
                    HStack(spacing: 16) {
                        Dial(snap: s).frame(width: 118, height: 118)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Up next").font(W.text(12, true)).foregroundStyle(W.ice)
                            Text(s.nextLesson.isEmpty ? "No lesson booked" : s.nextLesson)
                                .font(W.display(20)).foregroundStyle(.white).lineLimit(2)
                            if let d = s.lessonDay {
                                Text(LessonWhen.text(d, time: s.lessonTime)).font(W.text(12.5, true)).foregroundStyle(.white.opacity(0.85))
                            }
                            Spacer(minLength: 0)
                            Text("\(s.flights) flights · \(String(format: "%.1f", s.last30)) h in 30 days").font(W.text(11.5)).foregroundStyle(W.mist)
                        }
                        Spacer(minLength: 0)
                    }
                default:
                    VStack(spacing: 4) {
                        Dial(snap: s).frame(width: 104, height: 104)
                        Text(s.goal > 0 ? "\(Int((s.progress * 100).rounded()))% of \(Int(s.goal)) h" : "\(s.flights) flights")
                            .font(W.text(11.5, true)).foregroundStyle(W.mist)
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Image(systemName: "airplane").foregroundStyle(W.ice)
                    Text("Open Boplo to set up your desk.").font(W.text(13, true)).foregroundStyle(.white)
                }
            }
        }
        .containerBackground(for: .widget) { W.sky }
    }
}

/// The airspeed-style hours dial, simplified for widget sizes.
struct Dial: View {
    let snap: WidgetSnapshot
    var body: some View {
        let scale = max(snap.goal, snap.hours, 1)
        let other = max(0, snap.hours - snap.dual - snap.solo - snap.pic)
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            ZStack {
                arc(0, 1, W.ice.opacity(0.12), size)
                let parts: [(Double, Color)] = [(other, W.mist), (snap.dual, W.electricHi), (snap.solo, W.solo), (snap.pic, W.pic)]
                ForEach(0..<parts.count, id: \.self) { i in
                    let from = parts[..<i].reduce(0) { $0 + $1.0 } / scale
                    arc(from, from + parts[i].0 / scale, parts[i].1, size)
                }
                // Needle
                Capsule().fill(.white).frame(width: 2.5, height: size * 0.36)
                    .offset(y: -size * 0.18 + 5)
                    .rotationEffect(.degrees(225 + 270 * min(1, snap.hours / scale)))
                Circle().fill(W.navy).frame(width: 9, height: 9).overlay(Circle().stroke(.white, lineWidth: 1.5))
                VStack(spacing: 0) {
                    Text(String(format: "%.1f", snap.hours)).font(W.display(size * 0.2, bold: true)).foregroundStyle(.white)
                    Text("hours").font(W.text(size * 0.085)).foregroundStyle(W.mist)
                }
                .offset(y: size * 0.27)
            }
            .frame(width: size, height: size)
        }
    }

    private func arc(_ from: Double, _ to: Double, _ color: Color, _ size: CGFloat) -> some View {
        Circle()
            .trim(from: 0.125 + 0.75 * max(0, min(1, from)), to: 0.125 + 0.75 * max(0, min(1, to)))
            .stroke(color, style: StrokeStyle(lineWidth: size * 0.06, lineCap: .butt))
            .rotationEffect(.degrees(90))
            .padding(size * 0.05)
    }
}

enum LessonWhen {
    static func text(_ day: Date, time: String) -> String {
        let cal = Calendar.current
        let d = cal.dateComponents([.day], from: cal.startOfDay(for: .now), to: cal.startOfDay(for: day)).day ?? 0
        let when: String
        switch d {
        case 0: when = "Today"
        case 1: when = "Tomorrow"
        case 2..<7: when = day.formatted(.dateTime.weekday(.wide))
        case ..<0: when = "Was \(day.formatted(.dateTime.day().month()))"
        default: when = day.formatted(.dateTime.day().month())
        }
        return time.isEmpty ? when : "\(when) · \(time)"
    }
}

// MARK: - Next lesson widget

struct NextLessonWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "BoploNextLesson", provider: SnapshotProvider()) { entry in
            NextLessonView(entry: entry)
        }
        .configurationDisplayName("Next lesson")
        .description("What's up next, and when.")
        .supportedFamilies([.systemSmall, .accessoryRectangular])
    }
}

struct NextLessonView: View {
    let entry: SnapshotEntry
    @Environment(\.widgetFamily) private var family

    var body: some View {
        Group {
            if family == .accessoryRectangular {
                VStack(alignment: .leading, spacing: 1) {
                    Text(entry.snap?.lessonDay.map { LessonWhen.text($0, time: entry.snap?.lessonTime ?? "") } ?? "Up next").font(.caption).bold()
                    Text(entry.snap?.nextLesson.isEmpty == false ? entry.snap!.nextLesson : "No lesson booked").font(.headline).lineLimit(2)
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("Up next").font(W.text(12, true)).foregroundStyle(W.ice)
                        Spacer()
                        if let home = entry.snap?.home, !home.isEmpty {
                            Text(home).font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(W.mist)
                        }
                    }
                    Spacer(minLength: 0)
                    Text(entry.snap?.nextLesson.isEmpty == false ? entry.snap!.nextLesson : "Add your next lesson in Boplo")
                        .font(W.display(21)).foregroundStyle(.white).lineLimit(3).minimumScaleFactor(0.8)
                    if let s = entry.snap, let d = s.lessonDay {
                        Text(LessonWhen.text(d, time: s.lessonTime)).font(W.text(12.5, true)).foregroundStyle(W.ice)
                    }
                }
            }
        }
        .containerBackground(for: .widget) { W.sky }
    }
}
