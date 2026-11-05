import SwiftUI
import StoreKit

/// You tab: account, plan, school, community, and the legal links.
struct YouView: View {
    @Environment(AppModel.self) private var model
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deleteError: String?

    var body: some View {
        NavigationStack {
            Page(title: "Account", subtitle: model.workspace?.user.email.map { "Signed in as \($0)" }) {
                HStack(spacing: 14) {
                    Text(initials)
                        .font(.archivo(17, .semibold))
                        .foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(LinearGradient(colors: [Theme.electricHi, Theme.electric], startPoint: .top, endPoint: .bottom), in: Circle())
                    VStack(alignment: .leading, spacing: 4) {
                        Text(model.profile?.name ?? "Pilot").font(.archivo(18, .semibold))
                        HStack(spacing: 6) {
                            Chip(text: planLabel, tone: model.isAdvanced ? .blue : .plain)
                            Text([model.profile?.licence, model.profile?.authority].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                                .font(.archivo(13)).foregroundStyle(Theme.ink3).lineLimit(1)
                        }
                    }
                }
                .padding(.vertical, 4)

                group {
                    NavigationLink(value: Route.profile) { MenuRow(icon: "person", title: "Profile", subtitle: "Licence, aircraft, rates and your data") }
                    divider
                    NavigationLink(value: Route.plan) { MenuRow(icon: "star", title: "Plan & billing", subtitle: model.isAdvanced ? "Your plan and renewal" : "Upgrade to Advanced") }
                    divider
                    NavigationLink(value: Route.web(.school)) { MenuRow(icon: "graduationcap", title: "Flight school", subtitle: model.billing?.school?.name ?? "Join your school with its code, or set up your school") }
                    divider
                    NavigationLink(value: Route.appIcon) { MenuRow(icon: "app.badge", title: "App icon", subtitle: "Night runway, dawn or cloud") }
                }
                group {
                    NavigationLink(value: Route.web(.community)) { MenuRow(icon: WebFeature.community.icon, title: WebFeature.community.title, subtitle: WebFeature.community.subtitle) }
                    divider
                    NavigationLink(value: Route.web(.leaderboards)) { MenuRow(icon: WebFeature.leaderboards.icon, title: WebFeature.leaderboards.title, subtitle: WebFeature.leaderboards.subtitle) }
                }
                group {
                    linkRow("Terms", "https://boplo.app/terms.html")
                    divider
                    linkRow("Privacy", "https://boplo.app/privacy.html")
                    divider
                    linkRow("Refunds", "https://boplo.app/refunds.html")
                    divider
                    linkRow("Contact support", "mailto:support@boplo.app")
                }
                group {
                    Button { confirmSignOut = true } label: { plainRow("Sign out", color: Theme.ink) }
                        // Attached to the row itself, so on iOS 26 the dialog grows out of this button, not the top of the page.
                        .confirmationDialog("Sign out of Boplo?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
                        }
                    divider
                    Button { confirmDelete = true } label: { plainRow("Delete account", color: Theme.danger) }
                }
                ErrorText(text: deleteError)
                Footnote(text: "Deleting removes your profile, logbook and settings from Boplo. An App Store subscription is cancelled in your Apple ID settings.")
            }
            .refreshable { await model.refresh() }
            .logFlightButton(model)
            .boploDestinations()
            .alert("Delete your account?", isPresented: $confirmDelete) {
                Button("Delete", role: .destructive) {
                    Task {
                        do { try await model.deleteAccount() } catch { deleteError = error.localizedDescription }
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your logbook, profile and settings are deleted for good. This can’t be undone.")
            }
        }
    }

    private var initials: String {
        let parts = (model.profile?.name ?? "?").split(separator: " ").prefix(2)
        let s = parts.compactMap { $0.first.map(String.init) }.joined().uppercased()
        return s.isEmpty ? "?" : s
    }

    private var planLabel: String {
        guard let b = model.billing else { return "Free" }
        if b.owner == true { return "Advanced · owner" }
        if b.school?.name != nil { return "Advanced · school" }
        return b.isAdvanced ? "Advanced" : "Free"
    }

    private var divider: some View { Divider().overlay(Theme.hair).padding(.leading, 18) }

    private func group<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 0) { content() }
            .buttonStyle(.plain)
            .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous).strokeBorder(Theme.hair))
    }

    private func linkRow(_ title: String, _ url: String) -> some View {
        Link(destination: URL(string: url)!) {
            HStack {
                Text(title).font(.archivo(15.5)).foregroundStyle(Theme.ink)
                Spacer()
                Image(systemName: "arrow.up.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.mist)
            }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .contentShape(Rectangle())
        }
    }

    private func plainRow(_ title: String, color: Color) -> some View {
        HStack { Text(title).font(.archivo(15.5, .medium)).foregroundStyle(color); Spacer() }
            .padding(.horizontal, 18).padding(.vertical, 14)
            .contentShape(Rectangle())
    }
}

