import SwiftUI
import StoreKit

// Shared first-run pieces: the night backdrop, choice cards, "building your desk" and the 3-day trial.
// The questions themselves are in FirstRun.swift. The iPhone app needs Advanced (free trial or subscription).

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

struct ChoiceCard: View {
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

    var body: some View { screenBody.screen("building_desk") }
    @ViewBuilder private var screenBody: some View {
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

    var body: some View { screenBody.screen("trial_gate") }
    @ViewBuilder private var screenBody: some View {
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
                    VStack(alignment: .leading, spacing: 18) {
                        Text(headline).font(Theme.display(34)).tracking(-1.1).foregroundStyle(.white)
                            .fixedSize(horizontal: false, vertical: true)
                        planReady
                        VStack(alignment: .leading, spacing: 11) {
                            feature("checkmark.seal.fill", "Mock checkride that grills you like an examiner")
                            feature("airplane", "Unlimited simulator at your own airfield")
                            feature("dot.radiowaves.left.and.right", "Radio practice with every call checked")
                            feature("graduationcap.fill", "Study by subject and timed mock exams")
                            feature("book.closed.fill", "Unlimited logbook, progress and cost forecast")
                        }
                        if let wb = store.winBack { winBackCard(wb) }
                        plans
                        if trial, let p = selected { timeline(p) }
                    }
                    .padding(.horizontal, 22).padding(.top, 14).padding(.bottom, 20)
                }

                VStack(spacing: 10) {
                    if let p = selected {
                        Button { Task { await store.buy(p, from: "trial_gate") } } label: {
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
                        if trial {
                            Label("No payment due today · Cancel anytime", systemImage: "checkmark.shield.fill")
                                .font(.archivo(13.5, .semibold)).foregroundStyle(Color(hex: 0x4DD49A))
                        }
                        Text(fine(p)).font(.archivo(11.5)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.6)).multilineTextAlignment(.center)
                    } else if loading {
                        ProgressView().tint(.white)
                    } else {
                        // The App Store sent no plans (offline, or the store is unavailable): never leave someone stuck here.
                        Text("Plans couldn’t load from the App Store right now.").font(.archivo(14)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.8))
                        Button("Try again") { Task { loading = true; await store.loadProducts(); await loadTrial(); loading = false } }
                            .font(.archivo(15, .semibold)).foregroundStyle(.white)
                        Button { Track.event("trial_gate_skip"); onSkip() } label: {
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
        let who = first.isEmpty ? "" : "\(first), "
        if trial { return "\(who)your plan is ready. Try it free for \(trialDays) days." }
        return "\(who)your plan is ready. Unlock your full flight desk."
    }

    /// The plan from setup, so the trial reads as the next step of their plan rather than a toll.
    private var planReady: some View {
        let a = FirstRun.answers(from: model.profile)
        let p = FirstRun.plan(a)
        let licence = String(a.licence.label.split(separator: "·").first ?? "Licence").trimmingCharacters(in: .whitespaces)
        let chips: [(String, String)] = [
            ("flag.checkered", "\(licence) by \(p.finish.formatted(.dateTime.month(.abbreviated).year()))"),
            ("clock", "\(Int(p.toGo.rounded())) h to go"),
            ("calendar", FirstRun.paces.first { $0.id == a.pace }?.label ?? "Weekly")
        ]
        return VStack(alignment: .leading, spacing: 10) {
            Label("Built from your answers", systemImage: "sparkles")
                .font(.archivo(13.5, .semibold)).foregroundStyle(Color(hex: 0xBFD6FF))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(chips, id: \.1) { c in
                        Label(c.1, systemImage: c.0)
                            .font(.archivo(13, .medium)).foregroundStyle(.white).lineLimit(1)
                            .padding(.horizontal, 10).padding(.vertical, 7)
                            .background(Capsule().fill(.white.opacity(0.08)).overlay(Capsule().strokeBorder(Theme.ice.opacity(0.18))))
                    }
                }
            }
        }
    }

