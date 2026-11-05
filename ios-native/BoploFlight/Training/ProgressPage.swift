import SwiftUI

/// Licence checklist worked out from the logbook, the same rules as the web app's requirements().
@MainActor
struct LicenceChecklist {
    struct Item: Identifiable {
        let id: String
        let req: Requirement
        var have: Double
        var need: Double
        var done: Bool
        var auto: Bool
        var unit: String
        var found: Flight?
        var medicalAuto = false
        var pct: Double { max(0, min(1, have / max(need, 0.0001))) }
        var amount: String {
            if unit == "h" { return String(format: "%.1f of %@ h", min(have, need), need.clean) }
            if req.k == "nightldg" { return "\(Int(min(have, need))) of \(need.clean)" }
            return done ? "Done" : "To do"
        }
    }

    let items: [Item]
    let licence: LicenceInfo?
    var doneCount: Int { items.filter(\.done).count }
    var next: Item? {
        let open = items.filter { !$0.done }
        return open.filter { ["dual", "solo", "soloxc", "nightldg", "total"].contains($0.req.k) }.max { $0.pct < $1.pct } ?? open.first
    }

    static func key(_ model: AppModel) -> String { "\(model.regime)|\(model.profile?.licence ?? "")" }

    init?(_ model: AppModel) {
        guard let list = Rules.requirements(model.regime, model.profile?.licence) else { return nil }
        let ticks = (model.json("reqs")[Self.key(model)] as? [String: Any]) ?? [:]
        let docs = model.json("docs")
        let medical = docs["medical"] as? String ?? ""
        let fl = model.flights
        func h(_ pred: (Flight) -> Bool) -> Double { Double(fl.filter(pred).reduce(0) { $0 + $1.mins }) / 60 }
        items = list.enumerated().map { i, q in
            var o = Item(id: q.id ?? "\(q.k)\(i)", req: q, have: 0, need: q.need, done: false, auto: true, unit: "h")
            switch q.k {
            case "total": o.have = Double(model.totalMinutes) / 60
            case "dual": o.have = h { ($0.role ?? "dual") == "dual" }
            case "solo": o.have = h { $0.role == "solo" }
            case "soloxc": o.have = h { $0.role == "solo" && Geo.isCrossCountry($0) }
            case "nightldg": o.have = Double(fl.reduce(0) { $0 + Int($1.nightLandings ?? 0) }); o.unit = ""
            case "longxc":
                let hit = fl.sorted { $0.date < $1.date }.first { $0.role == "solo" && Geo.trackNM($0) >= (q.nm ?? 150) }
                o = Item(id: "longxc", req: q, have: 0, need: 1, done: hit != nil || ticks["longxc"] != nil, auto: hit != nil, unit: "flight", found: hit)
                o.have = o.done ? 1 : 0
            default:
                let medOK = q.id == "medical" && !medical.isEmpty && medical >= Day.todayISO
                o = Item(id: q.id ?? "m\(i)", req: q, have: 0, need: 1, done: ticks[q.id ?? ""] != nil || medOK, auto: false, unit: "", medicalAuto: medOK)
                o.have = o.done ? 1 : 0
            }
            if ["total", "dual", "solo", "soloxc", "nightldg"].contains(q.k) { o.done = o.have >= q.need }
            return o
        }
        licence = Rules.licence(model.regime, model.profile?.licence)
    }
}

extension Double {
    var clean: String { self == rounded() ? String(Int(self)) : String(format: "%.1f", self) }
}

