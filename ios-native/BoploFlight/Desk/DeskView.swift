import SwiftUI
import MapKit

/// The desk: the same tiles as the web overview, in the same order.
struct DeskView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            Page(title: greeting, subtitle: subtitle) {
                glance
                upNext
                licence
                totals
                momentum
                checklistLink
                theory
                recent
                latestTrack
            }
            .refreshable { await model.refresh() }
            .logFlightButton(model)
            .boploDestinations()
        }
    }

    private var p: Profile? { model.profile }

    private var greeting: String {
        let h = Calendar.current.component(.hour, from: Date())
        let g = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"
        let first = p?.firstName ?? ""
        return "\(g), \(first.isEmpty ? "pilot" : first)."
    }

    private var subtitle: String {
        let n = model.flights.count
        return n == 0 ? "Log your first flight and your desk starts filling in."
            : "\(plural(n, "flight")) logged, \(decimalHours(model.totalMinutes)) hours recorded in total."
    }

    // MARK: Glance

    private var glance: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                statTile(decimalHours(model.totalMinutes), "Hours")
                statTile(model.goalMinutes > 0 ? "\(Int((model.progress * 100).rounded()))%" : "—", model.goalMinutes > 0 ? "Of licence goal" : "Set a goal")
                statTile("\(model.flights.count)", "Flights")
            }
            Button { model.logFlight() } label: { Text("Log flight") }
                .buttonStyle(.pill(.blue, height: 54, full: true))
            Button { model.tab = .study } label: {
                HStack {
                    Text("Study").font(.archivo(15)).foregroundStyle(Theme.ink3)
                    Spacer()
                    Text(studyLine).font(.archivo(15, .semibold)).foregroundStyle(Theme.ink)
                }
                .padding(.horizontal, 18)
                .frame(height: 52)
                .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
            }
            .buttonStyle(.plain)
        }
    }

    private var studySeen: Int {
        guard let bank = QuestionBank.shared else { return 0 }
        return StudyState(json: p?.study).seen(bank.pack(for: model.regime).questions)
    }
    private var studyLine: String { studySeen > 0 ? "\(studySeen) practised" : "Start theory" }

    private func statTile(_ value: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value).font(Theme.display(30)).tracking(-0.8).foregroundStyle(Theme.ink).monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(.archivo(12.5)).foregroundStyle(Theme.ink3).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
    }

    // MARK: Up next

    private var upNext: some View {
        let checks = p?.checks ?? []
        let done = checks.filter(\.done).count
        let d = Day.daysUntil(p?.lessonDate)
        let when: String = {
            guard let d else { return "No date set" }
            switch d {
            case 0: return "Today"
            case 1: return "Tomorrow"
            case 2...: return "In \(d) days"
            default: return "\(-d) days ago"
            }
        }()
        return DarkTile(spacing: 12) {
            HStack {
                Text("Up next").font(.archivo(17, .semibold))
                Spacer()
                Chip(text: when, tone: .dark)
            }
            Text(p?.nextLesson?.isEmpty == false ? p!.nextLesson! : "Add your next lesson")
                .font(Theme.display(32))
                .tracking(-1)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            let meta = [p?.airport, p?.aircraft].compactMap { $0 }.filter { !$0.isEmpty }
            if p?.lessonDate?.isEmpty == false || !meta.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    if p?.lessonDate?.isEmpty == false {
                        Text(Day.long(p?.lessonDate) + (p?.lessonTime?.isEmpty == false ? " · \(p!.lessonTime!)" : ""))
                            .font(.archivo(15, .semibold))
                    }
                    if !meta.isEmpty {
                        Text(meta.joined(separator: " · ")).font(.archivo(14.5)).foregroundStyle(Theme.mist)
                    }
                }
            }
            if let q = p?.questionList.first {
                Text(q)
                    .font(.archivo(14.5))
                    .foregroundStyle(Color(hex: 0xE6F0FF).opacity(0.9))
                    .padding(.vertical, 12)
                    .padding(.horizontal, 14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.ice.opacity(0.06), in: UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 0, bottomTrailingRadius: 12, topTrailingRadius: 12))
                    .overlay(alignment: .leading) { Rectangle().fill(Theme.ice).frame(width: 2) }
            }
            HStack(spacing: 12) {
                if checks.isEmpty {
                    Text("No preparation checklist yet").font(.archivo(13.5)).foregroundStyle(Theme.mist)
                } else {
                    Bar(value: Double(done) / Double(checks.count), height: 5, track: Theme.ice.opacity(0.16), fill: Theme.electricHi)
                        .frame(width: 90)
                    Text("\(done) of \(checks.count) prepared").font(.archivo(13.5)).foregroundStyle(Theme.mist)
                }
                Spacer(minLength: 0)
            }
            NavigationLink(value: Route.prepare) { Text("Prepare") }
                .buttonStyle(.pill(.light, height: 46, spark: true))
                .padding(.top, 2)
        }
    }

    // MARK: Licence

    private var licence: some View {
        let total = Double(model.totalMinutes) / 60
        let goal = p?.goalHours ?? 0
        return Tile {
            TileHead(title: "Toward your licence") {
                NavigationLink(value: Route.profile) { Text("Edit").font(.archivo(14, .semibold)).foregroundStyle(Theme.electric) }
            }
            Ring(progress: model.progress) {
                VStack(spacing: 2) {
                    Text(String(format: "%.1f", total)).font(Theme.display(32)).tracking(-1).monospacedDigit()
                    Text(goal > 0 ? "of \(Int(goal)) h goal" : "hours recorded").font(.archivo(12)).foregroundStyle(Theme.ink3)
                }
            }
            .frame(maxWidth: .infinity)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(goal > 0 ? "\(String(format: "%.1f", total)) of a \(Int(goal)) hour goal" : "\(String(format: "%.1f", total)) hours recorded")
            HStack(alignment: .top) {
                fact("Licence", p?.licence ?? "—")
                fact("Authority", shortAuthority)
                fact("Target date", p?.target?.isEmpty == false ? Day.monthYear(p?.target) : "Not set")
            }
            if goal > 0, let l = p?.licence, !l.isEmpty {
                Footnote(text: "Published minimum for \(l): \(Int(goal)) h. Your instructor and authority decide what counts.")
            } else if goal == 0 {
                Footnote(text: "Set an hours goal in your profile to see progress here.")
            }
        }
    }

    private var shortAuthority: String {
        let a = p?.authority ?? "—"
        return a.replacingOccurrences(of: " (EASA)", with: "")
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(spacing: 3) {
            Text(label).font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            Text(value).font(.archivo(15, .semibold)).multilineTextAlignment(.center).lineLimit(2).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Totals

    private var totals: some View {
        let last30 = model.flights(inLast: 30)
        let nonDual = model.minutes(role: "solo") + model.minutes(role: "pic")
        return VStack(spacing: 0) {
            HStack(spacing: 0) {
                stat("Total time", decimalHours(model.totalMinutes), "h", (p?.openingMinutes ?? 0) > 0 ? "Includes \(decimalHours(Int(p?.openingMinutes ?? 0))) h from before" : "From your logged flights")
                Divider().overlay(Theme.hair)
                stat("Last 30 days", decimalHours(last30.reduce(0) { $0 + $1.mins }), "h", plural(last30.count, "flight"))
            }
            Divider().overlay(Theme.hair)
            HStack(spacing: 0) {
                stat("Landings", "\(model.landings)", nil, "Across all flights")
                Divider().overlay(Theme.hair)
                stat("Solo and PIC", decimalHours(nonDual), "h", "\(decimalHours(model.minutes(role: "dual"))) h dual")
            }
        }
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous).strokeBorder(Theme.hair))
    }

    private func stat(_ label: String, _ value: String, _ unit: String?, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.archivo(13)).foregroundStyle(Theme.ink3)
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(value).font(.archivo(28, .semibold)).tracking(-0.8).monospacedDigit()
                if let unit { Text(unit).font(.archivo(14, .medium)).foregroundStyle(Theme.ink3) }
            }
            Text(note).font(.archivo(12.5)).foregroundStyle(Theme.ink3).lineLimit(2)
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    // MARK: Momentum

    private var momentum: some View {
        let m = model.momentum
        let maxN = max(m.target, Double(m.weeks.max() ?? 0), 1)
        return Tile {
            TileHead(title: "Momentum") {
                if m.streak > 1 { Chip(text: "\(m.streak)-week streak", tone: .ok) }
            }
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(m.gap.map { String($0) } ?? "—").font(Theme.display(52)).tracking(-1.5)
                Text(m.gap == nil ? "no flights yet" : m.gap == 1 ? "day since your last flight" : "days since your last flight")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink2)
            }
            Text(m.message).font(.archivo(14.5)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(Array(m.weeks.enumerated()), id: \.offset) { i, n in
                    VStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(n > 0 ? (Double(n) >= m.target ? Theme.electric : Theme.electric.opacity(0.55)) : Theme.ink.opacity(0.08))
                            .frame(height: n > 0 ? max(12, CGFloat(Double(n) / maxN) * 64) : 3)
                        Text(i == 7 ? "This wk" : " ").font(.archivo(9.5)).foregroundStyle(Theme.ink3).lineLimit(1).fixedSize()
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 84, alignment: .bottom)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Flights per week over the last 8 weeks: \(m.weeks.map { String($0) }.joined(separator: ", "))")
            Footnote(text: String(format: "%.1f flights a week lately · target %@ (from your profile)", m.lately, m.target < 1 ? String(format: "%.2g", m.target) : String(Int(m.target))))
        }
    }

    // MARK: Checklist, theory

    private var checklistLink: some View {
        NavigationLink(value: Route.web(.progress)) {
            Tile(spacing: 10) {
                if let rq = LicenceChecklist(model) {
                    TileHead(title: "Licence checklist") {
                        Chip(text: "\(rq.doneCount) of \(rq.items.count) done", tone: rq.doneCount == rq.items.count ? .ok : .plain)
                    }
                    if let next = rq.next {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Next milestone").font(.archivo(12, .semibold)).foregroundStyle(Theme.electric)
                            Text(next.req.label).font(.archivo(15.5, .semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                            if next.unit == "h" {
                                Text(String(format: "%.1f h to go", max(0, next.need - next.have))).font(.archivo(13)).foregroundStyle(Theme.ink3)
                            }
                        }
                        .padding(12)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.electric.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    ForEach(rq.items.filter { !$0.done }.prefix(4)) { item in
                        ChecklistRow(item: item, interactive: false)
                    }
                    Text("See the full checklist").font(.archivo(14, .semibold)).foregroundStyle(Theme.electric)
                } else {
                    TileHead("Licence checklist")
                    Text("Choose a licence in your profile to see what it needs.").font(.archivo(14)).foregroundStyle(Theme.ink3)
                }
            }
        }
        .buttonStyle(.plain)
    }

    private var theory: some View {
        let mocks = StudyState(json: p?.study).mocks
        return Tile {
            TileHead(title: "Theory") { TextLink(title: "Study") { model.tab = .study } }
            if let last = mocks.last {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(last.s)%").font(Theme.display(36)).foregroundStyle(last.s >= model.passMark ? Theme.ok : Theme.danger)
                    Text("Last mock exam · pass mark \(model.passMark)%").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                }
            } else {
                Text(studySeen > 0 ? "\(studySeen) questions practised so far." : "Practise theory between lessons in short sessions.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            }
            Button { model.tab = .study } label: { Text(studySeen > 0 ? "Keep practising" : "Start practising") }
                .buttonStyle(.pill(.ink, height: 46, spark: true))
        }
    }

    // MARK: Recent, track

    private var recent: some View {
        let list = model.sortedFlights
        return Tile(spacing: 10) {
            TileHead(title: "Recent flights") {
                if !list.isEmpty { TextLink(title: "Open logbook") { model.tab = .logbook } }
            }
            if list.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Your first flight goes here.").font(.archivo(17, .semibold))
                    Text("Log the time, role, landings and what you learned while it’s fresh.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                    Button { model.logFlight() } label: { Text("Log a flight") }.buttonStyle(.pill(.blue, height: 46, spark: true))
                }
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(list.prefix(5).enumerated()), id: \.element.id) { i, f in
                        NavigationLink(value: Route.flight(f)) {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 3) {
                                    Text("\(f.dep) → \(f.arr)").font(.archivo(15.5, .semibold)).foregroundStyle(Theme.ink)
                                    Text([Day.dayMonth(f.date), f.lesson, f.aircraft].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                        .font(.archivo(13)).foregroundStyle(Theme.ink3).lineLimit(1)
                                }
                                Spacer(minLength: 6)
                                VStack(alignment: .trailing, spacing: 4) {
                                    Text(hoursText(f.mins)).font(.archivo(16, .semibold)).monospacedDigit().foregroundStyle(Theme.ink)
                                    RolePill(role: f.role)
                                }
                            }
                            .padding(.vertical, 12)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        if i < min(list.count, 5) - 1 { Divider().overlay(Theme.hair) }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var latestTrack: some View {
        if let f = model.sortedFlights.first(where: { $0.track.count >= 2 }) {
            Tile {
                TileHead(title: "Latest track") {
                    NavigationLink(value: Route.trackMap) { Text("Open map").font(.archivo(14, .semibold)).foregroundStyle(Theme.electric) }
                }
                TrackPreview(points: f.track)
                    .frame(height: 210)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                HStack {
                    Text("\(f.dep) → \(f.arr)").font(.archivo(14, .semibold)) + Text(" · \(Day.short(f.date))").font(.archivo(14)).foregroundColor(Theme.ink3)
                    Spacer()
                    Text("\(hoursText(f.mins)) · \(f.roleLabel)").font(.archivo(14)).foregroundStyle(Theme.ink3)
                }
            }
        }
    }
}

/// A static satellite map framed on one track.
struct TrackPreview: View {
    let points: [TrackPoint]
    var body: some View {
        Map(initialPosition: .rect(TrackPreview.rect(points)), interactionModes: []) {
            MapPolyline(coordinates: points.map(\.coordinate))
                .stroke(Theme.electric.opacity(0.55), lineWidth: 8)
            MapPolyline(coordinates: points.map(\.coordinate))
                .stroke(Theme.ice, lineWidth: 2.5)
        }
        .mapStyle(.imagery(elevation: .flat))
        .allowsHitTesting(false)
    }

    static func rect(_ pts: [TrackPoint]) -> MKMapRect {
        var r = MKMapRect.null
        for p in pts { let mp = MKMapPoint(p.coordinate); r = r.union(MKMapRect(x: mp.x, y: mp.y, width: 1, height: 1)) }
        let pad = max(r.width, r.height) * 0.25 + 2000
        return r.insetBy(dx: -pad, dy: -pad)
    }
}
