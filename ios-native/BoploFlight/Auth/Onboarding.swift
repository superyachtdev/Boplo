import SwiftUI
import StoreKit

// The first-run path, one screen at a time:
//  intro pages (signed out) → sign in → one question per screen → "building your desk" → 3-day trial → desk.
// The iPhone app needs Advanced (free trial or subscription). The website keeps its free plan.

/// The dark sky every first-run screen sits on.
struct NightBackdrop: View {
    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(hex: 0x0B3FB8).opacity(0.55), Color(hex: 0x040B22), Theme.night],
                           center: UnitPoint(x: 0.5, y: 0), startRadius: 0, endRadius: 640)
            Contours(seed: 1.3).opacity(0.4)
        }
        .ignoresSafeArea()
    }
}

// MARK: - Intro pages before sign-in

struct IntroPagesView: View {
    var onDone: () -> Void
    @State private var page = 0
    private let pages: [(symbol: String, title: String, text: String)] = [
        ("book.closed.fill", "Your whole licence in one place", "Logbook, hours, progress and costs, set up for the rules where you train."),
        ("airplane", "Practise before you pay for the hour", "Fly circuits and approaches at your own airfield, and rehearse your radio calls out loud."),
        ("checkmark.seal.fill", "Walk into your checkride ready", "A mock checkride that questions you like a real examiner, friendly or strict.")
    ]

    var body: some View {
        ZStack {
            NightBackdrop()
            VStack(spacing: 0) {
                HStack {
                    Spacer()
                    Button("Skip") { onDone() }
                        .font(.archivo(15, .medium))
                        .foregroundStyle(Theme.mist)
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)
                TabView(selection: $page) {
                    ForEach(pages.indices, id: \.self) { i in
                        IntroPage(symbol: pages[i].symbol, title: pages[i].title, text: pages[i].text).tag(i)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                HStack(spacing: 7) {
                    ForEach(pages.indices, id: \.self) { i in
                        Capsule().fill(i == page ? Color.white : Theme.ice.opacity(0.3))
                            .frame(width: i == page ? 24 : 8, height: 8)
                    }
                }
                .animation(.spring(response: 0.35, dampingFraction: 0.8), value: page)
                .padding(.bottom, 22)
                Button {
                    if page < pages.count - 1 { withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { page += 1 } } else { onDone() }
                } label: {
                    Text(page < pages.count - 1 ? "Continue" : "Get started")
                }
                .primaryStyle()
                .padding(.horizontal, 24)
                .padding(.bottom, 12)
            }
        }
        .sensoryFeedback(.selection, trigger: page)
    }
}

private struct IntroPage: View {
    let symbol: String, title: String, text: String
    @State private var glow = false
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()
            ZStack {
                Circle()
                    .fill(RadialGradient(colors: [Theme.electricHi.opacity(0.55), .clear], center: .center, startRadius: 0, endRadius: 140))
                    .frame(width: 280, height: 280)
                    .scaleEffect(glow ? 1.12 : 0.94)
                    .opacity(glow ? 0.75 : 1)
                RoundedRectangle(cornerRadius: 44, style: .continuous)
                    .fill(LinearGradient(colors: [Theme.electricHi, Color(hex: 0x0A3FB8)], startPoint: .topLeading, endPoint: .bottomTrailing))
                    .frame(width: 150, height: 150)
                    .shadow(color: Theme.electric.opacity(0.5), radius: 35, y: 20)
                Image(systemName: symbol)
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(.white)
                    .symbolEffect(.bounce, value: glow)
            }
            .frame(maxWidth: .infinity)
            Spacer()
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(Theme.display(38))
                    .tracking(-1.2)
                    .foregroundStyle(.white)
                    .fixedSize(horizontal: false, vertical: true)
                Text(text)
                    .font(.archivo(17))
                    .foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.82))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.bottom, 28)
        }
        .padding(.horizontal, 24)
        .onAppear { withAnimation(.easeInOut(duration: 2).repeatForever(autoreverses: true)) { glow = true } }
    }
}

// MARK: - Setup, one question per screen