struct ChecklistRow: View {
    let item: LicenceChecklist.Item
    var interactive = true
    var toggle: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle().strokeBorder(item.done ? Theme.ok : Theme.mist.opacity(0.6), lineWidth: 1.5)
                    .background(Circle().fill(item.done ? Theme.ok : .clear))
                if item.done { Image(systemName: "checkmark").font(.system(size: 11, weight: .bold)).foregroundStyle(.white) }
            }
            .frame(width: 22, height: 22)
            .padding(.top, 1)
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.req.label).font(.archivo(15, .semibold)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 8)
                    Text(item.amount).font(.archivo(13.5)).foregroundStyle(Theme.ink3).monospacedDigit()
                }
                if item.unit == "h" || item.req.k == "nightldg" {
                    Bar(value: item.pct, height: 5, fill: item.done ? Theme.ok : Theme.electric)
                }
                if let f = item.found {
                    Footnote(text: "Found in your logbook: \(Day.full(f.date)), \(f.dep) → \(f.arr), \(Int(Geo.trackNM(f).rounded())) NM tracked. Check the landings count for your licence.")
                } else if item.req.k == "longxc" && !item.done {
                    Footnote(text: "Boplo spots this from a solo flight’s track. Without a track, tick it once your instructor confirms it.")
                } else if item.medicalAuto {
                    Footnote(text: "From the medical expiry date in Currency.")
                } else if !item.req.note.isEmpty {
                    Footnote(text: item.req.note)
                }
                if interactive && !item.auto && !item.medicalAuto, let toggle {
                    Button(item.done ? "Undo" : "Mark done", action: toggle)
                        .buttonStyle(.pill(item.done ? .line : .ink, height: 34))
                }
            }
        }
        .padding(.vertical, 6)
    }
}

/// Progress: licence checklist, syllabus and milestones.
struct TrainingProgressPage: View {
    @Environment(AppModel.self) private var model
    @State private var error: String?
    @State private var shareItem: Milestone?

    var body: some View {
        Page(title: "Progress", subtitle: "Track what your licence needs, the syllabus you’ve covered, and the moments worth celebrating.") {
            checklist
            wins
            syllabus
            milestones
            ErrorText(text: error)
        }
        .navigationTitle("Progress")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(item: $shareItem) { m in MilestoneShareSheet(milestone: m) }
    }

    // MARK: Checklist

