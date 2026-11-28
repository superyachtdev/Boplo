import SwiftUI

/// Today's sortie: a 3-minute daily mini-lesson that trains all three stats.
///  1. Brief       today's real weather at your home airport: go or no-go?   (Airmanship)
///  2. Preflight   one walkaround finding: what do you do?                    (Airmanship)
///  3. Fly         optional: a short final at your airport in today's wind    (Handling, via the sim score)
///  4. Debrief     three questions from your weakest subject                  (Knowledge)
struct SortieView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var stats = PilotStatsStore.shared

    enum Step: Int { case brief, preflight, fly, debrief, done }
    @State private var step: Step = .brief
    @State private var wx: SortieWeather?
    @State private var wxLoading = true
    @State private var briefCall: Bool?          // true = go
    @State private var preflightPick: Int?
    @State private var questions: [QuestionBank.Question] = []
    @State private var qIndex = 0
    @State private var qPick: Int?
    @State private var qAnswers: [(id: String, ok: Bool)] = []
    @State private var simURL: URL?
    @State private var flew = false
    @State private var flight: SortieFlight?
    @State private var saving = false
    @State private var before: PilotStats?

    private var finding: PreflightFinding { PreflightFinding.forToday }
    private var briefOK: Bool? { guard let briefCall, let wx else { return nil }; return briefCall == wx.verdict.go }
    private var preflightOK: Bool? { preflightPick.map { $0 == finding.answer } }
    /// Fly in the real sky only when it's comfortably VFR: under a low ceiling the approach would start inside cloud.
    private var flyLiveSky: Bool {
        guard let wx, wx.live else { return false }
        return (wx.ceiling ?? 99999) >= 1500 && wx.visSM >= 3
    }
    private var points: Int { (briefOK == true ? 1 : 0) + (preflightOK == true ? 1 : 0) + qAnswers.filter(\.ok).count }
    private var grade: String { points >= 5 ? "A" : points == 4 ? "B" : points == 3 ? "C" : "D" }

    var body: some View { screenBody.screen("sortie") }
    @ViewBuilder private var screenBody: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    progress
                    switch step {
                    case .brief: briefStep
                    case .preflight: preflightStep
                    case .fly: flyStep
                    case .debrief: debriefStep
                    case .done: doneStep
                    }
                }
                .padding(16)
                .animation(.snappy, value: step)
            }
            .background(Theme.cloud.ignoresSafeArea())
            .navigationTitle("Today’s sortie")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(step == .done ? "Done" : "Close") { dismiss() } } }
        }
        .task {
            before = stats.stats
            questions = Self.debriefQuestions(model)
            wx = await SortieWeather.load(model)
            wxLoading = false
        }
        .fullScreenCover(item: $simURL, onDismiss: { flew = true; step = .debrief }) { url in SimulatorView(url: url, onResult: { flight = $0 }) }
        .interactiveDismissDisabled(step != .brief && step != .done)
    }

    private var progress: some View {
        HStack(spacing: 6) {
            ForEach(["Brief", "Preflight", "Fly", "Debrief"].indices, id: \.self) { i in
                VStack(alignment: .leading, spacing: 5) {
                    Capsule().fill(i <= step.rawValue ? Theme.electric : Theme.ink.opacity(0.1)).frame(height: 4)
                    Text(["Brief", "Preflight", "Fly", "Debrief"][i]).font(.archivo(11.5, .semibold)).foregroundStyle(i == step.rawValue ? Theme.ink : Theme.ink3)
                }
            }
        }
    }

    // MARK: 1. Brief

    @ViewBuilder
    private var briefStep: some View {
        stepHead("Would you fly today?", "Airmanship")
        if wxLoading {
            Tile { HStack { ProgressView(); Text("Getting today’s weather…").font(.archivo(15)) } }
        } else if let wx {
            Tile(spacing: 10) {
                HStack {
                    Text(wx.station).font(.archivo(17, .semibold))
                    if !wx.live { Chip(text: "Practice weather", tone: .warn) }
                    Spacer()
                    if !wx.category.isEmpty { Chip(text: wx.category, tone: wx.category == "VFR" ? .ok : wx.category == "MVFR" ? .blue : .bad) }
                }
                Text(wx.raw).font(.system(size: 14, design: .monospaced)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                if !wx.live { Text("Live weather for your airport wasn’t available, so here’s a real-world style report to judge instead.").font(.archivo(12.5)).foregroundStyle(Theme.ink3) }
                Text("Judged against common student pilot minimums: ceiling 3,000 ft, visibility 5 SM, wind 15 kt, gusts no more than 10 kt above the wind, no thunderstorms or freezing precipitation.")
                    .font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            }
            if let call = briefCall {
                Tile(spacing: 10) {
                    Text(briefOK == true ? "Good call." : "Not this time.").font(.archivo(17, .semibold)).foregroundStyle(briefOK == true ? Theme.ok : Theme.danger)
                    Text("You said \(call ? "go" : "no-go"). Against these minimums it’s \(wx.verdict.go ? "a go" : "a no-go").").font(.archivo(15))
                    ForEach(wx.verdict.checks, id: \.label) { c in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: c.ok ? "checkmark.circle.fill" : "xmark.circle.fill").foregroundStyle(c.ok ? Theme.ok : Theme.danger)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(c.label).font(.archivo(14.5, .semibold))
                                Text(c.detail).font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    Text("Your instructor and your own personal minimums have the final say.").font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                }
                next { step = .preflight }
            } else {
                HStack(spacing: 10) {
                    Button { briefCall = true } label: { Text("Go") }.buttonStyle(.pill(.ink, height: 50))
                    Button { briefCall = false } label: { Text("No-go") }.buttonStyle(.pill(.line, height: 50))
                }
            }
        }
    }

    // MARK: 2. Preflight

    @ViewBuilder
    private var preflightStep: some View {
        stepHead("Walkaround finding", "Airmanship")
        Tile(spacing: 12) {
            Text(finding.finding).font(.archivo(19, .semibold)).fixedSize(horizontal: false, vertical: true)
            ForEach(finding.options.indices, id: \.self) { i in
                option(finding.options[i], picked: preflightPick == i, right: preflightPick != nil && i == finding.answer, wrong: preflightPick == i && i != finding.answer) {
                    if preflightPick == nil { preflightPick = i }
                }
            }
            if preflightPick != nil {
                Text(finding.explain).font(.archivo(14.5)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
        }
        if preflightPick != nil { next { step = .fly } }
    }

    // MARK: 3. Fly

    @ViewBuilder
    private var flyStep: some View {
        stepHead("Fly it", "Handling")
        DarkTile {
            Text("Short final at \(model.homeCode.isEmpty ? "your airport" : model.homeCode)").font(Theme.display(30)).tracking(-0.8)
            Text("A 2 NM final in today’s real wind\(wx?.live == true ? " (\(wx?.windText ?? ""))" : "")\(flyLiveSky ? "" : wx?.live == true ? ", under a clear sky because the real weather is below VFR right now" : ""). Hold the glidepath and the centreline, then land in the touchdown zone. Your landing score feeds Handling.")
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
            Button {
                var c = URLComponents(string: "https://boplo.app/flight-app.html")!
                c.queryItems = [.init(name: "embed", value: "1"), .init(name: "practice", value: model.homeCode), .init(name: "kind", value: "short"), .init(name: "wx", value: flyLiveSky ? "live" : "fair"), .init(name: "wind", value: "live"), .init(name: "sortie", value: "1"), .init(name: "name", value: model.homeCode)]
                c.fragment = "sim"
                simURL = c.url
            } label: { Text("Fly the approach") }
                .buttonStyle(.pill(.light, height: 48, spark: true))
                .disabled(model.homeCode.isEmpty)
        }
        Button("Skip the flying today") { step = .debrief }
            .font(.archivo(14.5, .semibold)).foregroundStyle(Theme.ink3)
    }

    // MARK: 4. Debrief

    @ViewBuilder
    private var debriefStep: some View {
        stepHead("Debrief", "Knowledge")
        if let flight { SortieFlightTile(flight: flight) }
        if questions.isEmpty {
            Tile { Text("Questions didn’t load. Restart the app to try again.").font(.archivo(15)) }
            next { Task { await save() } }
        } else if qIndex < questions.count {
            let q = questions[qIndex]
            Tile(spacing: 12) {
                Text("Question \(qIndex + 1) of \(questions.count)").font(.archivo(13, .medium)).foregroundStyle(Theme.ink3)
                Text(q.q).font(.archivo(19, .semibold)).fixedSize(horizontal: false, vertical: true)
                ForEach(q.options.indices, id: \.self) { i in
                    option(q.options[i], picked: qPick == i, right: qPick != nil && i == q.answer, wrong: qPick == i && i != q.answer) {
                        guard qPick == nil else { return }
                        qPick = i
                        qAnswers.append((q.id, i == q.answer))
                    }
                }
                if qPick != nil { Text(q.explain).font(.archivo(14.5)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true) }
            }
            if qPick != nil {
                next(qIndex + 1 < questions.count ? "Next question" : "Finish sortie") {
                    if qIndex + 1 < questions.count { qIndex += 1; qPick = nil } else { Task { await save() } }
                }
            }
        }
    }

    // MARK: Result

    @ViewBuilder
    private var doneStep: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Sortie complete").font(.archivo(13, .semibold)).foregroundStyle(Theme.electric)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(grade).font(Theme.display(88)).tracking(-2)
                Text("\(points) of 5\(flew ? " · approach flown" : "")").font(.archivo(15)).foregroundStyle(Theme.ink3)
            }
        }
        if let s = stats.stats {
            DarkTile(spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Pilot Rating \(s.rating)").font(.archivo(20, .semibold))
                    if let b = before, s.rating != b.rating { DeltaTag(d: s.rating - b.rating) }
                    Spacer()
                    Text(s.tier.name).font(.archivo(14, .semibold)).foregroundStyle(Theme.ice)
                }
                ForEach(StatKind.allCases) { k in
                    StatBar(kind: k, value: k.value(s), delta: before.map { k.value(s) - k.value($0) }.flatMap { $0 == 0 ? nil : $0 })
                }
                Text(s.current.days > 0 ? "You’re current for \(s.current.days) days. #\(s.rank) of \(s.total) Boplo pilots." : "#\(s.rank) of \(s.total) Boplo pilots.").font(.archivo(13.5)).foregroundStyle(Theme.mist)
            }
        }
        if let flight { SortieFlightTile(flight: flight) }
        if flew && flight?.landing != nil { Text("Your landing score is added to Handling once it posts. It can take a minute.").font(.archivo(13)).foregroundStyle(Theme.ink3) }
        Button { dismiss() } label: { Text("Done") }.primaryStyle()
    }

    // MARK: Pieces

    private func stepHead(_ title: String, _ stat: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Trains \(stat)").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.electric)
            Text(title).font(Theme.display(32)).tracking(-1)
        }
    }

    private func next(_ label: String = "Next", _ action: @escaping () -> Void) -> some View {
        Button(action: action) { Text(label) }.primaryStyle()
    }

    private func option(_ text: String, picked: Bool, right: Bool, wrong: Bool, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Text(text).font(.archivo(15.5, .medium)).multilineTextAlignment(.leading)
                Spacer(minLength: 0)
                if right { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ok) }
                else if wrong { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger) }
            }
            .padding(15)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(Theme.ink)
            .background(right ? Theme.ok.opacity(0.08) : wrong ? Theme.danger.opacity(0.07) : Theme.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(right ? Theme.ok : wrong ? Theme.danger : Theme.hair, lineWidth: right || wrong ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }

    /// Three questions: the weakest practised subject first, otherwise anything due, otherwise new ones.
    static func debriefQuestions(_ model: AppModel) -> [QuestionBank.Question] {
        guard let bank = QuestionBank.shared?.pack(for: model.regime) else { return [] }
        let st = StudyState(json: model.profile?.study)
        let weakest = bank.subjects.compactMap { s -> (String, Int)? in st.score(bank.questions, subject: s.id).map { (s.id, $0) } }.min { $0.1 < $1.1 }?.0
        let pool = st.mistakes(bank.questions).shuffled()
            + bank.questions.filter { $0.subject == weakest }.shuffled()
            + st.dueQuestions(bank.questions).shuffled()
            + bank.questions.shuffled()
        var seen = Set<String>(), out: [QuestionBank.Question] = []
        for q in pool where !seen.contains(q.id) {
            seen.insert(q.id); out.append(q)
            if out.count == 3 { break }
        }
        return out
    }

    private func save() async {
        guard !saving else { return }
        saving = true
        var st = StudyState(json: model.profile?.study)
        st.record(qAnswers)
        if !qAnswers.isEmpty { st.markStudied() }
        var list = model.jsonList("sorties")
        var entry: [String: Any] = ["d": Day.todayISO, "b": briefOK.map { $0 ? 1 : 0 } ?? -1, "p": preflightOK == true ? 1 : 0, "q": [qAnswers.filter(\.ok).count, qAnswers.count], "g": grade, "f": flew ? 1 : 0]
        if let l = flight?.landing { entry["l"] = l.score }
        list.append(entry)
        let json = (try? JSONSerialization.data(withJSONObject: Array(list.suffix(60)))).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        try? await model.saveProfile(["study": st.json(), "sorties": json])
        await stats.refresh()
        await Reminders.refresh(model)
        step = .done
        saving = false
    }
}