struct OnboardingFlow: View {
    @Environment(AppModel.self) private var model

    private static let paces: [(String, String)] = [
        ("Still deciding", "I’m still working it out"),
        ("Weekly", "About once a week"),
        ("Twice a week", "Two or more lessons a week"),
        ("Monthly", "A couple of times a month or less"),
        ("Intensive course", "Full-time, every day I can")
    ]
    private let total = 5

    @State private var step = 0
    @State private var forward = true
    @State private var name = ""
    @State private var countryList: [SetupView.Country] = []
    @State private var country = SetupView.Country(code: "US", name: "United States", regime: "faa", authority: "FAA")
    @State private var licence = SetupView.Licence(id: "Private Pilot", label: "Private Pilot certificate", hours: 40)
    @State private var airport = ""
    @State private var pace = "Still deciding"
    @State private var hoursSoFar = ""
    @State private var building = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            if building {
                BuildingDeskView(rows: buildRows)
                    .transition(.opacity)
            } else {
                questions
                    .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.3), value: building)
        .onAppear(perform: prefill)
    }

    private var questions: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                Button { go(-1) } label: {
                    Image(systemName: "chevron.left").font(.system(size: 17, weight: .semibold)).foregroundStyle(Theme.ink)
                        .frame(width: 44, height: 44)
                        .background(Circle().fill(.white).shadow(color: Theme.ink.opacity(0.08), radius: 1, y: 1))
                }
                .opacity(step == 0 ? 0 : 1)
                .disabled(step == 0)
                .accessibilityLabel("Back")
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Theme.ink.opacity(0.08))
                        Capsule().fill(LinearGradient(colors: [Theme.electric, Theme.electricHi], startPoint: .leading, endPoint: .trailing))
                            .frame(width: g.size.width * CGFloat(step + 1) / CGFloat(total))
                    }
                }
                .frame(height: 6)
                .animation(.spring(response: 0.45, dampingFraction: 0.85), value: step)
                .accessibilityLabel("Step \(step + 1) of \(total)")
                Button("Sign out") { Task { await model.signOut() } }
                    .font(.archivo(14)).foregroundStyle(Theme.ink3)
            }
            .padding(.horizontal, 18)
            .padding(.top, 8)

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("\(step + 1) of \(total)").font(.archivo(13, .semibold)).foregroundStyle(Theme.electric)
                    Text(titles.0).font(Theme.display(36)).tracking(-1.2).foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(titles.1).font(.archivo(16.5)).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    stepFields.padding(.top, 10)
                    if let error { Text(error).font(.archivo(14)).foregroundStyle(Theme.danger) }
                }
                .padding(.horizontal, 22)
                .padding(.top, 36)
                .padding(.bottom, 24)
                .id(step)
                .transition(.asymmetric(insertion: .move(edge: forward ? .trailing : .leading).combined(with: .opacity),
                                        removal: .move(edge: forward ? .leading : .trailing).combined(with: .opacity)))
            }
            .scrollDismissesKeyboard(.interactively)

            VStack(spacing: 6) {
                Button { go(1) } label: { Text(step == total - 1 ? "Build my flight desk" : "Continue") }
                    .primaryStyle()
                    .disabled(!canContinue)
                if step == 4 {
                    Button("I’m just starting") { hoursSoFar = ""; go(1) }
                        .font(.archivo(15)).foregroundStyle(Theme.ink3)
                        .frame(height: 40)
                }
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 12)
        }
        .background(Theme.cloud.ignoresSafeArea())
        .sensoryFeedback(.selection, trigger: pace)
        .sensoryFeedback(.selection, trigger: licence)
    }

    private var titles: (String, String) {
        switch step {
        case 0: return ("What should we call you?", "This is how Boplo greets you. Nobody else sees it unless you share.")
        case 1: return ("Where are you learning to fly?", "Rules, minimum hours and weather all depend on where you train.")
        case 2: return ("What are you working toward?", "Boplo tracks your hours against this. Your school decides when you’re ready.")
        case 3: return ("How often will you fly?", "Flying often is the biggest thing that keeps the total cost down.")
        default: return ("How many hours have you flown?", "Add the total from your logbook, or leave it empty if you’re just starting.")
        }
    }

    @ViewBuilder
    private var stepFields: some View {
        switch step {
        case 0:
            TextField("Your name", text: $name)
                .textContentType(.name)
                .font(.archivo(18))
                .boploField()
                .focused($focused)
                .submitLabel(.continue)
                .onSubmit { if canContinue { go(1) } }
                .onAppear { focused = true }
        case 1:
            VStack(alignment: .leading, spacing: 12) {
                Menu {
                    Picker("Country", selection: $country) {
                        ForEach(countryList) { Text($0.name).tag($0) }
                    }
                } label: {
                    HStack {
                        Text(country.name).font(.archivo(17)).foregroundStyle(Theme.ink).lineLimit(1)
                        Spacer()
                        Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3)
                    }
                    .boploField()
                }
                .onChange(of: country) { _, value in licence = SetupView.licences(for: value.regime)[0] }
                Text("Licensing authority: \(country.authority)").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                TextField("Home airfield, e.g. KSEE (optional)", text: $airport)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .font(.archivo(17))
                    .boploField()
            }
        case 2:
            VStack(spacing: 10) {
                ForEach(SetupView.licences(for: country.regime), id: \.self) { l in
                    ChoiceCard(title: l.label, detail: l.hours > 0 ? "Published minimum: \(l.hours) hours" : nil, selected: l == licence) { licence = l }
                }
            }
        case 3:
            VStack(spacing: 10) {
                ForEach(Self.paces, id: \.0) { p in
                    ChoiceCard(title: p.0, detail: p.1, selected: pace == p.0) { pace = p.0 }
                }
            }
        default:
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                TextField("0", text: $hoursSoFar)
                    .keyboardType(.decimalPad)
                    .font(Theme.display(44))
                    .focused($focused)
                Text("hours").font(.archivo(18, .medium)).foregroundStyle(Theme.ink3)
            }
            .boploField()
        }
    }

    private var canContinue: Bool {
        step != 0 || !name.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private var buildRows: [String] {
        let opening = Double(hoursSoFar.replacingOccurrences(of: ",", with: ".")) ?? 0
        let field = airport.trimmingCharacters(in: .whitespaces).uppercased()
        return [
            "Your \(licence.label) route",
            "\(licence.hours > 0 ? licence.hours : 45) h goal and progress",
            field.isEmpty ? "Live weather at any airport" : "Live weather for \(field)",
            opening > 0 ? "Logbook with \(opening.formatted(.number.precision(.fractionLength(0...1)))) h carried over" : "Your logbook",
            "Lesson prep and mock checkride"
        ]
    }

    private func go(_ delta: Int) {
        focused = false
        error = nil
        if delta > 0 && step == total - 1 { Task { await finish() }; return }
        forward = delta > 0
        withAnimation(.spring(response: 0.42, dampingFraction: 0.88)) { step = max(0, min(total - 1, step + delta)) }
    }

    private func prefill() {
        if name.isEmpty { name = model.profile?.name ?? model.workspace?.user.display_name ?? "" }
        guard countryList.isEmpty else { return }
        countryList = SetupView.countries
        let region = Locale.current.region?.identifier ?? "US"
        if let c = countryList.first(where: { $0.code == region }) { country = c; licence = SetupView.licences(for: c.regime)[0] }
    }

    private func finish() async {
        building = true
        // The building moment plays fully, then the profile is saved and the app moves on to the trial.
        try? await Task.sleep(for: .seconds(UIAccessibility.isReduceMotionEnabled ? 0.6 : 2.9))
        let opening = Int(((Double(hoursSoFar.replacingOccurrences(of: ",", with: ".")) ?? 0) * 60).rounded())
        do {
            try await model.saveProfile([
                "name": name.trimmingCharacters(in: .whitespaces),
                "country": country.name,
                "countryCode": country.code,
                "regime": country.regime,
                "authority": country.authority,
                "licence": licence.id,
                "goalHours": licence.hours > 0 ? licence.hours : 45,
                "airport": airport.trimmingCharacters(in: .whitespaces).uppercased(),
                "frequency": pace,
                "openingMinutes": max(0, opening),
                "complete": true,
                "step": 7
            ])
        } catch {
            self.error = error.localizedDescription
            building = false
        }
    }
}