    @ViewBuilder
    private var checklist: some View {
        if let rq = LicenceChecklist(model) {
            Tile(spacing: 10) {
                TileHead(title: "What \(rq.licence?.id ?? model.profile?.licence ?? "your licence") needs") {
                    Chip(text: "\(rq.doneCount) of \(rq.items.count) done", tone: rq.doneCount == rq.items.count ? .ok : .plain)
                }
                ForEach(rq.items) { item in
                    ChecklistRow(item: item) { Task { await toggle(item.id) } }
                    if item.id != rq.items.last?.id { Divider().overlay(Theme.hair) }
                }
                Footnote(text: "Worked out from your logbook: dual and solo time come from each flight’s role, and cross-country counts flights that land somewhere other than where they started. Hours from before Boplo count toward the total only. Your instructor and authority decide what counts.")
                if let l = rq.licence, let url = URL(string: l.url), !l.url.isEmpty {
                    Link(l.source, destination: url).font(.archivo(12.5, .semibold)).foregroundStyle(Theme.electric)
                }
            }
        } else {
            Tile {
                TileHead("Licence checklist")
                Text("Choose a licence in your profile to see what it needs.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                NavigationLink(value: Route.profile) { Text("Open profile") }.buttonStyle(.pill(.line, height: 40))
            }
        }
    }

    private func toggle(_ id: String) async {
        var all = model.json("reqs")
        let k = LicenceChecklist.key(model)
        var mine = (all[k] as? [String: Any]) ?? [:]
        if mine[id] != nil { mine.removeValue(forKey: id) } else { mine[id] = Day.todayISO }
        all[k] = mine
        do { try await model.saveJSON("reqs", all) } catch { self.error = error.localizedDescription }
    }

    // MARK: Wins

    @ViewBuilder
    private var wins: some View {
        let list = model.sortedFlights.compactMap { f -> (String, String)? in
            guard let w = f.win?.trimmingCharacters(in: .whitespaces), !w.isEmpty else { return nil }
            return (w, f.date)
        }
        if !list.isEmpty {
            Tile(spacing: 10) {
                TileHead(title: "Wins jar") { Chip(text: "\(list.count) saved") }
                ForEach(Array(list.prefix(4).enumerated()), id: \.offset) { _, w in
                    HStack(alignment: .firstTextBaseline) {
                        Text("“\(w.0)”").font(.archivo(15)).foregroundStyle(Theme.ink2)
                        Spacer(minLength: 8)
                        Text(Day.dayMonth(w.1)).font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
    }

    // MARK: Syllabus

    @ViewBuilder
    private var syllabus: some View {
        if let s = Rules.syllabus(model.regime) {
            let all = model.json("syllabus")
            let st = (all[s.id] as? [String: String]) ?? [:]
            let done = s.items.filter { st[$0.id] == "d" }.count
            Tile(spacing: 12) {
                TileHead(title: s.title) { Chip(text: "\(done) of \(s.items.count) done") }
                Bar(value: Double(done) / Double(max(1, s.items.count)), height: 8)
                Footnote(text: "\(s.source). Tap an item to move it between not started, in progress and done.")
                ForEach(Array(s.stages.enumerated()), id: \.offset) { si, stage in
                    let items = s.items.filter { $0.stage == si }
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(stage).font(.archivo(14.5, .semibold))
                            Spacer()
                            Text("\(items.filter { st[$0.id] == "d" }.count)/\(items.count)").font(.archivo(13)).foregroundStyle(Theme.ink3)
                        }
                        .padding(.top, 6)
                        ForEach(items) { item in
                            let state = st[item.id] ?? ""
                            Button { Task { await cycle(item.id, syllabusId: s.id) } } label: {
                                HStack(spacing: 10) {
                                    Circle()
                                        .fill(state == "d" ? Theme.ok : state == "p" ? Theme.electric : Color.clear)
                                        .overlay(Circle().strokeBorder(state.isEmpty ? Theme.mist : .clear, lineWidth: 1.5))
                                        .frame(width: 12, height: 12)
                                    Text(item.id).font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ink3).frame(width: 52, alignment: .leading)
                                    Text(item.name).font(.archivo(14.5)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                                    Spacer(minLength: 6)
                                    Text(state == "d" ? "Done" : state == "p" ? "In progress" : "Not started")
                                        .font(.archivo(12, .medium))
                                        .foregroundStyle(state == "d" ? Theme.ok : state == "p" ? Theme.electric : Theme.ink3)
                                }
                                .padding(.vertical, 8)
                                .padding(.horizontal, 10)
                                .background(state == "d" ? Theme.ok.opacity(0.06) : state == "p" ? Theme.electric.opacity(0.06) : Theme.well, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            }
                            .buttonStyle(.plain)
                            .sensoryFeedback(.selection, trigger: state)
                        }
                    }
                }
            }
        }
    }

    private func cycle(_ id: String, syllabusId: String) async {
        var all = model.json("syllabus")
        var st = (all[syllabusId] as? [String: String]) ?? [:]
        let next = ["": "p", "p": "d", "d": ""][st[id] ?? ""] ?? ""
        if next.isEmpty { st.removeValue(forKey: id) } else { st[id] = next }
        all[syllabusId] = st
        do { try await model.saveJSON("syllabus", all) } catch { self.error = error.localizedDescription }
    }

    // MARK: Milestones

    private var milestones: some View {
        let ms = Milestone.all(model)
        return DarkTile(spacing: 12) {
            Text("Milestones").font(.archivo(17, .semibold))
            if ms.isEmpty {
                Text("Your first milestone is close.").font(Theme.display(24))
                Text("Log your first flight and Boplo starts marking the moments: first solo, every 10 hours, your first cross-country.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.mist)
            }
            ForEach(ms) { m in
                HStack(spacing: 12) {
                    Image(systemName: "sparkle").font(.system(size: 12, weight: .bold)).foregroundStyle(Theme.ice)
                        .frame(width: 30, height: 30).background(Theme.ice.opacity(0.1), in: Circle())
                    VStack(alignment: .leading, spacing: 2) {
                        Text(m.title).font(.archivo(15, .semibold))
                        Text([m.date.map { Day.full($0) }, m.detail].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                            .font(.archivo(12.5)).foregroundStyle(Theme.mist)
                    }
                    Spacer()
                    Button("Share") { shareItem = m }.buttonStyle(.pill(.light, height: 32))
                }
            }
        }
    }
}

struct Milestone: Identifiable {
    let id = UUID()
    let title: String
    let date: String?
    let big: String
    let unit: String
    var detail: String = ""

    @MainActor
    static func all(_ model: AppModel) -> [Milestone] {
        let fl = model.flights.sorted { $0.date < $1.date }
        guard let first = fl.first else { return [] }
        var out: [Milestone] = [Milestone(title: "First flight logged", date: first.date, big: hoursText(first.mins), unit: "in the air")]
        if let solo = fl.first(where: { $0.role == "solo" }) {
            out.append(Milestone(title: "First solo", date: solo.date, big: "SOLO", unit: solo.dep.isEmpty ? "First solo" : solo.dep))
        }
        if let xc = fl.first(where: { f in
            (f.track.count > 1 && f.track.contains { Geo.nm(f.track[0], $0) > 20 }) || (!f.dep.isEmpty && !f.arr.isEmpty && f.dep != f.arr)
        }) {
            out.append(Milestone(title: "First cross-country", date: xc.date, big: "\(xc.dep)→\(xc.arr)", unit: "cross-country"))
        }
        var cum = (model.profile?.openingMinutes ?? 0) / 60
        for f in fl {
            let before = cum; cum += Double(f.mins) / 60
            for m in [5, 10, 20, 30, 40, 50, 75, 100, 150, 200] where before < Double(m) && cum >= Double(m) {
                out.append(Milestone(title: "\(m) hours", date: f.date, big: "\(m)", unit: "hours flown", detail: model.profile?.licence.map { "toward \($0)" } ?? ""))
            }
        }
        var ld = 0
        for f in fl {
            let b = ld; ld += Int(f.landings ?? 0)
            for m in [50, 100, 250] where b < m && ld >= m { out.append(Milestone(title: "\(m) landings", date: f.date, big: "\(m)", unit: "landings")) }
        }
        return out.sorted { ($0.date ?? "9") > ($1.date ?? "9") }
    }
}

/// A shareable 9:16 card for a milestone, rendered natively.
struct MilestoneCard: View {
    let milestone: Milestone
    let name: String
    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(hex: 0x0B1E4E), Color(hex: 0x040B22), Theme.night], center: UnitPoint(x: 0.75, y: 0), startRadius: 10, endRadius: 900)
            Contours(seed: 2.2).opacity(0.5)
            VStack(alignment: .leading, spacing: 18) {
                BoploWordmark(height: 44)
                Spacer()
                Text(milestone.big).font(Theme.display(150, bold: true)).foregroundStyle(.white).minimumScaleFactor(0.3).lineLimit(1)
                Text(milestone.unit).font(.archivo(40, .medium)).foregroundStyle(Theme.ice)
                Text(milestone.title).font(Theme.display(64)).foregroundStyle(.white)
                Text([name, milestone.date.map { Day.full($0) }].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.archivo(30)).foregroundStyle(Theme.mist)
                Spacer().frame(height: 60)
            }
            .padding(80)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(width: 1080, height: 1920)
    }
}

struct MilestoneShareSheet: View {
    let milestone: Milestone
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var image: UIImage?

    var body: some View {
        NavigationStack {
            VStack(spacing: 18) {
                if let image {
                    Image(uiImage: image).resizable().scaledToFit().clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .shadow(radius: 20, y: 10)
                    ShareLink(item: Image(uiImage: image), preview: SharePreview(milestone.title, image: Image(uiImage: image))) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.pill(.blue, height: 50, full: true))
                } else {
                    ProgressView()
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Theme.cloud.ignoresSafeArea())
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .navigationTitle(milestone.title)
            .navigationBarTitleDisplayMode(.inline)
        }
        .task {
            let r = ImageRenderer(content: MilestoneCard(milestone: milestone, name: model.profile?.firstName ?? ""))
            r.scale = 1
            image = r.uiImage
        }
    }
}