// MARK: - Weather for the brief

struct SortieWeather {
    struct Check { let label: String; let detail: String; let ok: Bool }
    struct Verdict { let go: Bool; let checks: [Check] }
    let station: String
    let raw: String
    let category: String
    let live: Bool
    let wspd: Int
    let wgst: Int
    let wdir: Int?
    let visSM: Double
    let ceiling: Int?
    let wxString: String

    var windText: String { wspd == 0 ? "calm" : "\(wdir.map { String(format: "%03d", $0) } ?? "VRB") at \(wspd) kt\(wgst > 0 ? " gusting \(wgst)" : "")" }

    var verdict: Verdict {
        let ts = wxString.contains("TS") || raw.contains(" TS") || raw.contains("CB")
        let fz = wxString.contains("FZ") || raw.contains(" FZ")
        let checks = [
            Check(label: "Ceiling", detail: ceiling.map { "Lowest broken or overcast layer at \($0.formatted()) ft (minimum 3,000)" } ?? "No ceiling reported", ok: (ceiling ?? 99999) >= 3000),
            Check(label: "Visibility", detail: visSM >= 10 ? "10 SM or more (minimum 5)" : "\(visSM.formatted()) SM (minimum 5)", ok: visSM >= 5),
            Check(label: "Wind", detail: "\(windText) (maximum 15 kt)", ok: wspd <= 15),
            Check(label: "Gusts", detail: wgst > 0 ? "Gusting \(wgst - wspd) kt above the wind (maximum 10)" : "No gusts reported", ok: wgst == 0 || wgst - wspd <= 10),
            Check(label: "Hazards", detail: ts ? "Thunderstorm activity reported" : fz ? "Freezing precipitation or fog reported" : "No thunderstorms or freezing precipitation", ok: !ts && !fz)
        ]
        return Verdict(go: checks.allSatisfy(\.ok), checks: checks)
    }