// MARK: - Plan

/// Plan & billing, pushed from You.
struct PlanView: View {
    @Environment(AppModel.self) private var model
    @Environment(StoreModel.self) private var store

    var body: some View {
        Page(title: "Plan", subtitle: model.isAdvanced ? "You’re on Advanced." : "You’re on the Free plan.") {
            if model.isAdvanced {
                DarkTile {
                    Text("Advanced").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
                    Text(model.billing?.owner == true ? "Owner access" : model.billing?.school?.name.map { "Through \($0)" } ?? "Every Boplo feature, unlocked.")
                        .font(Theme.display(30)).tracking(-0.8).fixedSize(horizontal: false, vertical: true)
                    if let s = model.billing?.status, model.billing?.school == nil, model.billing?.owner != true {
                        Text(model.billing?.cancelAtPeriodEnd == true ? "Cancelled. Advanced stays on until the end of this period." : s == "active" ? "Renews automatically \(model.billing?.interval == "monthly" ? "each month" : "each year")." : s.capitalized)
                            .font(.archivo(14.5)).foregroundStyle(Theme.mist)
                    }
                }
                if model.billing?.school == nil, model.billing?.owner != true {
                    Button("Manage subscription") {
                        Task {
                            if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
                                try? await AppStore.showManageSubscriptions(in: scene)
                            }
                        }
                    }
                    .buttonStyle(.pill(.line, height: 46))
                    Footnote(text: "Subscribed on the website? Manage it from boplo.app on the web.")
                }
                Tile {
                    TileHead("Included")
                    PerkList()
                }
            } else {
                PlansContent(message: nil)
            }
        }
    }
}

/// The paywall sheet: opened when a Free limit is reached or Advanced is tapped anywhere.
struct PlansView: View {
    var message: String?
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    PlansContent(message: message)
                }
                .padding(16)
            }
            .background(Theme.cloud.ignoresSafeArea())
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .onChange(of: model.isAdvanced) { _, advanced in if advanced { dismiss() } }
        }
    }
}

struct PerkList: View {
    static let perks: [(String, String, String)] = [
        ("sparkle", "Ask Boplo, 40 a day", "Your aviation study assistant, with answers from official sources and your own desk."),
        ("book.closed", "Unlimited logbook", "Every flight, debrief and track, with CSV import from other logbooks."),
        ("airplane", "Unlimited simulator practice", "Take-offs, circuits and approaches at any airfield. Free includes two short finals a day."),
        ("graduationcap", "Study and mock exams", "Practice by subject and timed mock exams with a pass mark."),
        ("point.topleft.down.to.point.bottomright.curvepath", "Nav logs", "Unlimited saved plans with headings, times and fuel for every leg."),
        ("calendar.badge.clock", "Currency and expiry", "Medical, rating and recency rules worked out from your logbook."),
        ("headphones", "Radio practice", "Speak your calls and get each element checked."),
        ("person.wave.2", "Mock checkride", "An AI examiner runs a practice oral exam and scores you.")
    ]
    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Self.perks, id: \.1) { icon, title, text in
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: icon).font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.electric).frame(width: 24)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title).font(.archivo(15, .semibold))
                        Text(text).font(.archivo(13.5)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }
}

