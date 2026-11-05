import Foundation
import Observation

/// The app's state: who is signed in and their desk (profile, flights, plan).
@MainActor
@Observable
final class AppModel {
    enum Phase { case loading, signedOut, setup, ready }

    var phase: Phase = .loading
    var workspace: Workspace?
    var lastError: String?

    /// The profile exactly as the server sent it. The server replaces the whole profile on save,
    /// so edits are merged into this and sent back complete, never as a partial record.
    private(set) var rawProfile: [String: Any] = [:]

    var profile: Profile? { workspace?.profile }
    var flights: [Flight] { workspace?.flights ?? [] }
    var billing: Billing? { workspace?.billing }
    var isAdvanced: Bool { billing?.isAdvanced == true }

    init() {
        NotificationCenter.default.addObserver(forName: .boploSignedOut, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.handleSignedOut() }
        }
    }

    func start() async {
        guard API.shared.hasSessionCookie else { phase = .signedOut; return }
        await refresh()
    }

    func refresh() async {
        do {
            let data = try await API.shared.send("flight/workspace")
            let ws = try JSONDecoder().decode(Workspace.self, from: data)
            let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
            rawProfile = (json["profile"] as? [String: Any]) ?? [:]
            workspace = ws
            lastError = nil
            phase = ws.profile?.isComplete == true ? .ready : .setup
        } catch let error as APIError where error.status == 401 {
            handleSignedOut()
        } catch {
            lastError = error.localizedDescription
            if workspace == nil { phase = .signedOut }
        }
    }

    /// Saves profile changes, keeping every field the app doesn't show.
    func saveProfile(_ changes: [String: Any]) async throws {
        var merged = rawProfile
        for (key, value) in changes { merged[key] = value }
        merged.removeValue(forKey: "shareOn")
        merged.removeValue(forKey: "calOn")
        try await API.shared.send("flight/profile", method: "PUT", body: merged)
        await refresh()
    }

    func signOut() async {
        _ = try? await API.shared.send("auth/auth/logout", method: "POST", body: [:])
        handleSignedOut()
    }

    func deleteAccount() async throws {
        try await API.shared.send("flight/account/delete", method: "POST", body: ["confirm": "DELETE"])
        handleSignedOut()
    }

    private func handleSignedOut() {
        API.shared.clearCookies()
        workspace = nil
        rawProfile = [:]
        phase = .signedOut
    }

    // MARK: - Totals for the desk

    var totalMinutes: Int {
        Int(profile?.openingMinutes ?? 0) + flights.reduce(0) { $0 + $1.mins }
    }

    var goalMinutes: Int { Int((profile?.goalHours ?? 0) * 60) }

    var progress: Double {
        guard goalMinutes > 0 else { return 0 }
        return min(1, Double(totalMinutes) / Double(goalMinutes))
    }

    func minutes(role: String) -> Int {
        flights.filter { ($0.role ?? "dual") == role }.reduce(0) { $0 + $1.mins }
    }

    var landings: Int { flights.reduce(0) { $0 + Int($1.landings ?? 0) } }
}