    @MainActor
    static func load(_ model: AppModel) async -> SortieWeather {
        let code = model.homeCode
        if !code.isEmpty {
            var path = "flight/weather?ids=\(code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code)"
            if let a = await AirfieldStore.shared.find(code, home: model.countryCode) { path += "&lat=\(a.lat)&lng=\(a.lng)" }
            if let obj = try? await API.shared.object(path), let s = (obj["stations"] as? [[String: Any]])?.first, let raw = s["raw"] as? String, !raw.isEmpty {
                return from(station: s["id"] as? String ?? code, raw: raw, fields: s, live: true)
            }
        }
        // a realistic report to judge when live weather isn't available, different each day
        let samples = [
            ("KPAO", "KPAO 201753Z 31012KT 10SM FEW035 18/09 A3004"),
            ("KSNA", "KSNA 201753Z 25018G29KT 10SM SCT040 21/08 A2998"),
            ("KBFI", "KBFI 201753Z 17008KT 4SM -RA BR OVC012 11/09 A2987"),
            ("KDEN", "KDEN 201753Z 33009KT 10SM BKN060 08/M04 A3012"),
            ("KOSH", "KOSH 201753Z 21014G18KT 7SM BKN028 14/10 A2991"),
            ("KMIA", "KMIA 201753Z 09010KT 6SM TS SCT030CB 29/24 A2995"),
            ("KPWM", "KPWM 201753Z 02006KT 3SM -FZRA OVC009 M01/M02 A2979")
        ]
        let s = samples[abs(Day.today) % samples.count]
        return from(station: s.0, raw: s.1, fields: [:], live: false)
    }

