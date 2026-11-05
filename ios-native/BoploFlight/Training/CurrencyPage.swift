import SwiftUI

/// Currency and expiry: document dates the pilot enters, and recency rules counted from the logbook.
struct CurrencyPage: View {
    @Environment(AppModel.self) private var model
    @State private var newLabel = ""
    @State private var newDate = Date()
    @State private var error: String?

    struct Item: Identifiable {
        enum Kind { case date, calc, custom(Int) }
        let id: String
        let title: String
        let kind: Kind
        var label = "Date"
        var value: String = ""
        var until: String = ""
        var detail = ""
        var note = ""
        var url = ""
    }

    private var faa: Bool { model.regime == "faa" }
    private var docs: [String: Any] { model.json("docs") }

    private func landingCurrency(night: Bool) -> (date: String, until: String)? {
        var n = 0
        for f in model.sortedFlights {
            n += Int((night ? f.nightLandings : f.landings) ?? 0)
            if n >= 3 { return (f.date, Day.adding(90, to: f.date)) }
        }
        return nil
    }

    private func endOfCalendarMonth(_ iso: String, plus months: Int) -> String {
        guard let d = Day.date(iso) else { return "" }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let c = cal.dateComponents([.year, .month], from: d)
        guard let start = cal.date(from: DateComponents(year: c.year, month: (c.month ?? 1) + months + 1, day: 1)) else { return "" }
        return Day.isoString(start.addingTimeInterval(-86400))
    }

