import SwiftUI

/// The student's three trained stats, overall Pilot Rating, tier and rank, from GET /flight/stats.
struct PilotStats: Decodable, Equatable {
    struct Tier: Decodable, Equatable {
        struct Next: Decodable, Equatable { let name: String; let at: Int }
        let name: String
        let next: Next?
    }
    struct Current: Decodable, Equatable { let days: Int; let sortieToday: Bool; let sorties30: Int }
    struct Airport: Decodable, Equatable { let code: String; let rank: Int; let total: Int }
    let knowledge: Int
    let handling: Int
    let airmanship: Int
    let rating: Int
    let tier: Tier
    let current: Current
    let rank: Int
    let total: Int
    let top: Int
    let airport: Airport?
}

/// Loads the stats and remembers the last ones seen, so a change shows as "+2" next to the bar.
@MainActor @Observable
final class PilotStatsStore {
    static let shared = PilotStatsStore()
    private(set) var stats: PilotStats?
    /// Change since the stats were last shown, per key (knowledge, handling, airmanship, rating).
    private(set) var delta: [String: Int] = [:]
    private var loading = false
    private let snapKey = "boplo.stats.snapshot"

    func refresh() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        guard let s = try? await API.shared.get("flight/stats", as: PilotStats.self) else { return }
        let old = UserDefaults.standard.dictionary(forKey: snapKey) as? [String: Int]
        let now = ["knowledge": s.knowledge, "handling": s.handling, "airmanship": s.airmanship, "rating": s.rating]
        if let old {
            var d: [String: Int] = [:]
            for (k, v) in now { if let o = old[k], v != o { d[k] = v - o } }
            if !d.isEmpty { withAnimation(.snappy) { delta = d } }
        }
        UserDefaults.standard.set(now, forKey: snapKey)
        withAnimation(.snappy) { stats = s }
    }

    func clearDelta() { delta = [:] }
}

/// The stat rows in one place, so the card, the share image and the sortie result agree.
enum StatKind: String, CaseIterable, Identifiable {
    case knowledge, handling, airmanship
    var id: String { rawValue }
    var title: String { rawValue.capitalized }
    var short: String { ["knowledge": "KNW", "handling": "HDL", "airmanship": "AIR"][rawValue]! }
    var blurb: String {
        switch self {
        case .knowledge: return "Theory: study, mock exams, sortie questions"
        case .handling: return "Flying: logged flights and sim landings"
        case .airmanship: return "Judgement: go/no-go calls, preflight, radio"
        }
    }
    func value(_ s: PilotStats) -> Int {
        switch self { case .knowledge: return s.knowledge; case .handling: return s.handling; case .airmanship: return s.airmanship }
    }
}

/// The pilot card on the desk: rating, tier, rank, the three bars, and today's sortie.
struct PilotCard: View {
    @Environment(AppModel.self) private var model
    @State private var store = PilotStatsStore.shared
    @State private var sortie = false
    @State private var shareImage: Image?