    private static func from(station: String, raw: String, fields s: [String: Any], live: Bool) -> SortieWeather {
        let num: (Any?) -> Double? = { v in
            if let n = v as? NSNumber { return n.doubleValue }
            if let t = v as? String { return Double(t.replacingOccurrences(of: "+", with: "")) }
            return nil
        }
        // wind, visibility and cloud from the fields where present, otherwise read off the report itself
        var wdir = num(s["wdir"]).map { Int($0) }, wspd = Int(num(s["wspd"]) ?? -1), wgst = Int(num(s["wgst"]) ?? 0)
        if wspd < 0, let m = raw.range(of: #"\b(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT\b"#, options: .regularExpression) {
            let w = String(raw[m]); let digits = w.dropLast(2)
            wdir = Int(digits.prefix(3)); wspd = Int(digits.dropFirst(3).prefix(while: { $0 != "G" })) ?? 0
            if let g = digits.split(separator: "G").dropFirst().first { wgst = Int(g) ?? 0 }
        }
        var vis = 10.0
        if let v = s["visib"] { vis = String(describing: v).contains("+") ? 10 : (num(v) ?? 10) }
        else if let m = raw.range(of: #"\b(\d{1,2})SM\b"#, options: .regularExpression) { vis = Double(raw[m].dropLast(2)) ?? 10 }
        var ceiling: Int?
        if let clouds = s["clouds"] as? [[String: Any]] {
            ceiling = clouds.filter { ["BKN", "OVC", "OVX", "VV"].contains($0["cover"] as? String ?? "") }.compactMap { num($0["base"]).map { Int($0) } }.min()
        } else {
            let layers = raw.matches(of: /(BKN|OVC|VV)(\d{3})/).compactMap { Int($0.output.2).map { $0 * 100 } }
            ceiling = layers.min()
        }
        let cat: String = {
            if let c = s["fltCat"] as? String, !c.isEmpty { return c }
            let c = ceiling ?? 99999
            return c < 500 || vis < 1 ? "LIFR" : c < 1000 || vis < 3 ? "IFR" : c <= 3000 || vis <= 5 ? "MVFR" : "VFR"
        }()
        return SortieWeather(station: station, raw: raw, category: cat, live: live, wspd: max(0, wspd), wgst: wgst, wdir: wdir, visSM: vis, ceiling: ceiling, wxString: s["wx"] as? String ?? raw)
    }
}

// MARK: - Preflight findings

struct PreflightFinding {
    let finding: String
    let options: [String]
    let answer: Int
    let explain: String

