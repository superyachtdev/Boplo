import SwiftUI

// First run, built around the student rather than the features:
//   welcome → where you train → licence → how far along → what's hardest → how often → next lesson → how you heard
//   → your plan (finish date, hours, what Boplo does about what's hardest) → commitment → lesson reminders
//   → save your plan (sign in) → building your desk → 3-day trial → desk.
// The answers are kept on the phone until there is an account to save them to, so nothing is lost if the
// app closes part-way. Someone who signs in first ("I have an account") without a finished profile gets
// the same questions after signing in.

// MARK: - Answers, kept until they can be saved

struct FirstRunAnswers: Codable, Equatable {
    var countryCode = ""
    var airport = ""
    var licenceId = ""
    var stage = ""
    var exactHours = ""
    var struggles: [String] = []
    var pace = ""
    var lessonDate: Date?
    var heardFrom = ""
    var committed = false
    var step = 0

    private static let key = "boplo.firstRun.answers"
    static func load() -> FirstRunAnswers {
        guard let d = UserDefaults.standard.data(forKey: key), let a = try? JSONDecoder().decode(FirstRunAnswers.self, from: d) else { return FirstRunAnswers() }
        return a
    }
    func save() { if let d = try? JSONEncoder().encode(self) { UserDefaults.standard.set(d, forKey: Self.key) } }
    static func clear() { UserDefaults.standard.removeObject(forKey: key) }

    /// Everything up to the commitment has been answered.
    var finished: Bool { committed && !licenceId.isEmpty && !countryCode.isEmpty }

    var country: SetupView.Country {
        SetupView.countries.first { $0.code == countryCode } ?? SetupView.Country(code: "US", name: "United States", regime: "faa", authority: "FAA")
    }
    var licence: SetupView.Licence {
        let list = SetupView.licences(for: country.regime)
        return list.first { $0.id == licenceId } ?? list[0]
    }

    /// The profile fields the server keeps. Name is added by whoever saves it.
    var profile: [String: Any] {
        let c = country, l = licence
        var p: [String: Any] = [
            "country": c.name, "countryCode": c.code, "regime": c.regime, "authority": c.authority,
            "licence": l.id, "goalHours": l.hours > 0 ? l.hours : 45,
            "airport": airport.trimmingCharacters(in: .whitespaces).uppercased(),
            "frequency": FirstRun.paces.first { $0.id == pace }?.label ?? "Still deciding",
            "lessonsPerWeek": FirstRun.paces.first { $0.id == pace }?.perWeek ?? 1,
            "stage": stage, "struggles": struggles.joined(separator: ","), "heardFrom": heardFrom,
            "studyMinutes": 10, "committedAt": Int(Date().timeIntervalSince1970 * 1000),
            "complete": true, "step": 7
        ]
        // only real numbers go into the logbook; a stage on its own isn't logged time
        if let h = Double(exactHours.replacingOccurrences(of: ",", with: ".")), h > 0 { p["openingMinutes"] = Int((h * 60).rounded()) }
        if let d = lessonDate { let f = DateFormatter(); f.calendar = Calendar(identifier: .gregorian); f.dateFormat = "yyyy-MM-dd"; p["lessonDate"] = f.string(from: d) }
        return p
    }
}

// MARK: - The plan, worked out from the answers

enum FirstRun {
    struct Option: Identifiable, Hashable { let id: String, label: String, detail: String? }
    struct Pace: Identifiable, Hashable { let id: String, label: String, detail: String, perWeek: Double }