    var body: some View {
        DarkTile(spacing: 16, seed: 5.1) {
            if let s = store.stats {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Pilot Rating").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ice)
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(s.rating)").font(Theme.display(64)).tracking(-2).monospacedDigit().contentTransition(.numericText())
                            if let d = store.delta["rating"] { DeltaTag(d: d) }
                        }
                        Text(s.tier.name).font(.archivo(17, .semibold))
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 4) {
                        Text("#\(s.rank)").font(.archivo(22, .semibold)).monospacedDigit()
                        Text("of \(s.total) Boplo pilots").font(.archivo(12)).foregroundStyle(Theme.mist)
                        if let ap = s.airport, ap.total > 1 {
                            Text("#\(ap.rank) at \(ap.code)").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ice).padding(.top, 4)
                        }
                    }
                }
                VStack(spacing: 12) {
                    ForEach(StatKind.allCases) { k in StatBar(kind: k, value: k.value(s), delta: store.delta[k.rawValue]) }
                }
                if let next = s.tier.next {
                    Text("\(next.at - s.rating) more to reach \(next.name).").font(.archivo(13)).foregroundStyle(Theme.mist)
                }
                sortieRow(s)
            } else {
                Text("Pilot Rating").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ice)
                Text("Working out your stats…").font(.archivo(15)).foregroundStyle(Theme.mist)
                ProgressView().tint(.white)
            }
        }
        .task(id: model.flights.count) { await store.refresh() }
        .fullScreenCover(isPresented: $sortie, onDismiss: { Task { await store.refresh() } }) { SortieView() }
    }

    @ViewBuilder
    private func sortieRow(_ s: PilotStats) -> some View {
        HStack(spacing: 10) {
            Button { sortie = true } label: {
                Text(s.current.sortieToday ? "Fly another sortie" : "Today’s sortie")
            }
            .buttonStyle(.pill(.light, height: 46, spark: !s.current.sortieToday))
            Spacer(minLength: 0)
            ShareLink(item: cardImage(s), preview: SharePreview("My Boplo pilot card", image: cardImage(s))) {
                Image(systemName: "square.and.arrow.up").font(.system(size: 17, weight: .semibold))
                    .frame(width: 46, height: 46)
                    .background(.white.opacity(0.12), in: Circle())
            }
            .foregroundStyle(.white)
            .accessibilityLabel("Share your pilot card")
        }
        Text(s.current.days > 0 ? (s.current.sortieToday ? "Sortie done today. You’re current for \(s.current.days) days." : "You’re current for \(s.current.days) more day\(s.current.days == 1 ? "" : "s"). Fly today’s sortie to stay current.") : "Not current. Fly today’s sortie: 3 minutes, all three stats.")
            .font(.archivo(13)).foregroundStyle(s.current.days > 0 ? Theme.mist : Theme.ice)
    }

    @MainActor
    private func cardImage(_ s: PilotStats) -> Image {
        let r = ImageRenderer(content: ShareCard(stats: s, name: model.profile?.firstName ?? "", airport: model.homeCode, aircraft: model.profile?.aircraft ?? "").frame(width: 360, height: 520))
        r.scale = 3
        if let ui = r.uiImage { return Image(uiImage: ui) }
        return Image(systemName: "airplane")
    }
}

struct DeltaTag: View {
    let d: Int
    var body: some View {
        Text(d > 0 ? "+\(d)" : "\(d)")
            .font(.archivo(12.5, .semibold)).monospacedDigit()
            .padding(.horizontal, 7).frame(height: 22)
            .background((d > 0 ? Theme.ok : Theme.danger).opacity(0.9), in: Capsule())
            .foregroundStyle(.white)
            .transition(.scale.combined(with: .opacity))
    }
}

struct StatBar: View {
    let kind: StatKind
    let value: Int
    var delta: Int?
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Text(kind.title).font(.archivo(14.5, .semibold))
                if let delta { DeltaTag(d: delta) }
                Spacer()
                Text("\(value)").font(.archivo(15, .semibold)).monospacedDigit().contentTransition(.numericText())
            }
            Bar(value: Double(value) / 99, height: 8, track: .white.opacity(0.12), fill: Theme.ice)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(kind.title) \(value) of 99")
    }
}

/// The image people share: a trading-card take on their pilot profile.
struct ShareCard: View {
    let stats: PilotStats
    let name: String
    let airport: String
    let aircraft: String
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 0) {
                    Text("\(stats.rating)").font(Theme.display(96)).tracking(-3)
                    Text(stats.tier.name.uppercased()).font(.archivo(14, .semibold)).tracking(1.5).foregroundStyle(Theme.ice)
                }
                Spacer()
                Image(systemName: "airplane").font(.system(size: 34, weight: .semibold)).foregroundStyle(Theme.ice).rotationEffect(.degrees(-30))
            }
            Spacer()
            Text(name.isEmpty ? "Boplo pilot" : name).font(Theme.display(40)).tracking(-1).lineLimit(1).minimumScaleFactor(0.6)
            Text([airport, aircraft].filter { !$0.isEmpty }.joined(separator: " · ")).font(.archivo(15)).foregroundStyle(Theme.mist).padding(.top, 2)
            HStack(spacing: 0) {
                ForEach(StatKind.allCases) { k in
                    VStack(spacing: 2) {
                        Text("\(k.value(stats))").font(.archivo(30, .semibold)).monospacedDigit()
                        Text(k.short).font(.archivo(12, .semibold)).tracking(1).foregroundStyle(Theme.mist)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
            .padding(.vertical, 16)
            .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .padding(.top, 18)
            HStack {
                Text("#\(stats.rank) of \(stats.total) pilots").font(.archivo(13, .semibold))
                Spacer()
                Text("boplo.app").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
            }
            .padding(.top, 14)
        }
        .padding(28)
        .foregroundStyle(.white)
        .background {
            ZStack {
                LinearGradient(colors: [Theme.navy, Theme.night], startPoint: .top, endPoint: .bottom)
                Contours(seed: 2.4).opacity(0.5)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .environment(\.colorScheme, .dark)
    }
}