    private func winBackCard(_ wb: StoreModel.WinBack) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Welcome back").font(.archivo(13, .semibold)).foregroundStyle(Color(hex: 0x4DD49A))
            Text(wb.line).font(Theme.display(24)).tracking(-0.6).foregroundStyle(.white)
            Text("A returning-pilot offer on Advanced \(StoreModel.yearlyIDs.contains(wb.product.id) ? "yearly" : "monthly"). It renews at \(wb.product.displayPrice) afterwards; cancel any time in Settings.")
                .font(.archivo(13)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.75)).fixedSize(horizontal: false, vertical: true)
            Button { Task { await store.buyWinBack() } } label: {
                Text("Claim the offer").font(.archivo(17, .semibold)).foregroundStyle(Theme.ink)
                    .frame(maxWidth: .infinity, minHeight: 50).background(Capsule().fill(.white))
            }
            .buttonStyle(.plain).disabled(store.busy)
        }
        .padding(18)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(.white.opacity(0.08)))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color(hex: 0x4DD49A).opacity(0.5), lineWidth: 1))
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
        VStack(spacing: 10) {
            if let y = store.yearly {
                planRow(title: "Yearly", main: "\((y.price / 12).formatted(y.priceFormatStyle))/mo", sub: "\(y.displayPrice) billed yearly", badge: saving.map { "Best value · Save \($0)%" } ?? "Best value", on: yearly) { yearly = true }
            }
            if let m = store.monthly {
                planRow(title: "Monthly", main: "\(m.displayPrice)/mo", sub: "\(m.displayPrice) billed monthly", badge: nil, on: !yearly) { yearly = false }
            }
        }
        .padding(.top, 4)
    }

    private var saving: Int? {
        guard let y = store.yearly, let m = store.monthly else { return nil }
        let yv = NSDecimalNumber(decimal: y.price).doubleValue, mv = NSDecimalNumber(decimal: m.price).doubleValue
        guard mv > 0 else { return nil }
        let s = Int(((1 - yv / (mv * 12)) * 100).rounded(.down))
        return s > 0 ? s : nil
    }

    private func planRow(title: String, main: String, sub: String, badge: String?, on: Bool, tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 14) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 24)).foregroundStyle(on ? Color(hex: 0x4D8DFF) : Theme.ice.opacity(0.4))
                VStack(alignment: .leading, spacing: 3) {
                    Text(title).font(.archivo(17, .semibold)).foregroundStyle(.white)
                    Text(trial ? "\(trialDays) days free, then \(sub.lowercased())" : sub)
                        .font(.archivo(13)).foregroundStyle(Color(hex: 0xDEE9FF).opacity(0.72))
                }
                Spacer(minLength: 0)
                Text(main).font(.archivo(17, .semibold)).foregroundStyle(.white)
            }
            .padding(.horizontal, 16).padding(.vertical, 16)
            .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(on ? Theme.electricHi.opacity(0.2) : .white.opacity(0.05))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(on ? Color(hex: 0x4D8DFF) : Theme.ice.opacity(0.2), lineWidth: on ? 2 : 1)))
            .overlay(alignment: .topTrailing) {
                if let badge {
                    Text(badge).font(.archivo(11.5, .bold)).foregroundStyle(Color(hex: 0x002222))
                        .padding(.horizontal, 9).padding(.vertical, 3)
                        .background(Capsule().fill(Color(hex: 0x4DD49A)))
                        .offset(x: -12, y: -10)
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

/// Apple's own rating sheet, asked right after a win (a flight logged, a quiz passed) once someone has
/// used the app on 2+ opens across at least a day, and at most every 4 months. Apple decides whether it
/// actually shows: at most 3 times a year, never once the user turned it off. Apps can't see whether
/// someone has already rated.
enum ReviewAsk {
    /// Called on app open: only counts opens, never asks.
    @MainActor
    static func noteOpen() {
        let d = UserDefaults.standard
        if d.double(forKey: "boplo.firstOpen") == 0 { d.set(Date().timeIntervalSince1970, forKey: "boplo.firstOpen") }
        d.set(d.integer(forKey: "boplo.opens") + 1, forKey: "boplo.opens")
    }

    /// Called at a good moment. Waits so the win can land first, then asks if the user is settled in.
    @MainActor
    static func afterWin(_ request: RequestReviewAction, delay: Double = 1.5) async {
        let d = UserDefaults.standard, now = Date().timeIntervalSince1970
        let first = d.double(forKey: "boplo.firstOpen"), last = d.double(forKey: "boplo.reviewAsked")
        guard first > 0, d.integer(forKey: "boplo.opens") >= 2, now - first >= 86_400, now - last >= 120 * 86_400 else { return }
        try? await Task.sleep(for: .seconds(delay))
        d.set(Date().timeIntervalSince1970, forKey: "boplo.reviewAsked")
        request()
    }
}
