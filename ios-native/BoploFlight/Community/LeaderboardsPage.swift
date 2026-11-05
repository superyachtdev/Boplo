import SwiftUI

/// Landing leaderboards: the daily challenge, airfield boards and your bests (community/boards API).
struct LeaderboardsPage: View {
    @Environment(AppModel.self) private var model
    @State private var data: [String: Any]?
    @State private var error: String?
    @State private var ap = ""
    @State private var kind = "short"
    @State private var period = "week"
    @State private var simURL: URL?
    @State private var postOn = true

    private let kinds = [("short", "Short final"), ("long", "Long final"), ("circuit", "Circuit")]
    private let wxNames = ["clear": "clear skies", "fair": "fair weather", "scattered": "scattered cloud", "broken": "broken cloud", "overcast": "low overcast", "hazy": "haze", "gusty": "a gusty crosswind"]

    var body: some View {
        Page(title: "Leaderboards", subtitle: "Your best simulator landing at each airfield, against everyone else’s. A new daily challenge every day.") {
            if let error {
                Tile { Text("Leaderboards didn’t load.").font(.archivo(17, .semibold)); Text(error).font(.archivo(14)).foregroundStyle(Theme.ink3) }
            } else if let d = data {
                challenge(d)
                airfieldBoard(d)
                bests(d)
                busy(d)
            } else {
                Tile { ProgressView().frame(maxWidth: .infinity) }
            }
        }
        .navigationTitle("Leaderboards")
        .navigationBarTitleDisplayMode(.inline)
        .task { if ap.isEmpty { ap = model.homeCode }; postOn = model.rawProfile["boardsOff"] as? Bool != true; await load() }
        .refreshable { await load() }
        .onChange(of: kind) { _, _ in Task { await load() } }
        .onChange(of: period) { _, _ in Task { await load() } }
        .fullScreenCover(item: $simURL) { url in SimulatorView(url: url) }
    }

    private func board(_ b: [String: Any]?, empty: String, dark: Bool = false) -> some View {
        let rows = b?["rows"] as? [[String: Any]] ?? []
        return VStack(alignment: .leading, spacing: 6) {
            if rows.isEmpty { Text(empty).font(.archivo(14)).foregroundStyle(dark ? Theme.mist : Theme.ink3) }
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                let me = r["me"] as? Bool == true
                HStack(spacing: 10) {
                    Text("\((r["rank"] as? NSNumber)?.intValue ?? 0)").font(.archivo(13, .semibold)).frame(width: 24)
                        .foregroundStyle(dark ? Theme.ice : Theme.ink3)
                    VStack(alignment: .leading, spacing: 1) {
                        let by = r["by"] as? [String: Any]
                        Text([by?["name"] as? String, by?["airfield"] as? String].compactMap { $0 }.joined(separator: " · ")).font(.archivo(14.5, .semibold))
                        if let a = r["aircraft"] as? String, !a.isEmpty { Text(a).font(.archivo(12)).foregroundStyle(dark ? Theme.mist : Theme.ink3) }
                    }
                    Spacer()
                    Text("\((r["score"] as? NSNumber)?.intValue ?? 0)").font(.archivo(18, .semibold)).monospacedDigit()
                }
                .padding(.vertical, 6).padding(.horizontal, 8)
                .background(me ? (dark ? Color.white.opacity(0.1) : Theme.electric.opacity(0.07)) : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            if let me = b?["me"] as? [String: Any], let rank = (me["rank"] as? NSNumber)?.intValue, rank > rows.count {
                Text("You’re #\(rank) with \((me["score"] as? NSNumber)?.intValue ?? 0).").font(.archivo(13.5)).foregroundStyle(dark ? Theme.mist : Theme.ink3)
            }
        }
    }

    private func challenge(_ d: [String: Any]) -> some View {
        let ch = d["challenge"] as? [String: Any] ?? [:]
        let code = ch["code"] as? String ?? "", name = ch["name"] as? String ?? code, rw = ch["runway"] as? String ?? "", wx = ch["weather"] as? String ?? "clear"
        return DarkTile(spacing: 12) {
            Text("Daily challenge · \(Day.long(ch["date"] as? String))").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ice)
            Text("Short final at \(name), runway \(rw)").font(Theme.display(30)).tracking(-0.8).fixedSize(horizontal: false, vertical: true)
            Text("Everyone flies the same approach today in \(wxNames[wx] ?? wx). Best landing score wins.\(model.isAdvanced ? "" : " It counts as one of your two free short finals.")")
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
            Button {
                var c = URLComponents(string: "https://boplo.app/flight-app.html")!
                c.queryItems = [.init(name: "embed", value: "1"), .init(name: "practice", value: code), .init(name: "rw", value: rw), .init(name: "kind", value: "short"), .init(name: "wx", value: wx), .init(name: "challenge", value: "1"), .init(name: "name", value: name)]
                c.fragment = "sim"
                simURL = c.url
            } label: { Text("Fly today’s challenge") }
                .buttonStyle(.pill(.light, height: 48, spark: true))
            Text("Today’s top landings").font(.archivo(15, .semibold)).padding(.top, 4)
            board(d["daily"] as? [String: Any], empty: "No one has flown it yet. Be first.", dark: true)
        }
    }

