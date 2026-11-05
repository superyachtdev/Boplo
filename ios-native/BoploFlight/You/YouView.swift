import SwiftUI
import StoreKit

struct YouView: View {
    @Environment(AppModel.self) private var model
    @State private var showPlans = false
    @State private var confirmSignOut = false
    @State private var confirmDelete = false
    @State private var deleteError: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(model.profile?.name ?? "Pilot").font(.title3.bold())
                        Text(model.workspace?.user.email ?? "").font(.subheadline).foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                Section("Training") {
                    LabeledContent("Licence", value: model.profile?.licence ?? "—")
                    LabeledContent("Authority", value: model.profile?.authority ?? "—")
                    LabeledContent("Home airfield", value: (model.profile?.airport).flatMap { $0.isEmpty ? nil : $0 } ?? "—")
                    LabeledContent("Hours goal", value: "\(Int(model.profile?.goalHours ?? 0)) h")
                }
                Section("Plan") {
                    LabeledContent("Current plan", value: planLabel)
                    if !model.isAdvanced {
                        Button("See Advanced") { showPlans = true }
                    } else if model.billing?.status == "active", model.billing?.school == nil, model.billing?.owner != true {
                        Button("Manage subscription") {
                            Task {
                                if let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                                    try? await AppStore.showManageSubscriptions(in: scene)
                                }
                            }
                        }
                    }
                }
                Section("Boplo") {
                    Link("Open boplo.app", destination: URL(string: "https://boplo.app/flight-app.html")!)
                    Link("Privacy policy", destination: URL(string: "https://boplo.app/privacy.html")!)
                    Link("Terms", destination: URL(string: "https://boplo.app/terms.html")!)
                    Link("Contact support", destination: URL(string: "mailto:support@boplo.app")!)
                }
                Section {
                    Button("Sign out") { confirmSignOut = true }
                    Button("Delete account", role: .destructive) { confirmDelete = true }
                    ErrorText(text: deleteError)
                } footer: {
                    Text("Deleting removes your profile, logbook and settings from Boplo. An App Store subscription is cancelled in your Apple ID settings.")
                }
            }
            .navigationTitle("You")
            .refreshable { await model.refresh() }
            .sheet(isPresented: $showPlans) { PlansView() }
            .confirmationDialog("Sign out of Boplo?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) { Task { await model.signOut() } }
            }
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

    private var planLabel: String {
        guard let b = model.billing else { return "Free" }
        if b.owner == true { return "Advanced (owner)" }
        if let school = b.school?.name { return "Advanced via \(school)" }
        return b.isAdvanced ? "Advanced" : "Free"
    }
}

/// The paywall: yearly first, monthly as an option, Restore purchases always visible.
struct PlansView: View {
    @Environment(StoreModel.self) private var store
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    private let perks = [
        ("infinity", "Unlimited logbook, with CSV import"),
        ("airplane", "Unlimited simulator practice"),
        ("book", "Full study bank and mock exams"),
        ("questionmark.bubble", "Ask Boplo, your training assistant"),
        ("map", "Nav logs, currency and expiry tracking")
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text("Boplo Advanced").font(Theme.display(32))
                    Text("Everything in Free, plus:").foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(perks.indices, id: \.self) { i in
                            Label(perks[i].1, systemImage: perks[i].0)
                        }
                    }
                    if store.products.isEmpty {
                        Text("Plans aren’t available right now. Try again shortly.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                    if let yearly = store.yearly {
                        planButton(yearly, title: "Yearly", detail: "\(yearly.displayPrice) a year", prominent: true)
                    }
                    if let monthly = store.monthly {
                        planButton(monthly, title: "Monthly", detail: "\(monthly.displayPrice) a month", prominent: false)
                    }
                    ErrorText(text: store.message)
                    Button("Restore purchases") { Task { await store.restore() } }
                        .frame(maxWidth: .infinity)
                    Text("Subscriptions renew automatically until cancelled in your Apple ID settings, at least 24 hours before the period ends. [Terms](https://boplo.app/terms.html) · [Privacy](https://boplo.app/privacy.html)")
                        .font(.caption2).foregroundStyle(.secondary)
                }
                .padding(20)
            }
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .onChange(of: model.isAdvanced) { _, advanced in if advanced { dismiss() } }
        }
    }

    private func planButton(_ product: Product, title: String, detail: String, prominent: Bool) -> some View {
        Button { Task { await store.buy(product) } } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline)
                    Text(detail).font(.subheadline).opacity(0.85)
                }
                Spacer()
                if store.busy { ProgressView() } else { Image(systemName: "chevron.right") }
            }
            .padding(16)
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .tint(prominent ? Theme.electric : Theme.ink.opacity(0.75))
        .disabled(store.busy)
    }
}