    static let stages: [Option] = [
        .init(id: "new", label: "Haven’t started yet", detail: "Looking into it, or booked a first lesson"),
        .init(id: "early", label: "A few lessons in", detail: "Under 10 hours"),
        .init(id: "presolo", label: "Working towards solo", detail: "About 10 to 25 hours"),
        .init(id: "solo", label: "Flown solo", detail: "Building hours and cross-countries"),
        .init(id: "checkride", label: "Checkride coming up", detail: "Final hours, exams and the test")
    ]
    static let struggles: [Option] = [
        .init(id: "landings", label: "Landings", detail: nil),
        .init(id: "radio", label: "Radio calls", detail: nil),
        .init(id: "theory", label: "Theory exams", detail: nil),
        .init(id: "cost", label: "The cost", detail: nil),
        .init(id: "time", label: "Finding time to study", detail: nil),
        .init(id: "checkride", label: "Checkride nerves", detail: nil),
        .init(id: "planning", label: "Weather and planning", detail: nil),
        .init(id: "current", label: "Staying current between lessons", detail: nil)
    ]
    static let paces: [Pace] = [
        .init(id: "twice", label: "Twice a week", detail: "Two or more lessons a week", perWeek: 2),
        .init(id: "weekly", label: "Weekly", detail: "About once a week", perWeek: 1),
        .init(id: "monthly", label: "Monthly", detail: "A couple of times a month or less", perWeek: 0.5),
        .init(id: "intensive", label: "Intensive course", detail: "Full-time, most days", perWeek: 5),
        .init(id: "deciding", label: "Still deciding", detail: "Not sure yet", perWeek: 1)
    ]
    static let sources: [Option] = [
        .init(id: "tiktok", label: "TikTok", detail: nil), .init(id: "instagram", label: "Instagram", detail: nil),
        .init(id: "youtube", label: "YouTube", detail: nil), .init(id: "appstore", label: "Searching the App Store", detail: nil),
        .init(id: "google", label: "Google", detail: nil), .init(id: "friend", label: "A friend or instructor", detail: nil),
        .init(id: "school", label: "My flight school", detail: nil), .init(id: "other", label: "Somewhere else", detail: nil)
    ]

    /// What Boplo does about each thing someone said was hard.
    static let help: [String: (String, String)] = [
        "landings": ("airplane.arrival", "Practise approaches and landings at your own airfield in the simulator, with each landing scored"),
        "radio": ("dot.radiowaves.left.and.right", "Rehearse your radio calls out loud, with every call checked"),
        "theory": ("graduationcap.fill", "Mock exams by subject, with the questions you miss coming back until you know them"),
        "cost": ("chart.line.downtrend.xyaxis", "See what your licence will really cost, and how flying more often brings it down"),
        "time": ("clock.fill", "A 10-minute daily sortie and 3 questions a day on your lock screen"),
        "checkride": ("checkmark.seal.fill", "A mock checkride that questions you like a real examiner"),
        "planning": ("cloud.sun.fill", "Live weather decoded in plain English, nav logs and preflight checks"),
        "current": ("calendar.badge.clock", "Currency and expiry dates worked out from your logbook, with reminders")
    ]

    struct Plan {
        let typical: Int, current: Double, toGo: Double, perWeek: Double, weeks: Int, finish: Date, fasterWeeks: Int?
    }

    /// The same plan for a saved profile (the trial offer and anywhere else after setup).
    static func answers(from p: Profile?) -> FirstRunAnswers {
        var a = FirstRunAnswers()
        a.countryCode = p?.countryCode ?? "US"
        a.licenceId = p?.licence ?? ""
        a.stage = p?.stage ?? "new"
        a.pace = paces.first { $0.label == p?.frequency }?.id ?? "weekly"
        a.struggles = (p?.struggles ?? "").split(separator: ",").map(String.init)
        if let m = p?.openingMinutes, m > 0 { a.exactHours = String(m / 60) }
        return a
    }

    /// Plans for more than the legal minimum, because most students need more: about 1.5× in the US, 1.3× elsewhere.
    static func plan(_ a: FirstRunAnswers, now: Date = Date()) -> Plan {
        let goal = Double(a.licence.hours > 0 ? a.licence.hours : 45)
        let typical = (goal * (a.country.regime == "faa" ? 1.5 : 1.3)).rounded()
        let exact = Double(a.exactHours.replacingOccurrences(of: ",", with: "."))
        let guess: Double = ["new": 0, "early": 5, "presolo": 17, "solo": 28, "checkride": max(0, typical - 6)][a.stage] ?? 0
        let current = min(typical, exact ?? guess)
        let pace = paces.first { $0.id == a.pace }?.perWeek ?? 1
        let hoursPerWeek = pace * 1.2
        let toGo = max(0, typical - current)
        let weeks = max(1, Int((toGo / hoursPerWeek).rounded(.up)))
        let faster = pace < 2 ? weeks - max(1, Int((toGo / 2.4).rounded(.up))) : nil
        return Plan(typical: Int(typical), current: current, toGo: toGo, perWeek: pace, weeks: weeks,
                    finish: Calendar.current.date(byAdding: .day, value: weeks * 7, to: now) ?? now, fasterWeeks: faster.flatMap { $0 >= 2 ? $0 : nil })
    }
}

