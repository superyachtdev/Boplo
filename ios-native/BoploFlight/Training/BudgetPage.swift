import SwiftUI
import Charts

/// Budget: what the licence is likely to cost at the pilot's pace, against their budget. Same model as the web forecast().
struct BudgetPage: View {
    @Environment(AppModel.self) private var model
    @State private var basis = "typical"
    @State private var total = ""
    @State private var rateAircraft = ""
    @State private var rateInstructor = ""
    @State private var extras: [Extra] = []
    @State private var loaded = false
    @State private var saveTask: Task<Void, Never>?

    struct Extra: Identifiable, Equatable {
        var id = UUID()
        var name: String
        var amount: String
        var paid: Bool
    }

    private static let currencyByCountry = ["GB": "GBP", "US": "USD", "CA": "CAD", "AU": "AUD", "NZ": "NZD", "CH": "CHF", "NO": "NOK", "SE": "SEK", "DK": "DKK", "PL": "PLN", "CZ": "CZK", "HU": "HUF", "IS": "ISK", "ZA": "ZAR", "IN": "INR", "JP": "JPY", "BR": "BRL", "MX": "MXN"]
    private static let euro = Set("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(separator: " ").map(String.init))

    private var currency: String {
        if let c = model.rawProfile["currency"] as? String, !c.isEmpty { return c }
        let cc = model.countryCode
        return Self.currencyByCountry[cc] ?? (Self.euro.contains(cc) ? "EUR" : "USD")
    }
    private func money(_ v: Double) -> String { v.formatted(.currency(code: currency).precision(.fractionLength(0))) }
    private func num(_ s: String) -> Double { Double(s.filter { "0123456789.".contains($0) }) ?? 0 }

    // MARK: Forecast

    struct Forecast {
        var min: Int?
        var typical: Int?
        var target: Double?
        var perWeekFlights: Double
        var perWeekHours: Double
        var perHour: Double
        var spent: Double
        var extrasPaid: Double
        var extrasDue: Double
        var remainingH: Double?
        var remainingFly: Double?
        var projected: Double?
        var finish: Date?
        var monthly: Double
        var budget: Double
        var runOut: Date?
        var short: Double?
        var fast: (hours: Int, save: Double, saveH: Int)?
        var hasRates: Bool { perHour > 0 }
        var spentAll: Double { spent + extrasPaid }
    }

    private func cost(_ f: Flight) -> Double? {
        if let c = f.cost { return c }
        let r = num(rateAircraft) + ((f.role ?? "dual") == "dual" ? num(rateInstructor) : 0)
        return r > 0 ? Double(f.mins) / 60 * r : nil
    }

    private var forecast: Forecast {
        let p = model.profile
        let minH = Rules.licence(model.regime, p?.licence)?.minHours
        let recent = model.flights(inLast: 56)
        let perWeekRecentH = Double(recent.reduce(0) { $0 + $1.mins }) / 60 / 8
        let costed: [(Flight, Double)] = model.flights.compactMap { f -> (Flight, Double)? in
            guard let c = cost(f) else { return nil }
            return (f, c)
        }
        let spent: Double = costed.reduce(0.0) { $0 + $1.1 }
        let costedHours: Double = Double(costed.reduce(0) { $0 + $1.0.mins }) / 60
        let perHour = !costed.isEmpty && costedHours > 0 ? spent / costedHours : (num(rateAircraft) + num(rateInstructor) * 0.6)
        let flPerWeek = Double(recent.count) / 8
        let avgLen = model.flights.isEmpty ? 1.1 : Double(model.flights.reduce(0) { $0 + $1.mins }) / Double(model.flights.count) / 60
        let plannedMap: [String: Double] = ["Twice a week": 2, "Weekly": 1, "Monthly": 0.25, "Intensive course": 4]
        let planned: Double = plannedMap[p?.frequency ?? ""] ?? 0
        let perWeekFl: Double = flPerWeek > 0 ? flPerWeek : (planned > 0 ? planned : 1)
        let perWeekH = perWeekRecentH > 0 ? perWeekRecentH : perWeekFl * avgLen
        let factor = perWeekFl >= 1.8 ? 1.4 : perWeekFl >= 0.9 ? 1.65 : 1.9
        let typical = minH.map { Int((Double($0) * factor).rounded()) }
        let goal: Double = p?.goalHours ?? 0
        let target: Double?
        if basis == "min", let m = minH { target = Double(m) }
        else if basis == "goal", goal > 0 { target = goal }
        else if let t = typical { target = Double(t) }
        else if goal > 0 { target = goal }
        else { target = nil }
        let extrasPaid: Double = extras.filter(\.paid).reduce(0.0) { $0 + num($1.amount) }
        let extrasDue: Double = extras.filter { !$0.paid }.reduce(0.0) { $0 + num($1.amount) }
        let totalH = Double(model.totalMinutes) / 60
        let remainingH = target.map { max(0, $0 - totalH) }
        let remainingFly = remainingH.map { $0 * perHour }
        let projected = remainingFly.map { spent + extrasPaid + $0 + extrasDue }
        let weeks: Double? = perWeekH > 0 ? remainingH.map { $0 / perWeekH } : nil
        let finish = weeks.map { Date().addingTimeInterval($0 * 7 * 86400) }
        let monthly = perWeekH * perHour * 4.345
        let budget = num(total)
        let left: Double? = budget > 0 ? budget - spent - extrasPaid : nil
        var runOut: Date? = nil
        if let l = left, monthly > 0 { runOut = l <= 0 ? Date() : Date().addingTimeInterval(l / monthly * 30.44 * 86400) }
        let short: Double? = budget > 0 ? projected.map { $0 - budget } : nil
        var fast: (hours: Int, save: Double, saveH: Int)? = nil
        if let m = minH, let t = typical, perWeekFl < 1.8 {
            let h = Int((Double(m) * 1.4).rounded())
            fast = (hours: h, save: Double(t - h) * perHour, saveH: t - h)
        }
        return Forecast(min: minH, typical: typical, target: target, perWeekFlights: perWeekFl, perWeekHours: perWeekH, perHour: perHour, spent: spent,
                        extrasPaid: extrasPaid, extrasDue: extrasDue, remainingH: remainingH, remainingFly: remainingFly, projected: projected, finish: finish,
                        monthly: monthly, budget: budget, runOut: runOut, short: short, fast: fast)
    }

    private func monthYear(_ d: Date?) -> String { d.map { $0.formatted(.dateTime.month(.abbreviated).year()) } ?? "—" }

    private func line(_ fc: Forecast) -> String {
        guard let target = fc.target else { return "Choose your licence in Profile to see a forecast." }
        if !fc.hasRates { return "Most students finish around \(fc.typical ?? Int(target)) h. Add your aircraft and instructor rates to see the cost." }
        if fc.budget > 0, let s = fc.short, s > 0 { return "At this pace your budget runs out around \(monthYear(fc.runOut)), about \(money(s)) short of finishing." }
        if fc.budget > 0, let s = fc.short { return "Your budget covers it, with about \(money(-s)) to spare." }
        return "About \(money(fc.projected ?? 0)) in total, finishing around \(monthYear(fc.finish))."
    }

    // MARK: View

    var body: some View {
        let fc = forecast
        return Page(title: "Budget", subtitle: "What your licence is likely to cost, based on how students really finish, and whether your budget gets you there.") {
            DarkTile(spacing: 12) {
                Text("Projected total").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
                Text(fc.projected != nil && fc.hasRates ? money(fc.projected!) : "—").font(Theme.display(46)).tracking(-1.5)
                Text(line(fc)).font(.archivo(14.5)).foregroundStyle(Theme.mist)
                HStack(spacing: 4) {
                    basisButton("typical", "Typical at your pace")
                    if let m = fc.min { basisButton("min", "Minimum \(m) h") }
                    if (model.profile?.goalHours ?? 0) > 0 { basisButton("goal", "My goal \(Int(model.profile?.goalHours ?? 0)) h") }
                }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], alignment: .leading, spacing: 12) {
                    fact("Hours", fc.target.map { "\(Int($0)) h" } ?? "—")
                    fact("Finish", monthYear(fc.finish))
                    fact("Monthly spend", fc.hasRates ? money(fc.monthly) : "—")
                    fact("Budget lasts to", fc.budget > 0 && fc.hasRates ? monthYear(fc.runOut) : "—")
                }
                .padding(.top, 4)
            }
            if let s = fc.short, s > 0 {
                Text("**Heads up:** at your current pace, the money runs out before the licence does. Flying more often is the biggest lever: fewer hours are lost to re-learning between lessons.")
                    .font(.archivo(14)).padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color(hex: 0xF5A623).opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            runway(fc)
            Tile(spacing: 12) {
                TileHead(title: "Breakdown") { Chip(text: currency) }
                row("Flying so far · \(plural(model.flights.count, "flight"))", money(fc.spent))
                row("Other costs paid", money(fc.extrasPaid))
                row("Flying still to do · \(fc.remainingH.map { String(format: "%.1f", $0) } ?? "—") h × \(money(fc.perHour))", fc.remainingFly.map(money) ?? "—")
                row("Other costs to come", money(fc.extrasDue))
                Divider().overlay(Theme.hair)
                row("Total", fc.projected.map(money) ?? "—", bold: true)
                HStack(spacing: 8) {
                    Labeled(label: "Total budget") { TextField("e.g. 12000", text: $total).keyboardType(.decimalPad).boploField() }
                }
                HStack(spacing: 8) {
                    Labeled(label: "Aircraft per hour") { TextField("0", text: $rateAircraft).keyboardType(.decimalPad).boploField() }
                    Labeled(label: "Instructor per hour") { TextField("0", text: $rateInstructor).keyboardType(.decimalPad).boploField() }
                }
                Footnote(text: "Spending comes from each flight’s cost, or your rates when a flight has no cost entered.")
            }
            monthsTile(fc)
            extrasTile
            Footnote(text: "How this works: published minimums are the floor, not the norm. Typical private pilots finish at about 1.8× the minimum, and those who fly twice a week finish nearer 1.4×. Boplo uses your recent pace (or the frequency in your profile) to pick a figure. It’s an estimate from your own records, not a quote.")
        }
        .onAppear(perform: load)
        .onChange(of: total) { _, _ in scheduleSave() }
        .onChange(of: rateAircraft) { _, _ in scheduleSave() }
        .onChange(of: rateInstructor) { _, _ in scheduleSave() }
        .onChange(of: extras) { _, _ in scheduleSave() }
    }