    private var items: [Item] {
        let d = docs
        func s(_ k: String) -> String { d[k] as? String ?? "" }
        var out: [Item] = [Item(id: "medical", title: "Medical certificate", kind: .date, label: "Expiry date on your medical", value: s("medical"), until: s("medical"), note: "From your medical certificate. Validity depends on your age and class.")]
        if faa {
            out.append(Item(id: "review", title: "Flight review", kind: .date, label: "Date of your last flight review (or checkride)", value: s("review"), until: s("review").isEmpty ? "" : endOfCalendarMonth(s("review"), plus: 24), note: "Required every 24 calendar months under 14 CFR § 61.56.", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.56"))
            out.append(Item(id: "solo", title: "Student solo endorsement", kind: .date, label: "Date of your latest solo endorsement", value: s("solo"), until: s("solo").isEmpty ? "" : Day.adding(90, to: s("solo")), note: "An instructor must update it every 90 days (14 CFR § 61.87).", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-C/section-61.87"))
        } else {
            out.append(Item(id: "rating", title: "SEP class rating", kind: .date, label: "Rating expiry date on your licence", value: s("rating"), until: s("rating"), note: "Shown on your licence once it’s issued."))
        }
        let day = landingCurrency(night: false)
        out.append(Item(id: "pax", title: "Carrying passengers", kind: .calc, until: day?.until ?? "",
                        detail: day.map { "3 landings in the last 90 days. Current until \(Day.dayMonth($0.until)) unless you fly again." } ?? "Needs 3 take-offs and landings in the last 90 days.",
                        note: faa ? "Day rule in 14 CFR § 61.57(a). Tailwheel landings must be to a full stop. Counted from all your logged landings." : "FCL.060(b): 3 take-offs, approaches and landings in the same class or type in the last 90 days.",
                        url: faa ? "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57" : ""))
        if faa {
            let n = landingCurrency(night: true)
            out.append(Item(id: "night", title: "Carrying passengers at night", kind: .calc, until: n?.until ?? "",
                            detail: n.map { "3 night full-stop landings in the last 90 days. Current until \(Day.dayMonth($0.until))." } ?? "Needs 3 full-stop landings at night (1 hour after sunset to 1 hour before sunrise) in the last 90 days.",
                            note: "14 CFR § 61.57(b). Log night landings on each flight to track this.", url: "https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-A/section-61.57"))
        }
        for (i, c) in ((d["custom"] as? [[String: Any]]) ?? []).enumerated() {
            out.append(Item(id: "c\(i)", title: c["label"] as? String ?? "Date", kind: .custom(i), value: c["date"] as? String ?? "", until: c["date"] as? String ?? ""))
        }
        return out
    }

    private func due(_ until: String) -> (Chip.Tone, String, Color) {
        guard let d = Day.daysUntil(until) else { return (.plain, "Not set", Theme.mist) }
        if d < 0 { return (.bad, "Expired \(plural(-d, "day")) ago", Theme.danger) }
        if d <= 60 { return (.warn, d == 0 ? "Due today" : "Due in \(plural(d, "day"))", Color(hex: 0xE0A21B)) }
        return (.ok, "Valid until \(Day.full(until))", Theme.ok)
    }

    var body: some View {
        Page(title: "Currency", subtitle: "The dates and recent-experience rules that decide what you can fly, worked out from your logbook.") {
            if !model.isAdvanced {
                LockedTile(title: "Always know what you can fly.", text: "Track your medical and rating expiry, passenger and night currency, and revalidation by experience, with reminders before anything lapses.", message: "Currency is part of Advanced.")
            } else {
                ForEach(items) { it in itemTile(it) }
                addTile
                revalidation
                Tile(spacing: 8) {
                    TileHead("How this works")
                    Text("Expiry dates come from your own documents, so they’re exact. Recent-experience rules are counted from the flights in your logbook. Your licence, your instructor and your authority have the final say.")
                        .font(.archivo(14)).foregroundStyle(Theme.ink3)
                }
                ErrorText(text: error)
            }
        }
        .navigationTitle("Currency")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func itemTile(_ it: Item) -> some View {
        let isCalc: Bool = { if case .calc = it.kind { return true }; return false }()
        let st: (Chip.Tone, String, Color) = isCalc && it.until.isEmpty ? (.bad, "Not current", Theme.danger) : due(it.until)
        return Tile(spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(it.title).font(.archivo(17, .semibold))
                Spacer(minLength: 8)
                Chip(text: st.1, tone: st.0)
            }
            if isCalc {
                Text(it.detail).font(.archivo(14.5)).foregroundStyle(Theme.ink2)
            } else {
                DateField(label: it.label, value: it.value) { newValue in Task { await setDate(it, newValue) } }
            }
            if !it.note.isEmpty {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Footnote(text: it.note)
                    if let u = URL(string: it.url), !it.url.isEmpty { Link("Source", destination: u).font(.archivo(12.5, .semibold)) }
                }
            }
            if case .custom(let i) = it.kind {
                Button("Remove", role: .destructive) { Task { await removeCustom(i) } }.font(.archivo(13.5, .semibold))
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous).fill(st.2)
                .mask(alignment: .leading) { Rectangle().frame(width: 4) }
                .allowsHitTesting(false)
        }
    }

    private var addTile: some View {
        Tile(spacing: 10) {
            TileHead("Add another date")
            TextField("e.g. Radio licence, theory exam deadline", text: $newLabel).boploField()
            DatePicker("Date", selection: $newDate, displayedComponents: .date).font(.archivo(15))
            Button("Add") { Task { await addCustom() } }
                .buttonStyle(.pill(.ink, height: 42))
                .disabled(newLabel.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    @ViewBuilder
    private var revalidation: some View {
        if !faa, let rating = docs["rating"] as? String, !rating.isEmpty, let end = Day.date(rating) {
            let start = Day.isoString(Calendar(identifier: .gregorian).date(byAdding: .year, value: -1, to: end) ?? end)
            let w = model.flights.filter { $0.date >= start && $0.date <= rating }
            let rows: [(String, Double, Double, String)] = [
                ("Flight time", Double(w.reduce(0) { $0 + $1.mins }) / 60, 12, "h"),
                ("As pilot in command", Double(w.filter { ($0.role ?? "dual") != "dual" }.reduce(0) { $0 + $1.mins }) / 60, 6, "h"),
                ("Take-offs and landings", Double(w.reduce(0) { $0 + Int($1.landings ?? 0) }), 12, ""),
                ("With an instructor", Double(w.filter { ($0.role ?? "dual") == "dual" }.reduce(0) { $0 + $1.mins }) / 60, 1, "h")
            ]
            Tile(spacing: 12) {
                TileHead("Revalidation by experience")
                Text("Between \(Day.full(start)) and your rating expiry.").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                ForEach(rows, id: \.0) { k, v, need, u in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(k).font(.archivo(14.5))
                            Spacer()
                            Text("\(u.isEmpty ? String(Int(v)) : String(format: "%.1f", v)) / \(Int(need))\(u.isEmpty ? "" : " " + u)").font(.archivo(14.5, .semibold))
                        }
                        Bar(value: v / need, height: 6, fill: v >= need ? Theme.ok : Theme.electric)
                    }
                }
                Footnote(text: "FCL.740.A: 12 hours including 6 as PIC, 12 take-offs and landings, and a 1-hour training flight with an instructor. An instructor or examiner signs it off.")
            }
        }
    }

    // MARK: Saving

    private func setDate(_ it: Item, _ value: String) async {
        var d = docs
        if case .custom(let i) = it.kind {
            var list = (d["custom"] as? [[String: Any]]) ?? []
            if list.indices.contains(i) { list[i]["date"] = value }
            d["custom"] = list
        } else {
            d[it.id] = value
        }
        await save(d)
    }

    private func addCustom() async {
        var d = docs
        var list = (d["custom"] as? [[String: Any]]) ?? []
        let c = Calendar.current.dateComponents([.year, .month, .day], from: newDate)
        list.append(["label": String(newLabel.trimmingCharacters(in: .whitespaces).prefix(60)), "date": String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)])
        d["custom"] = Array(list.suffix(10))
        newLabel = ""
        await save(d)
    }

    private func removeCustom(_ i: Int) async {
        var d = docs
        var list = (d["custom"] as? [[String: Any]]) ?? []
        if list.indices.contains(i) { list.remove(at: i) }
        d["custom"] = list
        await save(d)
    }

    private func save(_ d: [String: Any]) async {
        do { try await model.saveJSON("docs", d) } catch { self.error = error.localizedDescription }
    }
}

/// A calendar-day field that can be empty: shows "Set a date" until one is chosen.
struct DateField: View {
    let label: String
    let value: String
    var onChange: (String) -> Void
    @State private var date = Date()
    @State private var editing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.archivo(13, .medium)).foregroundStyle(Theme.ink2)
            HStack {
                if value.isEmpty && !editing {
                    Button("Set a date") { editing = true; date = Date() }.buttonStyle(.pill(.line, height: 40))
                } else {
                    DatePicker(label, selection: $date, displayedComponents: .date)
                        .labelsHidden()
                        .onChange(of: date) { _, d in
                            let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
                            let iso = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
                            if iso != value { onChange(iso) }
                        }
                    Spacer()
                    if !value.isEmpty {
                        Button("Clear") { onChange(""); editing = false }.font(.archivo(13.5, .semibold)).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .onAppear(perform: sync)
        .onChange(of: value) { _, _ in sync() }
    }

    private func sync() {
        if let d = Day.date(value) {
            var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(identifier: "UTC")!
            date = Calendar.current.date(from: utc.dateComponents([.year, .month, .day], from: d)) ?? Date()
        }
    }
}

/// The Advanced lock shown on gated tools.
struct LockedTile: View {
    let title: String
    let text: String
    var message: String? = nil
    @Environment(AppModel.self) private var model
    var body: some View {
        DarkTile {
            Text("Advanced").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
            Text(title).font(Theme.display(30)).tracking(-0.8).fixedSize(horizontal: false, vertical: true)
            Text(text).font(.archivo(15)).foregroundStyle(Theme.mist)
            Button { model.upgrade(message) } label: { Text("Upgrade to Advanced") }
                .buttonStyle(.pill(.light, height: 48, spark: true))
        }
    }
}