// MARK: - Welcome

struct WelcomeView: View {
    var onStart: () -> Void
    var onSignIn: () -> Void
    @State private var rise = false

    var body: some View { screenBody.screen("welcome") }
    @ViewBuilder private var screenBody: some View {
        ZStack {
            NightBackdrop()
            VStack(alignment: .leading, spacing: 0) {
                BoploWordmark(height: 30).padding(.top, 12)
                Spacer()
                VStack(alignment: .leading, spacing: 16) {
                    Text("Get your licence faster, and for less.")
                        .font(Theme.display(46)).tracking(-1.6).foregroundStyle(.white)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("Answer a few quick questions and Boplo builds a training plan around you: your licence, your pace, the things you find hardest.")
                        .font(.archivo(17)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .opacity(rise ? 1 : 0).offset(y: rise ? 0 : 14)
                Spacer()
                Button(action: onStart) { Text("Build my plan") }.primaryStyle()
                Button(action: onSignIn) { Text("I already have an account").font(.archivo(15.5, .medium)).foregroundStyle(Theme.mist).frame(maxWidth: .infinity, minHeight: 46) }
                    .padding(.bottom, 6)
            }
            .padding(.horizontal, 24)
        }
        .preferredColorScheme(.dark)
        .onAppear { withAnimation(.easeOut(duration: 0.7).delay(0.1)) { rise = true } }
    }
}

// MARK: - The questions, the plan and the commitment

struct QuestionFlow: View {
    @Environment(AppModel.self) private var model
    enum Mode { case beforeAccount, afterAccount }
    let mode: Mode
    var onBack: () -> Void = {}
    /// beforeAccount: show "save your plan" (sign in). afterAccount: save the profile.
    var onDone: (FirstRunAnswers) -> Void

    private enum Step: Int, CaseIterable { case country, goal, stage, struggles, pace, lesson, heard, plan, commit, reminders }
    @State private var a = FirstRunAnswers.load()
    @State private var step: Step = .country
    @State private var forward = true
    @State private var countries: [SetupView.Country] = []
    @State private var hasLesson = true
    @State private var holding = false
    @State private var held: CGFloat = 0
    @FocusState private var focused: Bool
    /// Fixed for this run, so turning reminders on doesn't change the steps under someone's feet.
    @State private var skipReminders = Reminders.decided

    private var steps: [Step] { skipReminders ? Step.allCases.filter { $0 != .reminders } : Step.allCases }
    private var index: Int { steps.firstIndex(of: step) ?? 0 }
    private var dark: Bool { step == .plan || step == .commit || step == .reminders }

    var body: some View {
        VStack(spacing: 0) {
            top
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if let t = titles {
                        Text(t.0).font(Theme.display(34)).tracking(-1.1).foregroundStyle(dark ? .white : Theme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        if !t.1.isEmpty {
                            Text(t.1).font(.archivo(16.5)).foregroundStyle(dark ? Color(hex: 0xDEE9FF).opacity(0.8) : Theme.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    fields.padding(.top, 8)
                }
                .padding(.horizontal, 22).padding(.top, 28).padding(.bottom, 24)
                .id(step)
                .transition(.asymmetric(insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                                        removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)))
            }
            .scrollDismissesKeyboard(.interactively)
            bottom.padding(.horizontal, 22).padding(.bottom, 12)
        }
        .background { if dark { NightBackdrop() } else { Theme.cloud.ignoresSafeArea() } }
        .preferredColorScheme(dark ? .dark : .light)
        .animation(.easeInOut(duration: 0.3), value: dark)
        .sensoryFeedback(.selection, trigger: a.struggles)
        .sensoryFeedback(.selection, trigger: a.pace)
        .sensoryFeedback(.selection, trigger: a.stage)
        .onAppear {
            if countries.isEmpty { countries = SetupView.countries }
            if a.countryCode.isEmpty { a.countryCode = Locale.current.region?.identifier ?? "US"; if !countries.contains(where: { $0.code == a.countryCode }) { a.countryCode = "US" } }
            if a.licenceId.isEmpty { a.licenceId = SetupView.licences(for: a.country.regime)[0].id }
            if a.pace.isEmpty { a.pace = "weekly" }
            if let s = Step(rawValue: a.step), steps.contains(s), mode == .beforeAccount || s.rawValue < Step.reminders.rawValue { step = s }
        }
        .onChange(of: step, initial: true) { _, s in
            Track.screen(["q_country", "q_goal", "q_stage", "q_struggles", "q_pace", "q_lesson", "q_heard", "plan", "commit", "reminders"][s.rawValue])
        }
        .onChange(of: a) { _, v in v.save() }
    }

    // MARK: chrome

    private var top: some View {
        HStack(spacing: 14) {
            Button { back() } label: {
                Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundStyle(dark ? .white : Theme.ink)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(dark ? Color.white.opacity(0.1) : Color.white).shadow(color: Theme.ink.opacity(dark ? 0 : 0.08), radius: 1, y: 1))
            }
            .accessibilityLabel("Back")
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(dark ? Color.white.opacity(0.12) : Theme.ink.opacity(0.08))
                    Capsule().fill(LinearGradient(colors: [Theme.electric, Theme.electricHi], startPoint: .leading, endPoint: .trailing))
                        .frame(width: g.size.width * CGFloat(index + 1) / CGFloat(steps.count + (mode == .beforeAccount ? 1 : 0)))
                }
            }
            .frame(height: 6)
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: step)
        }
        .padding(.horizontal, 18).padding(.top, 8)
    }

    @ViewBuilder private var bottom: some View {
        switch step {
        case .commit:
            holdButton
        case .reminders:
            VStack(spacing: 4) {
                Button { Task { _ = await Reminders.enable(hour: 19, minute: 0, model: model); Track.event("reminders_on_onboarding"); next() } } label: { Text("Turn on reminders") }
                    .primaryStyle()
                Button("Not now") { Track.event("reminders_skip"); Reminders.dismissOffer(); next() }
                    .font(.archivo(15)).foregroundStyle(Theme.mist).frame(height: 44)
            }
        case .lesson:
            VStack(spacing: 4) {
                Button { next() } label: { Text("Continue") }.primaryStyle()
                Button("I don’t have one booked") { a.lessonDate = nil; hasLesson = false; next() }
                    .font(.archivo(15)).foregroundStyle(Theme.ink3).frame(height: 40)
            }
        case .plan:
            Button { next() } label: { Text("Let’s do it") }.primaryStyle()
        default:
            Button { next() } label: { Text("Continue") }.primaryStyle().disabled(!canContinue)
        }
    }

    private var canContinue: Bool {
        switch step {
        case .stage: return !a.stage.isEmpty
        case .struggles: return !a.struggles.isEmpty
        case .heard: return !a.heardFrom.isEmpty
        default: return true
        }
    }

    private var titles: (String, String)? {
        switch step {
        case .country: return ("Where are you learning to fly?", "Rules, minimum hours and weather all depend on where you train.")
        case .goal: return ("What are you working toward?", "Boplo tracks your hours against it. Your school decides when you’re ready.")
        case .stage: return ("Where are you in your training?", "Rough is fine.")
        case .struggles: return ("What do you find hardest right now?", "Pick as many as you like. Your plan starts with these.")
        case .pace: return ("How often will you fly?", "Flying often is the biggest thing that keeps the total cost down.")
        case .lesson: return ("When’s your next lesson?", "Boplo gets you ready the evening before.")
        case .heard: return ("Where did you hear about Boplo?", "")
        case .plan: return nil
        case .commit: return ("Make it official", "Small, steady habits are what get students to their checkride. Here’s yours.")
        case .reminders: return ("Get a nudge before each lesson", "Reminders are how most students keep the habit. You can change or turn them off any time.")
        }
    }

    // MARK: screens

    @ViewBuilder private var fields: some View {
        switch step {
        case .country:
            VStack(alignment: .leading, spacing: 12) {
                Menu {
                    Picker("Country", selection: Binding(get: { a.countryCode }, set: { a.countryCode = $0; a.licenceId = SetupView.licences(for: a.country.regime)[0].id })) {
                        ForEach(countries) { Text($0.name).tag($0.code) }
                    }
                } label: {
                    HStack {
                        Text(a.country.name).font(.archivo(17)).foregroundStyle(Theme.ink).lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3)
                    }
                    .boploField()
                }
                Text("Licensing authority: \(a.country.authority)").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                TextField("Home airfield, e.g. \(a.country.regime == "faa" ? "KSEE" : "EGKA") (optional)", text: $a.airport)
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .font(.archivo(17)).boploField().focused($focused)
            }
        case .goal:
            VStack(spacing: 10) {
                ForEach(SetupView.licences(for: a.country.regime), id: \.self) { l in
                    ChoiceCard(title: l.label, detail: l.hours > 0 ? "Published minimum: \(l.hours) hours" : nil, selected: l.id == a.licenceId) { a.licenceId = l.id }
                }
            }
        case .stage:
            VStack(spacing: 10) {
                ForEach(FirstRun.stages) { s in
                    ChoiceCard(title: s.label, detail: s.detail, selected: a.stage == s.id) { a.stage = s.id }
                }
                if !a.stage.isEmpty && a.stage != "new" {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("Exact hours, if you know them").font(.archivo(15)).foregroundStyle(Theme.ink2)
                        Spacer()
                        TextField("Optional", text: $a.exactHours).keyboardType(.decimalPad).multilineTextAlignment(.trailing)
                            .font(.archivo(17, .semibold)).frame(width: 90).focused($focused)
                    }
                    .boploField()
                    .transition(.opacity)
                }
            }
            .animation(.easeInOut(duration: 0.2), value: a.stage)
        case .struggles:
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(FirstRun.struggles) { s in
                    let on = a.struggles.contains(s.id)
                    Button {
                        if on { a.struggles.removeAll { $0 == s.id } } else { a.struggles.append(s.id) }
                    } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            Image(systemName: FirstRun.help[s.id]?.0 ?? "circle").font(.system(size: 20, weight: .semibold))
                                .foregroundStyle(on ? .white : Theme.electric)
                            Text(s.label).font(.archivo(15.5, .semibold)).foregroundStyle(on ? .white : Theme.ink)
                                .multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
                        .padding(14)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(on ? Theme.electric : .white)
                            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? .clear : Theme.hair)))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        case .pace:
            VStack(spacing: 10) {
                ForEach(FirstRun.paces) { p in
                    ChoiceCard(title: p.label, detail: p.detail, selected: a.pace == p.id) { a.pace = p.id }
                }
            }
        case .lesson:
            DatePicker("Next lesson", selection: Binding(get: { a.lessonDate ?? Calendar.current.date(byAdding: .day, value: 2, to: Date())! }, set: { a.lessonDate = $0 }),
                       in: Calendar.current.startOfDay(for: Date())..., displayedComponents: .date)
                .datePickerStyle(.graphical)
                .tint(Theme.electric)
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.white))
                .onAppear { if a.lessonDate == nil && hasLesson { a.lessonDate = Calendar.current.date(byAdding: .day, value: 2, to: Date()) } }
        case .heard:
            VStack(spacing: 10) {
                ForEach(FirstRun.sources) { s in
                    ChoiceCard(title: s.label, detail: nil, selected: a.heardFrom == s.id) { a.heardFrom = s.id }
                }
            }
        case .plan:
            PlanSummary(answers: a)
        case .commit:
            VStack(alignment: .leading, spacing: 10) {
                commitRow("book.closed.fill", "Study 10 minutes a day", "The daily sortie, 3 questions, or a radio call")
                commitRow("airplane", "Fly \((FirstRun.paces.first { $0.id == a.pace }?.label ?? "weekly").lowercased())", "And prepare for each lesson the evening before")
                commitRow("pencil.line", "Log every lesson the same day", "With what went well and what to work on")
            }
        case .reminders:
            VStack(alignment: .leading, spacing: 12) {
                notePreview("Lesson tomorrow", a.lessonDate == nil ? "Your 5-minute brief is ready: circuits, radio calls and the weather." : "Your 5-minute brief for \(a.lessonDate!.formatted(.dateTime.weekday(.wide))) is ready.")
                notePreview("Question of the day", "Answer it right from your lock screen.")
            }
        }
    }

    private func commitRow(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: symbol).font(.system(size: 18, weight: .semibold)).foregroundStyle(.white)
                .frame(width: 42, height: 42).background(Circle().fill(Theme.electric))
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.archivo(16.5, .semibold)).foregroundStyle(.white)
                Text(detail).font(.archivo(13.5)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.75))
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(.white.opacity(0.07))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.ice.opacity(0.15))))
    }

    private func notePreview(_ title: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "airplane").font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                .frame(width: 38, height: 38).background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Theme.electric))
            VStack(alignment: .leading, spacing: 2) {
                HStack { Text("BOPLO").font(.archivo(12, .semibold)).foregroundStyle(Theme.ink3); Spacer(); Text("now").font(.archivo(12)).foregroundStyle(Theme.ink3) }
                Text(title).font(.archivo(15, .semibold)).foregroundStyle(Theme.ink)
                Text(text).font(.archivo(14)).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(.white.opacity(0.92)))
    }

    /// Press and hold to commit: a small effort that makes the plan feel like theirs.
    private var holdButton: some View {
        ZStack {
            Capsule().fill(.white.opacity(0.12))
            GeometryReader { g in Capsule().fill(Theme.electric).frame(width: max(56, g.size.width * held)) }
            Text(a.committed ? "Committed" : holding ? "Keep holding…" : "Hold to commit")
                .font(.archivo(17, .semibold)).foregroundStyle(.white)
        }
        .frame(height: 56)
        .clipShape(Capsule())
        .contentShape(Capsule())
        .onLongPressGesture(minimumDuration: 1.4, maximumDistance: 40) {
            a.committed = true
            Track.event("committed")
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            Task { try? await Task.sleep(for: .seconds(0.5)); next() }
        } onPressingChanged: { pressing in
            holding = pressing
            if a.committed { return }
            if pressing { withAnimation(.linear(duration: 1.4)) { held = 1 } } else { withAnimation(.easeOut(duration: 0.25)) { held = 0 } }
        }
        .sensoryFeedback(.impact(weight: .light), trigger: holding)
        .accessibilityLabel("Hold to commit")
        .accessibilityAction { a.committed = true; next() }
    }

    // MARK: moving

    private func next() {
        focused = false
        guard let i = steps.firstIndex(of: step) else { return }
        if i == steps.count - 1 {
            a.step = step.rawValue; a.save()
            Track.event("questions_done", ["stage": a.stage, "pace": a.pace, "heard": a.heardFrom, "struggles": a.struggles.joined(separator: ",")])
            onDone(a); return
        }
        forward = true
        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) { step = steps[i + 1] }
        a.step = step.rawValue
    }

    private func back() {
        focused = false
        guard let i = steps.firstIndex(of: step), i > 0 else { onBack(); return }
        forward = false
        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) { step = steps[i - 1] }
        a.step = step.rawValue
    }
}