    private func basisButton(_ id: String, _ label: String) -> some View {
        Button { withAnimation(.snappy) { basis = id } } label: {
            Text(label).font(.archivo(12.5, .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                .padding(.horizontal, 10).frame(height: 30)
                .foregroundStyle(basis == id ? Theme.ink : .white)
                .background(basis == id ? Color.white : Color.white.opacity(0.08), in: Capsule())
        }
        .buttonStyle(.plain)
    }

    private func fact(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.archivo(12.5)).foregroundStyle(Theme.mist)
            Text(v).font(.archivo(17, .semibold))
        }
    }

    private func row(_ k: String, _ v: String, bold: Bool = false) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(k).font(.archivo(14.5, bold ? .semibold : .regular)).foregroundStyle(bold ? Theme.ink : Theme.ink2)
            Spacer(minLength: 8)
            Text(v).font(.archivo(14.5, .semibold)).monospacedDigit()
        }
    }

    @ViewBuilder
    private func runway(_ fc: Forecast) -> some View {
        if fc.budget > 0, fc.hasRates {
            let recent = Array(model.sortedFlights.prefix(6))
            let avgMin: Double = recent.isEmpty ? 60 : Double(recent.reduce(0) { $0 + $1.mins }) / Double(recent.count)
            let perLesson = fc.perHour * avgMin / 60
            let left = fc.budget - fc.spent - fc.extrasPaid - fc.extrasDue
            let lessons = perLesson > 0 ? max(0, Int(floor(left / perLesson))) : 0
            let hoursAt = Double(model.totalMinutes) / 60 + Double(lessons) * avgMin / 60
            Tile(spacing: 10) {
                TileHead(title: "Funding runway") { Chip(text: "\(plural(lessons, "lesson")) left", tone: lessons <= 3 ? .warn : .plain) }
                Text("**\(lessons)** more \(lessons == 1 ? "lesson" : "lessons") of about \(Int(avgMin.rounded())) min at \(money(perLesson)) each, taking you to about **\(Int(hoursAt.rounded())) h**.")
                    .font(.archivo(15))
                if let f = fc.fast {
                    Text("Booking lessons closer together is the cheapest way through: students flying twice a week usually need about \(f.saveH) fewer hours\(f.save > 0 ? ", around \(money(f.save)) saved" : ""). Block-book the next few if your school offers it.")
                        .font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                } else {
                    Text("You’re flying often enough to keep re-learning to a minimum. Keep it up.").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                }
            }
        }
    }

    private struct MonthSpend: Identifiable { let id: String; let label: String; let value: Double }

    private func monthsTile(_ fc: Forecast) -> some View {
        var byMonth: [String: Double] = [:]
        for f in model.flights { if let c = cost(f) { byMonth[String(f.date.prefix(7)), default: 0] += c } }
        let cal = Calendar.current
        let months: [MonthSpend] = (0..<6).compactMap { i in
            guard let d = cal.date(byAdding: .month, value: i - 5, to: Date()) else { return nil }
            let c = cal.dateComponents([.year, .month], from: d)
            let k = String(format: "%04d-%02d", c.year ?? 0, c.month ?? 0)
            return MonthSpend(id: k, label: d.formatted(.dateTime.month(.abbreviated)), value: byMonth[k] ?? 0)
        }
        return Tile(spacing: 12) {
            TileHead("Spent by month")
            Chart(months) { m in
                BarMark(x: .value("Month", m.label), y: .value("Spent", m.value)).foregroundStyle(Theme.electric).cornerRadius(4)
            }
            .chartYAxis(.hidden)
            .frame(height: 140)
            if let f = fc.fast {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Fly twice a week").font(.archivo(15, .semibold))
                    Text("Students who fly twice a week tend to finish nearer \(f.hours) h. For you that’s about \(f.saveH) fewer hours\(fc.hasRates ? ", or \(money(f.save)) saved" : "").")
                        .font(.archivo(13.5)).foregroundStyle(Theme.ink2)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.electric.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else if let m = fc.min {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Good pace").font(.archivo(15, .semibold))
                    Text("You’re flying often enough to finish close to the best case, around \(Int((Double(m) * 1.4).rounded())) h.").font(.archivo(13.5)).foregroundStyle(Theme.ink2)
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.ok.opacity(0.07), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private var suggestions: [String] {
        model.regime == "faa" ? ["Medical exam", "Knowledge test", "Checkride examiner fee", "Headset", "Books and ground school", "Landing and airport fees"]
            : ["Medical exam", "Theory exams", "Skill test and examiner fee", "Radio (FRTOL) exam", "Headset", "Books and ground school", "Licence issue fee", "Landing fees"]
    }

    private var extrasTile: some View {
        Tile(spacing: 10) {
            TileHead(title: "Other costs") {
                Button("Add a cost") { extras.append(Extra(name: "", amount: "", paid: false)) }.buttonStyle(.pill(.line, height: 34))
            }
            if extras.isEmpty {
                Text("Exams, the medical, examiner fees and a headset add up. Add them so the total is honest.").font(.archivo(14)).foregroundStyle(Theme.ink3)
            }
            ForEach($extras) { $x in
                HStack(spacing: 8) {
                    TextField("What it’s for", text: $x.name).boploField()
                    TextField("Amount", text: $x.amount).keyboardType(.decimalPad).frame(width: 96).boploField()
                    Button { x.paid.toggle() } label: {
                        VStack(spacing: 2) {
                            Image(systemName: x.paid ? "checkmark.circle.fill" : "circle").foregroundStyle(x.paid ? Theme.ok : Theme.mist)
                            Text("Paid").font(.archivo(10.5)).foregroundStyle(Theme.ink3)
                        }
                    }
                    .buttonStyle(.plain)
                    Button { extras.removeAll { $0.id == x.id } } label: { Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3) }
                        .buttonStyle(.plain)
                }
            }
            let left = suggestions.filter { s in !extras.contains { $0.name == s } }
            if !left.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(left, id: \.self) { s in
                            Button { extras.append(Extra(name: s, amount: "", paid: false)) } label: { Chip(text: "+ \(s)") }.buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    // MARK: Data

    private func load() {
        guard !loaded else { return }
        let b = model.json("budget")
        let t: Double = (b["total"] as? NSNumber)?.doubleValue ?? 0
        total = t > 0 ? t.clean : ""
        let ra = model.number("rateAircraft"), ri = model.number("rateInstructor")
        rateAircraft = ra > 0 ? ra.clean : ""
        rateInstructor = ri > 0 ? ri.clean : ""
        extras = ((b["extras"] as? [[String: Any]]) ?? []).map { x in
            let a: Double = (x["amt"] as? NSNumber)?.doubleValue ?? 0
            return Extra(name: (x["n"] as? String) ?? "", amount: a > 0 ? a.clean : "", paid: (x["paid"] as? Bool) ?? false)
        }
        DispatchQueue.main.async { loaded = true }
    }

    private func scheduleSave() {
        guard loaded else { return }
        saveTask?.cancel()
        saveTask = Task {
            try? await Task.sleep(nanoseconds: 900_000_000)
            guard !Task.isCancelled else { return }
            let budget: [String: Any] = ["total": num(total), "extras": extras.prefix(30).map { ["n": String($0.name.prefix(60)), "amt": num($0.amount), "paid": $0.paid] as [String: Any] }]
            try? await model.saveJSON("budget", budget, extra: ["rateAircraft": num(rateAircraft), "rateInstructor": num(rateInstructor)])
        }
    }
}