/// Yearly first (the better deal), monthly as the alternative, Restore always visible.
struct PlansContent: View {
    var message: String?
    @Environment(StoreModel.self) private var store
    @Environment(AppModel.self) private var model
    @State private var interval = "yearly"

    var body: some View {
        DarkTile {
            Text("Advanced").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
            Text(message ?? "Everything you need from first lesson to checkride.")
                .font(Theme.display(30)).tracking(-0.8).fixedSize(horizontal: false, vertical: true)
            if let y = store.yearly {
                Text("\(y.displayPrice) a year\(monthlyEquivalent(y).map { ", about \($0) a month" } ?? "").")
                    .font(.archivo(15)).foregroundStyle(Theme.mist)
            }
        }
        Tile { PerkList() }
        if store.products.isEmpty {
            Tile {
                Text("Plans aren’t available right now.").font(.archivo(15.5, .semibold))
                Text("The App Store didn’t return Boplo’s plans. Check your connection and try again.").font(.archivo(14)).foregroundStyle(Theme.ink3)
                Button("Try again") { Task { await store.loadProducts() } }.buttonStyle(.pill(.line, height: 42))
            }
        } else {
            VStack(spacing: 10) {
                if let y = store.yearly { option(y, id: "yearly", title: "Yearly", price: "\(y.displayPrice) a year", badge: savingBadge) }
                if let m = store.monthly { option(m, id: "monthly", title: "Monthly", price: "\(m.displayPrice) a month", badge: nil) }
            }
            Button {
                if let p = interval == "yearly" ? store.yearly : store.monthly { Task { await store.buy(p) } }
            } label: {
                HStack { if store.busy { ProgressView().tint(.white) }; Text("Continue") }
            }
            .primaryStyle()
            .disabled(store.busy)
        }
        ErrorText(text: store.message)
        Button("Restore purchases") { Task { await store.restore() } }
            .font(.archivo(14.5, .semibold))
            .foregroundStyle(Theme.electric)
            .frame(maxWidth: .infinity)
        Text("Payment is charged to your Apple ID. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the period, in your Apple ID settings. [Terms](https://boplo.app/terms.html) · [Privacy](https://boplo.app/privacy.html)")
            .font(.archivo(12)).foregroundStyle(Theme.ink3).tint(Theme.electric)
    }

    private var savingBadge: String? {
        guard let y = store.yearly, let m = store.monthly else { return nil }
        let yearly = NSDecimalNumber(decimal: y.price).doubleValue, monthly = NSDecimalNumber(decimal: m.price).doubleValue * 12
        guard monthly > 0, yearly < monthly else { return nil }
        return "Save \(Int(((1 - yearly / monthly) * 100).rounded()))%"
    }

    private func monthlyEquivalent(_ p: Product) -> String? {
        let v = p.price / 12
        return v.formatted(p.priceFormatStyle)
    }

    private func option(_ p: Product, id: String, title: String, price: String, badge: String?) -> some View {
        let on = interval == id
        return Button { withAnimation(.snappy) { interval = id } } label: {
            HStack(spacing: 12) {
                Image(systemName: on ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 20)).foregroundStyle(on ? Theme.electric : Theme.mist)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.archivo(16, .semibold)).foregroundStyle(Theme.ink)
                    Text(price).font(.archivo(14)).foregroundStyle(Theme.ink3)
                }
                Spacer()
                if let badge { Chip(text: badge, tone: .ok) }
            }
            .padding(16)
            .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(on ? Theme.electric : Theme.hair, lineWidth: on ? 2 : 1))
        }
        .buttonStyle(.plain)
    }
}