// MARK: - The plan screen

struct PlanSummary: View {
    let answers: FirstRunAnswers
    @State private var drawn: CGFloat = 0

    var body: some View {
        let p = FirstRun.plan(answers)
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Label("Your plan is ready", systemImage: "sparkles").font(.archivo(13.5, .semibold)).foregroundStyle(Color(hex: 0xBFD6FF))
                Text("\(shortLicence) by \(p.finish.formatted(.dateTime.month(.wide).year()))")
                    .font(Theme.display(38)).tracking(-1.3).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
                Text("Flying \(pace.lowercased()), with about \(Int(p.toGo.rounded())) hours to go. Boplo plans for \(p.typical) hours, because most students need more than the \(answers.licence.hours > 0 ? answers.licence.hours : 45)-hour minimum.")
                    .font(.archivo(15)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.8)).fixedSize(horizontal: false, vertical: true)
            }
            chart(p)
            if let f = p.fasterWeeks {
                Label("Flying twice a week would get you there about \(f) weeks sooner.", systemImage: "bolt.fill")
                    .font(.archivo(14, .medium)).foregroundStyle(Color(hex: 0xFFD27A)).fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 10) {
                Text("Starting with what you find hardest").font(.archivo(13.5, .semibold)).foregroundStyle(Color(hex: 0xBFD6FF))
                ForEach(helpRows, id: \.1) { r in
                    HStack(alignment: .top, spacing: 12) {
                        Image(systemName: r.0).font(.system(size: 16, weight: .semibold)).foregroundStyle(Theme.electricHi).frame(width: 22)
                        Text(r.1).font(.archivo(15)).foregroundStyle(.white).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
        .onAppear { withAnimation(.easeInOut(duration: 1.2).delay(0.2)) { drawn = 1 } }
    }

    private var pace: String { FirstRun.paces.first { $0.id == answers.pace }?.label ?? "Weekly" }
    private var shortLicence: String {
        let l = answers.licence.label
        return String(l.split(separator: "·").first ?? Substring(l)).trimmingCharacters(in: .whitespaces)
    }
    private var helpRows: [(String, String)] {
        let picked = answers.struggles.compactMap { FirstRun.help[$0] }
        let extra = ["checkride", "theory", "landings"].compactMap { FirstRun.help[$0] }.filter { e in !picked.contains { $0.1 == e.1 } }
        return Array((picked + extra).prefix(3))
    }

    private func chart(_ p: FirstRun.Plan) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { g in
                let w = g.size.width, h = g.size.height
                let y0 = h - 8 - (h - 24) * CGFloat(p.current / Double(p.typical))
                ZStack(alignment: .topLeading) {
                    Path { path in path.move(to: CGPoint(x: 0, y: 10)); path.addLine(to: CGPoint(x: w, y: 10)) }
                        .stroke(Theme.ice.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [4, 5]))
                    Path { path in
                        path.move(to: CGPoint(x: 6, y: y0))
                        path.addCurve(to: CGPoint(x: w - 8, y: 10), control1: CGPoint(x: w * 0.45, y: y0), control2: CGPoint(x: w * 0.6, y: 10))
                    }
                    .trim(from: 0, to: drawn)
                    .stroke(LinearGradient(colors: [Theme.electric, Theme.electricHi], startPoint: .leading, endPoint: .trailing), style: StrokeStyle(lineWidth: 4, lineCap: .round))
                    .shadow(color: Theme.electricHi.opacity(0.6), radius: 6)
                    Circle().fill(.white).frame(width: 10, height: 10).position(x: 6, y: y0)
                    Image(systemName: "flag.checkered").font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .padding(6).background(Circle().fill(Theme.electric)).position(x: w - 8, y: 10).opacity(drawn)
                }
            }
            .frame(height: 140)
            HStack {
                Text("Today · \(Int(p.current.rounded())) h").font(.archivo(12.5)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.7))
                Spacer()
                Text("\(p.finish.formatted(.dateTime.month(.abbreviated).year())) · \(p.typical) h").font(.archivo(12.5)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.7))
            }
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.white.opacity(0.06))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.ice.opacity(0.14))))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("From \(Int(p.current)) hours today to \(p.typical) hours by \(p.finish.formatted(.dateTime.month(.wide).year()))")
    }
}

