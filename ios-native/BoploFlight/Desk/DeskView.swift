import SwiftUI

struct DeskView: View {
    @Environment(AppModel.self) private var model
    @State private var showLog = false
    @State private var showPrep = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    header
                    nextLessonCard
                    progressCard
                    recentCard
                }
                .padding(16)
            }
            .background(Theme.cloud.ignoresSafeArea())
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showLog = true } label: { Label("Log a flight", systemImage: "plus.circle.fill") }
                }
            }
            .sheet(isPresented: $showLog) { FlightFormView() }
            .sheet(isPresented: $showPrep) { LessonPrepView() }
        }
    }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
        let first = model.profile?.firstName ?? ""
        return first.isEmpty ? "\(part)." : "\(part), \(first)."
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(greeting)
                .font(Theme.display(30))
                .foregroundStyle(Theme.ink)
            Text("\(model.flights.count) \(model.flights.count == 1 ? "flight" : "flights") logged · \(hoursText(model.totalMinutes)) in total")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 4)
    }

    private var nextLessonCard: some View {
        Button { showPrep = true } label: {
            VStack(alignment: .leading, spacing: 10) {
                Text("Up next")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.ice)
                Text(model.profile?.nextLesson?.isEmpty == false ? model.profile!.nextLesson! : "Add your next lesson")
                    .font(Theme.display(26))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                if let when = lessonWhen {
                    Text(when).font(.subheadline).foregroundStyle(Theme.mist)
                }
                HStack {
                    Spacer()
                    Label("Prepare", systemImage: "arrow.right")
                        .labelStyle(.titleAndIcon)
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(.white, in: Capsule())
                        .foregroundStyle(Theme.ink)
                }
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                LinearGradient(colors: [Theme.deep, Theme.night], startPoint: .topLeading, endPoint: .bottomTrailing),
                in: RoundedRectangle(cornerRadius: 22, style: .continuous)
            )
        }
        .buttonStyle(.plain)
    }

    private var lessonWhen: String? {
        guard let d = model.profile?.lessonDate, let date = Flight.dayFormat.date(from: d) else { return nil }
        let f = DateFormatter(); f.dateFormat = "EEEE d MMMM"; f.timeZone = TimeZone(identifier: "UTC")
        let time = model.profile?.lessonTime ?? ""
        return f.string(from: date) + (time.isEmpty ? "" : " · \(time)") + (model.profile?.airport.map { $0.isEmpty ? "" : " · \($0)" } ?? "")
    }

    private var progressCard: some View {
        Card {
            HStack(spacing: 18) {
                ZStack {
                    Circle().stroke(Theme.cloud, lineWidth: 10)
                    Circle()
                        .trim(from: 0, to: model.progress)
                        .stroke(Theme.electric, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                    VStack(spacing: 0) {
                        Text(String(format: "%.1f", Double(model.totalMinutes) / 60))
                            .font(.title2.bold().italic())
                        Text("of \(Int(model.profile?.goalHours ?? 0)) h")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .frame(width: 96, height: 96)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Toward your licence").font(.headline)
                    Text(model.profile?.licence ?? "").font(.subheadline).foregroundStyle(.secondary)
                    Text(model.profile?.authority ?? "").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            Divider()
            HStack {
                stat("Dual", hoursText(model.minutes(role: "dual")))
                stat("Solo", hoursText(model.minutes(role: "solo") + model.minutes(role: "pic")))
                stat("Landings", "\(model.landings)")
            }
            Text("Hours against the published minimum. Your instructor and authority decide what counts.")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(.title3.bold()).monospacedDigit()
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var recentCard: some View {
        Card {
            HStack {
                Text("Recent flights").font(.headline)
                Spacer()
                if model.flights.isEmpty {
                    Button("Log one") { showLog = true }.font(.subheadline.weight(.semibold))
                }
            }
            if model.flights.isEmpty {
                Text("Your flights will appear here, with the track on a map when you record one.")
                    .font(.subheadline).foregroundStyle(.secondary)
            } else {
                ForEach(model.flights.prefix(3)) { flight in
                    NavigationLink(value: flight) { FlightRow(flight: flight) }
                        .buttonStyle(.plain)
                    if flight != model.flights.prefix(3).last { Divider() }
                }
            }
        }
        .navigationDestination(for: Flight.self) { FlightDetailView(flight: $0) }
    }
}