private struct ChoiceCard: View {
    let title: String
    let detail: String?
    let selected: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.archivo(16.5, .semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
                    if let detail { Text(detail).font(.archivo(13.5)).foregroundStyle(Theme.ink3).multilineTextAlignment(.leading) }
                }
                Spacer(minLength: 0)
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundStyle(selected ? Theme.electric : Theme.ink3.opacity(0.5))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 15)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(selected ? Color(hex: 0xF6F9FF) : .white)
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(selected ? Theme.electric : Theme.hair, lineWidth: selected ? 2 : 1))
            )
            .shadow(color: selected ? Theme.electric.opacity(0.12) : .clear, radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.3, dampingFraction: 0.8), value: selected)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Between the last question and the trial: shows what the answers turned into.
struct BuildingDeskView: View {
    let rows: [String]
    @State private var shown = 0
    @State private var ring: CGFloat = 0

    var body: some View {
        ZStack {
            NightBackdrop()
            VStack(spacing: 24) {
                ZStack {
                    Circle().stroke(Theme.ice.opacity(0.15), lineWidth: 5)
                    Circle().trim(from: 0, to: ring)
                        .stroke(Theme.electricHi, style: StrokeStyle(lineWidth: 5, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .shadow(color: Theme.electricHi.opacity(0.8), radius: 8)
                    Image(systemName: "airplane").font(.system(size: 38, weight: .semibold)).foregroundStyle(.white)
                }
                .frame(width: 120, height: 120)
                Text("Building your flight desk").font(Theme.display(30)).foregroundStyle(.white)
                VStack(spacing: 12) {
                    ForEach(rows.indices, id: \.self) { i in
                        HStack(spacing: 12) {
                            Image(systemName: "checkmark.circle.fill").foregroundStyle(Color(hex: 0x4DD49A)).font(.system(size: 20))
                            Text(rows[i]).font(.archivo(15.5)).foregroundStyle(.white)
                            Spacer(minLength: 0)
                        }
                        .padding(.horizontal, 16).padding(.vertical, 13)
                        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(.white.opacity(0.06))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.ice.opacity(0.14))))
                        .opacity(i < shown ? 1 : 0)
                        .offset(y: i < shown ? 0 : 8)
                    }
                }
            }
            .padding(24)
            .frame(maxWidth: 440)
        }
        .sensoryFeedback(.impact(weight: .light), trigger: shown)
        .task {
            withAnimation(.easeInOut(duration: 2.6)) { ring = 1 }
            for i in 1...rows.count {
                try? await Task.sleep(for: .seconds(0.42))
                withAnimation(.spring(response: 0.4, dampingFraction: 0.85)) { shown = i }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The 3-day trial: the app's entry ticket

struct TrialGateView: View {
    @Environment(AppModel.self) private var model
    @Environment(StoreModel.self) private var store
    @State private var yearly = true
    @State private var trialDays = 0
    @State private var eligible = true
    @State private var loading = true
    var onSkip: () -> Void = {}

    private var selected: Product? { yearly ? store.yearly : store.monthly }
    private var trial: Bool { trialDays > 0 && eligible }

    var body: some View {
        ZStack {
            NightBackdrop()
            VStack(spacing: 0) {
                HStack {
                    Button("Restore") { Task { await store.restore() } }
                    Spacer()
                    Button("Sign out") { Task { await model.signOut() } }
                }
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
                .padding(.horizontal, 22).padding(.top, 6)

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        Text("Boplo Advanced")
                            .font(.archivo(13, .semibold)).foregroundStyle(Color(hex: 0xBFD6FF))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .background(Capsule().fill(Theme.electricHi.opacity(0.2)).overlay(Capsule().strokeBorder(Theme.ice.opacity(0.25))))
                        Text(headline).font(Theme.display(36)).tracking(-1.2).foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        VStack(alignment: .leading, spacing: 12) {
                            feature("book.closed", "Unlimited logbook, progress and cost forecast")
                            feature("checkmark.seal", "Mock checkride and Ask Boplo study assistant")
                            feature("airplane", "Unlimited simulator at your own airfield")
                            feature("dot.radiowaves.left.and.right", "Radio practice with every call checked")
                            feature("graduationcap", "Study by subject and timed mock exams")
                        }
                        if trial, let p = selected { timeline(p) }
                        plans
                    }
                    .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 20)
                }

                VStack(spacing: 10) {
                    if let p = selected {
                        Button { Task { await store.buy(p) } } label: {
                            HStack(spacing: 8) {
                                if store.busy { ProgressView().tint(Theme.ink) }
                                Text(trial ? "Start my \(trialDays)-day free trial" : "Continue for \(p.displayPrice)")
                            }
                            .font(.archivo(17, .semibold))
                            .foregroundStyle(Theme.ink)
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .background(Capsule().fill(.white))
                            .shadow(color: Theme.electricHi.opacity(0.45), radius: 20, y: 8)
                        }
                        .buttonStyle(.plain)
                        .disabled(store.busy)
                        Text(fine(p)).font(.archivo(11.5)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.6)).multilineTextAlignment(.center)
                    } else if loading {
                        ProgressView().tint(.white)
                    } else {
                        // The App Store sent no plans (offline, or the store is unavailable): never leave someone stuck here.
                        Text("Plans couldn’t load from the App Store right now.").font(.archivo(14)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.8))
                        Button("Try again") { Task { loading = true; await store.loadProducts(); await loadTrial(); loading = false } }
                            .font(.archivo(15, .semibold)).foregroundStyle(.white)
                        Button { onSkip() } label: {
                            Text("Continue with the free plan")
                                .font(.archivo(17, .semibold)).foregroundStyle(Theme.ink)
                                .frame(maxWidth: .infinity, minHeight: 52)
                                .background(Capsule().fill(.white))
                        }
                        .buttonStyle(.plain)
                    }
                    if let m = store.message { Text(m).font(.archivo(13.5)).foregroundStyle(Color(hex: 0xFF9BA6)).multilineTextAlignment(.center) }
                    HStack(spacing: 18) {
                        Link("Terms of Use", destination: URL(string: "https://boplo.app/terms.html")!)
                        Link("Privacy policy", destination: URL(string: "https://boplo.app/privacy.html")!)
                    }
                    .font(.archivo(12.5)).foregroundStyle(Color(hex: 0xBFD6FF))
                }
                .padding(.horizontal, 22).padding(.top, 10).padding(.bottom, 8)
            }
        }
        .task(id: yearly) { await loadTrial() }
        .task {
            if store.products.isEmpty { await store.loadProducts() }
            await loadTrial()
            loading = false
        }
        .sensoryFeedback(.selection, trigger: yearly)
    }

    private var headline: String {
        let first = (model.profile?.name ?? "").split(separator: " ").first.map(String.init) ?? ""
        if trial { return first.isEmpty ? "Try everything free for \(trialDays) days" : "\(first), try everything free for \(trialDays) days" }
        return "Unlock your full flight desk"
    }

    private func feature(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 12) {
            Image(systemName: symbol).font(.system(size: 17, weight: .semibold)).foregroundStyle(Color(hex: 0x7FB0FF)).frame(width: 24)
            Text(text).font(.archivo(16)).foregroundStyle(.white)
        }
    }

    private func timeline(_ p: Product) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            row("Today", "Everything unlocks. No charge.")
            row("Before day \(trialDays)", "Cancel any time in Settings → Subscriptions and you pay nothing.")
            row("Day \(trialDays)", "Your plan starts at \(p.displayPrice) \(yearly ? "a year" : "a month").")
        }
        .padding(16)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(.white.opacity(0.05))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.ice.opacity(0.14))))
    }

    private func row(_ when: String, _ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(when).font(.archivo(14.5, .semibold)).foregroundStyle(.white).frame(width: 96, alignment: .leading)
            Text(text).font(.archivo(14.5)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.78)).fixedSize(horizontal: false, vertical: true)
        }
    }

    private var plans: some View {
        HStack(spacing: 10) {
            if let y = store.yearly {
                planCard(title: "Yearly", price: "\(y.displayPrice) a year", sub: "\((y.price / 12).formatted(y.priceFormatStyle))/mo", badge: saving.map { "Save \($0)%" }, on: yearly) { yearly = true }
            }
            if let m = store.monthly {
                planCard(title: "Monthly", price: "\(m.displayPrice) a month", sub: nil, badge: nil, on: !yearly) { yearly = false }
            }
        }
        .padding(.top, 8)
    }

    private var saving: Int? {
        guard let y = store.yearly, let m = store.monthly else { return nil }
        let yv = NSDecimalNumber(decimal: y.price).doubleValue, mv = NSDecimalNumber(decimal: m.price).doubleValue
        guard mv > 0 else { return nil }
        let s = Int(((1 - yv / (mv * 12)) * 100).rounded(.down))
        return s > 0 ? s : nil
    }

    private func planCard(title: String, price: String, sub: String?, badge: String?, on: Bool, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.archivo(16.5, .semibold)).foregroundStyle(.white)
                Text(price).font(.archivo(13)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.75))
                if let sub { Text(sub).font(.archivo(13)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.75)) }
            }
            .frame(maxWidth: .infinity, minHeight: 72, alignment: .leading)
            .padding(14)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(on ? Theme.electricHi.opacity(0.2) : .white.opacity(0.05))
                .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? Color(hex: 0x4D8DFF) : Theme.ice.opacity(0.2), lineWidth: on ? 2 : 1)))
            .overlay(alignment: .topTrailing) {
                if let badge {
                    Text(badge).font(.archivo(11.5, .bold)).foregroundStyle(Color(hex: 0x002222))
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Capsule().fill(Color(hex: 0x4DD49A)))
                        .offset(x: -8, y: -10)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func fine(_ p: Product) -> String {
        let per = yearly ? "per year" : "per month"
        let lead = trial ? "\(trialDays) days free, then \(p.displayPrice) \(per). Payment is charged to your Apple ID when the trial ends. " : "\(p.displayPrice) \(per), charged to your Apple ID. "
        return lead + "The subscription renews automatically unless you cancel at least 24 hours before the end of the current period. Manage it in Settings → Apple ID → Subscriptions."
    }

    private func loadTrial() async {
        guard let p = selected, let sub = p.subscription else { trialDays = 0; return }
        eligible = await sub.isEligibleForIntroOffer
        if let offer = sub.introductoryOffer, offer.paymentMode == .freeTrial {
            let v = offer.period.value
            switch offer.period.unit {
            case .day: trialDays = v
            case .week: trialDays = v * 7
            case .month: trialDays = v * 30
            case .year: trialDays = v * 365
            @unknown default: trialDays = v
            }
        } else {
            trialDays = 0
        }
    }
}

// MARK: - App Store rating

/// Apple's own rating sheet, asked on app open once someone has settled in (4 opens over 2+ days),
/// at most every 4 months. Apple decides whether it actually shows: at most 3 times a year, and never
/// once the user has turned it off. Apps can't see whether someone has already rated.
enum ReviewAsk {
    @MainActor
    static func maybe(_ request: RequestReviewAction) async {
        let d = UserDefaults.standard, now = Date().timeIntervalSince1970
        if d.double(forKey: "boplo.firstOpen") == 0 { d.set(now, forKey: "boplo.firstOpen") }
        let opens = d.integer(forKey: "boplo.opens") + 1
        d.set(opens, forKey: "boplo.opens")
        let first = d.double(forKey: "boplo.firstOpen"), last = d.double(forKey: "boplo.reviewAsked")
        guard opens >= 4, now - first >= 2 * 86_400, now - last >= 120 * 86_400 else { return }
        try? await Task.sleep(for: .seconds(3.5))
        d.set(Date().timeIntervalSince1970, forKey: "boplo.reviewAsked")
        request()
    }
}