// MARK: - Signed out: welcome, the questions, then save the plan by signing in

struct FirstRunView: View {
    private enum Stage { case welcome, questions, save, signIn }
    @AppStorage("boplo.firstRun.stage") private var stored = "welcome"
    @State private var stage: Stage = .welcome

    var body: some View {
        Group {
            switch stage {
            case .welcome: WelcomeView(onStart: { go(.questions) }, onSignIn: { go(.signIn) })
            case .questions: QuestionFlow(mode: .beforeAccount, onBack: { go(.welcome) }, onDone: { _ in go(.save) })
            case .save: SignInView(screenName: "save_plan", title: "Save your plan", subtitle: "Create your free account so your plan, logbook and progress are kept safe on every device.", onBack: { go(.questions) })
            case .signIn: SignInView(onBack: { go(.welcome) })
            }
        }
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.3), value: stored)
        .onAppear {
            let saved: [String: Stage] = ["questions": .questions, "save": .save, "signIn": .signIn]
            stage = saved[stored] ?? .welcome
        }
    }

    private func go(_ s: Stage) {
        withAnimation(.easeInOut(duration: 0.3)) { stage = s }
        stored = ["welcome", "questions", "save", "signIn"][[Stage.welcome, .questions, .save, .signIn].firstIndex(of: s)!]
    }
}