    static var forToday: PreflightFinding { all[abs(Day.today) % all.count] }

    static let all: [PreflightFinding] = [
        .init(finding: "Your first fuel sample from the left wing sump has a clear bubble of water at the bottom.", options: ["Fly anyway, a little water is normal", "Keep draining samples until no water shows, then check the other sumps", "Add more fuel to dilute it"], answer: 1, explain: "Water sinks below avgas. Keep sampling until the fuel is clean, check every sump, and if the water keeps coming, don’t fly and get it looked at."),
        .init(finding: "The dipstick shows 4 quarts. The POH minimum for flight is 5, and it recommends 6 to 8.", options: ["Add oil to at least the recommended level before flight", "Fly, 4 quarts is close enough", "Run the engine to warm the oil, then re-check"], answer: 0, explain: "Below the minimum is a no-go. Add the approved oil grade to the recommended level and note how much it took."),
        .init(finding: "The red pitot tube cover is still on.", options: ["Leave it, it blows off on takeoff", "Remove it and stow it before you board", "Remove it after engine start"], answer: 1, explain: "A covered pitot tube means no airspeed indication. Covers come off during the walkaround and get stowed, so nothing is forgotten."),
        .init(finding: "There’s a small, sharp nick on the leading edge of the propeller.", options: ["Fly, it’s cosmetic", "Don’t fly; have a mechanic inspect and dress it", "Sand it smooth yourself"], answer: 1, explain: "Prop nicks concentrate stress and can lead to a blade failure. A mechanic decides if it can be dressed or the prop must come off."),
        .init(finding: "A fuel cap feels loose and doesn’t lock properly.", options: ["Secure it properly or don’t fly", "It’s fine for a local flight", "Tape it down"], answer: 0, explain: "A loose cap can siphon fuel overboard in flight surprisingly fast. It must seal and lock."),
        .init(finding: "The left main tire shows the cord through the tread.", options: ["Fly, it only matters on landing", "Don’t fly until the tire is replaced", "Let some air out"], answer: 1, explain: "Visible cord means the tire is worn past limits and can burst on landing. That’s a maintenance item before flight."),
        .init(finding: "The stall warning tab on the leading edge doesn’t move when you lift it gently.", options: ["Ignore it, it’s an extra", "Report it; the stall warning may be inoperative, so check whether you may legally fly", "Bend it until it moves"], answer: 1, explain: "Inoperative equipment needs checking against the aircraft’s equipment list or MEL (14 CFR 91.213). Never fix it yourself."),
        .init(finding: "The fuel gauges read full, but you can’t see fuel when you look in the tanks.", options: ["Trust the gauges", "Trust what you see: check with a dipstick and refuel as needed", "Fly a short local flight to test"], answer: 1, explain: "Fuel gauges in light aircraft are notoriously unreliable. Always confirm fuel visually or with a calibrated dipstick."),
        .init(finding: "The static port has a small bug squashed over the hole.", options: ["Clean it carefully without enlarging or blocking the hole", "Leave it, it’s tiny", "Poke it out with a pen"], answer: 0, explain: "A blocked static port affects the altimeter, VSI and airspeed. Clean it gently; never force anything into it."),
        .init(finding: "You find the aircraft’s annual inspection expired last week.", options: ["Fly, it’s only a week", "Don’t fly: it isn’t airworthy until the inspection is done", "Fly if your instructor is on board"], answer: 1, explain: "14 CFR 91.409: no annual inspection in the last 12 calendar months means the aircraft may not be flown, with anyone on board."),
        .init(finding: "There’s a light layer of frost on the top of the wings this morning.", options: ["It’ll blow off on the takeoff roll", "Remove all of it before flight", "Take off with extra speed"], answer: 1, explain: "Even thin frost disrupts airflow, raises the stall speed and can stop the airplane flying. Remove it completely."),
        .init(finding: "A cotter pin is missing from the elevator hinge bolt.", options: ["Don’t fly; get maintenance to fix it", "Fly gently", "Wrap it with safety wire yourself"], answer: 0, explain: "Missing safety hardware on flight controls can let the bolt back out. That’s a no-go and a job for a mechanic."),
        .init(finding: "Blue fuel is dripping steadily from under the right wing.", options: ["Normal, it’s overflow", "Don’t fly; find the leak and have it inspected", "Fly but use the left tank"], answer: 1, explain: "A steady drip is a fuel leak, which is a fire risk and can mean losing fuel in flight. Get it checked."),
        .init(finding: "The aircraft’s registration certificate isn’t in the documents pouch.", options: ["Fly, it’s only paperwork", "Don’t fly until the required documents are on board", "Take a photo of a copy"], answer: 1, explain: "The airworthiness and registration certificates must be on board (think ARROW). Without them the flight isn’t legal."),
        .init(finding: "The alternator belt looks frayed and loose.", options: ["Fly and keep an eye on the ammeter", "Have it checked before flight", "Turn off the radios to save power"], answer: 1, explain: "A failing belt means losing the alternator in flight. Report it and have it inspected first."),
        .init(finding: "The oil filler cap is sitting loose on top of the engine.", options: ["Close and secure it, and check the dipstick seats properly", "Fly, the cowling holds it", "Tape over the filler"], answer: 0, explain: "A loose oil cap can pump oil overboard, covering the windshield and starving the engine. Always secure it."),
        .init(finding: "During the walkaround you notice a wasp nest inside the engine air intake.", options: ["Start the engine to blow it out", "Have it removed safely before starting", "Fly, the filter catches it"], answer: 1, explain: "Nests can block airflow or be drawn into the engine. Clear them before start."),
        .init(finding: "The fuel sample is clear and smells like kerosene.", options: ["Normal 100LL", "Possible jet fuel contamination: don’t fly", "Water in the fuel"], answer: 1, explain: "100LL is dyed blue. Clear, kerosene-smelling fuel suggests Jet A, which can destroy a piston engine. Don’t fly; get it checked."),
        .init(finding: "The left aileron moves up, but the right one doesn’t move down when you work the yoke.", options: ["Normal differential ailerons", "Don’t fly: a control may be disconnected", "Fly with extra rudder"], answer: 1, explain: "Ailerons must move freely and in the correct sense. A control that doesn’t respond is a no-go until a mechanic finds out why."),
        .init(finding: "The ELT switch is set to OFF.", options: ["Leave it, it saves battery", "Set it to ARMED (or AUTO) before flight", "Turn it ON"], answer: 1, explain: "Armed, the ELT activates in a crash. ON transmits a distress signal now, and OFF won’t help anyone find you."),
    ]
}


// MARK: - The approach result, reported by the web simulator

struct SortieFlight: Decodable, Equatable {
    struct Landing: Decodable, Equatable {
        struct Parts: Decodable, Equatable { let rate: Double; let point: Double; let line: Double; let speed: Double }
        let score: Int
        let parts: Parts
        let fpm: Int
        let td: Int
        let cl: Double
        let kt: Int
    }
    let kind: String
    let crash: String?
    let landing: Landing?
    let fpm: Int?
    let bank: Int?
}

/// How the sortie's approach went: the landing score and what made it up, or what went wrong.
struct SortieFlightTile: View {
    let flight: SortieFlight
    var body: some View {
        DarkTile(spacing: 12) {
            if let l = flight.landing {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text("\(l.score)").font(Theme.display(56)).tracking(-1.5).monospacedDigit()
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Landing score").font(.archivo(15, .semibold))
                        Text(verdict(l.score)).font(.archivo(13)).foregroundStyle(Theme.mist)
                    }
                }
                part("Touchdown rate", "\(abs(l.fpm)) fpm", l.parts.rate, 40)
                part("Touchdown point", l.td < 0 ? "Short of the runway" : "\(l.td) m past the threshold", l.parts.point, 25)
                part("Centreline", String(format: "%.1f m off", l.cl), l.parts.line, 20)
                part("Speed", "\(l.kt) kt", l.parts.speed, 15)
            } else if flight.kind == "crash" {
                Text("The approach ended early").font(.archivo(20, .semibold))
                Text(flight.crash?.isEmpty == false ? flight.crash! : "The aircraft was damaged before it stopped.").font(.archivo(14)).foregroundStyle(Theme.mist)
                Text("Try it again tomorrow, or fly it any time from the Simulator.").font(.archivo(13)).foregroundStyle(Theme.mist)
            } else {
                Text("Approach flown").font(.archivo(20, .semibold))
                Text("No landing was scored this time. Land in the touchdown zone to get a score.").font(.archivo(14)).foregroundStyle(Theme.mist)
            }
        }
    }

    private func verdict(_ s: Int) -> String {
        s >= 85 ? "Checkride standard" : s >= 70 ? "A good landing" : s >= 50 ? "Safe, with room to tidy up" : "Worth another go"
    }

    private func part(_ title: String, _ value: String, _ got: Double, _ of: Double) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.archivo(13.5, .semibold))
                Spacer()
                Text(value).font(.archivo(13)).foregroundStyle(Theme.mist)
            }
            Bar(value: max(0, min(1, got / of)), height: 6, track: .white.opacity(0.12), fill: Theme.ice)
        }
    }
}