    private func airfieldBoard(_ d: [String: Any]) -> some View {
        Tile(spacing: 12) {
            TileHead("Airfield board")
            HStack(spacing: 8) {
                TextField("Airfield code", text: $ap).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    .submitLabel(.search).onSubmit { Task { await load() } }.boploField()
                Button("Show") { Task { await load() } }.buttonStyle(.pill(.line, height: 48))
            }
            Picker("Exercise", selection: $kind) { ForEach(kinds, id: \.0) { Text($0.1).tag($0.0) } }.pickerStyle(.segmented)
            Picker("Period", selection: $period) { Text("This week").tag("week"); Text("All time").tag("all") }.pickerStyle(.segmented)
            if ap.isEmpty {
                Text("Choose an airfield.").font(.archivo(14)).foregroundStyle(Theme.ink3)
            } else {
                board(d["local"] as? [String: Any], empty: "No \(kinds.first { $0.0 == kind }?.1.lowercased() ?? "") landings at \(ap.uppercased()) \(period == "week" ? "this week" : "yet"). Fly one from the simulator’s practice section.")
            }
            Footnote(text: "Score out of 100: touchdown rate (40), touchdown point against the aim point (25), centreline (20) and speed (15). Only practice landings in the simulator count.")
        }
    }

    private func bests(_ d: [String: Any]) -> some View {
        let mine = d["mine"] as? [[String: Any]] ?? []
        return Tile(spacing: 10) {
            TileHead("Your bests")
            if mine.isEmpty { Text("Land in the simulator’s practice mode and your score is posted here.").font(.archivo(14)).foregroundStyle(Theme.ink3) }
            ForEach(Array(mine.enumerated()), id: \.offset) { _, m in
                HStack {
                    Text("\(m["ap"] as? String ?? "") · \(kinds.first { $0.0 == m["kind"] as? String }?.1 ?? (m["kind"] as? String ?? ""))").font(.archivo(14.5))
                    Spacer()
                    Text("\((m["best"] as? NSNumber)?.intValue ?? 0)").font(.archivo(15, .semibold))
                }
            }
            Toggle(isOn: $postOn) { Text("Post my practice landings to the leaderboards").font(.archivo(14)) }
                .onChange(of: postOn) { _, on in Task { try? await model.saveProfile(["boardsOff": !on]) } }
        }
    }

    private func busy(_ d: [String: Any]) -> some View {
        let list = d["busy"] as? [[String: Any]] ?? []
        return Tile(spacing: 10) {
            TileHead("Busiest this week")
            if list.isEmpty { Text("Nothing flown yet this week.").font(.archivo(14)).foregroundStyle(Theme.ink3) }
            ForEach(Array(list.enumerated()), id: \.offset) { _, b in
                HStack {
                    Button(b["ap"] as? String ?? "") { ap = b["ap"] as? String ?? ""; kind = "short"; Task { await load() } }
                        .font(.archivo(14.5, .semibold)).foregroundStyle(Theme.electric)
                    Spacer()
                    Text("\(plural((b["pilots"] as? NSNumber)?.intValue ?? 0, "pilot")) · best \((b["best"] as? NSNumber)?.intValue ?? 0)").font(.archivo(14)).foregroundStyle(Theme.ink2)
                }
            }
        }
    }

    private func load() async {
        let code = AirfieldStore.code(ap)
        do {
            data = try await API.shared.object("flight/community/boards?ap=\(code)&kind=\(kind)&period=\(period)")
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}

extension URL: @retroactive Identifiable {
    public var id: String { absoluteString }
}