// MARK: - Signed in, profile not finished: save the answers (asking the questions first if needed)

struct FinishSetupView: View {
    @Environment(AppModel.self) private var model
    @State private var answers = FirstRunAnswers.load()
    @State private var name = ""
    @State private var needName = false
    @State private var building = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            if building {
                BuildingDeskView(rows: rows).transition(.opacity)
            } else if !answers.finished {
                QuestionFlow(mode: .afterAccount, onBack: { Task { await model.signOut() } }, onDone: { a in answers = a; start() })
            } else if needName {
                nameScreen
            } else {
                LaunchView().onAppear(perform: start)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: building)
        .animation(.easeInOut(duration: 0.3), value: needName)
    }

    private var known: String {
        [model.profile?.name, model.workspace?.user.display_name].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty } ?? ""
    }

    private var nameScreen: some View {
        VStack(alignment: .leading, spacing: 14) {
            Spacer().frame(height: 40)
            Text("Last thing: what should we call you?").font(Theme.display(34)).tracking(-1.1).foregroundStyle(Theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text("This is how Boplo greets you. Nobody else sees it unless you share.").font(.archivo(16.5)).foregroundStyle(Theme.ink2)
            TextField("Your name", text: $name).textContentType(.name).font(.archivo(18)).boploField().focused($focused)
                .submitLabel(.done).onSubmit(save)
            if let error { Text(error).font(.archivo(14)).foregroundStyle(Theme.danger) }
            Spacer()
            Button(action: save) { Text("Build my flight desk") }.primaryStyle()
                .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(22)
        .background(Theme.cloud.ignoresSafeArea())
        .preferredColorScheme(.light)
        .screen("q_name")
        .onAppear { focused = true }
    }

    private func start() {
        if known.isEmpty { needName = true } else { name = known; save() }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        focused = false
        building = true
        Task {
            try? await Task.sleep(for: .seconds(UIAccessibility.isReduceMotionEnabled ? 0.6 : 2.9))
            var p = answers.profile
            p["name"] = n
            do {
                try await model.saveProfile(p)
                Track.event("onboarding_done", ["country": answers.countryCode, "licence": answers.licenceId, "pace": answers.pace, "stage": answers.stage, "heard": answers.heardFrom])
                FirstRunAnswers.clear()
                UserDefaults.standard.removeObject(forKey: "boplo.firstRun.stage")
            } catch {
                Track.event("onboarding_error")
                self.error = error.localizedDescription
                building = false
                needName = true
                name = n
            }
        }
    }

    private var rows: [String] {
        let plan = FirstRun.plan(answers)
        let field = answers.airport.trimmingCharacters(in: .whitespaces).uppercased()
        return [
            "Your \(answers.licence.label) plan",
            "\(plan.typical) h goal, finishing \(plan.finish.formatted(.dateTime.month(.wide).year()))",
            field.isEmpty ? "Live weather at any airport" : "Live weather for \(field)",
            answers.lessonDate == nil ? "Lesson prep and mock checkride" : "Prep for your lesson on \(answers.lessonDate!.formatted(.dateTime.weekday(.wide)))",
            "Starting with \(FirstRun.struggles.first { answers.struggles.first == $0.id }?.label.lowercased() ?? "the basics")"
        ]
    }
}
