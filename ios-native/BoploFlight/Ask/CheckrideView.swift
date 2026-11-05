import SwiftUI
import AVFoundation

/// Mock checkride: an AI examiner (Ask Boplo in examiner mode) runs a practice oral exam and scores it.
struct CheckrideView: View {
    @Environment(AppModel.self) private var model

    static let focuses: [(String, String)] = [("all", "Whole oral"), ("airspace", "Airspace and rules"), ("weather", "Weather"), ("performance", "Performance and planning"), ("systems", "Aircraft systems"), ("emergencies", "Emergencies"), ("navigation", "Navigation"), ("human", "Human factors")]

    @State private var focus = "all"
    @State private var style = "friendly"
    @State private var length = 10
    @State private var voice = false
    @State private var messages: [AskView.Message] = []
    @State private var draft = ""
    @State private var busy = false
    @State private var listener = SpeechListener()
    @State private var synth = AVSpeechSynthesizer()
    @State private var history: [[String: Any]] = []

    private var key: String { "boplo-checkride-" + (model.workspace?.user.email ?? "me") }

    private static func score(_ t: String) -> Int? {
        guard let r = t.range(of: #"Score:\s*\**\s*(\d{1,3})\s*/\s*100"#, options: [.regularExpression, .caseInsensitive]) else { return nil }
        let digits = t[r].split(whereSeparator: { !$0.isNumber }).first.map(String.init) ?? ""
        return Int(digits).map { min(100, $0) }
    }
    private static func result(_ t: String) -> String {
        guard let r = t.range(of: #"Result:\s*\**\s*([^\n*]+)"#, options: [.regularExpression, .caseInsensitive]) else { return "" }
        return String(t[r]).replacingOccurrences(of: "Result:", with: "", options: .caseInsensitive).replacingOccurrences(of: "*", with: "").trimmingCharacters(in: .whitespaces)
    }

    private var debriefed: Bool { messages.contains { $0.role == "assistant" && Self.score($0.content) != nil } }
    private var started: Bool { !messages.isEmpty }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if !model.isAdvanced {
                        LockedTile(title: "Rehearse your checkride out loud.", text: "An AI examiner runs a realistic oral exam for your licence, asks follow-ups when an answer is thin, and gives you a scored debrief with what to study next. Speak your answers or type them.", message: "Mock checkride is part of Advanced.")
                    } else if !started {
                        setup
                    } else {
                        ForEach(messages.dropFirst()) { m in bubble(m).id(m.id) }
                        if debriefed {
                            Button { messages = []; save() } label: { Text("Start another checkride") }.primaryStyle(full: false)
                        }
                    }
                    Text("Practice only. A real examiner and your instructor decide when you’re ready.").font(.archivo(12)).foregroundStyle(Theme.ink3).id("foot")
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.cloud.ignoresSafeArea())
            .onChange(of: messages) { _, _ in withAnimation { proxy.scrollTo("foot", anchor: .bottom) } }
            .safeAreaInset(edge: .bottom) { if started && !debriefed { composer } }
        }
        .navigationTitle("Mock checkride")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: load)
        .onDisappear { listener.stop(); synth.stopSpeaking(at: .immediate) }
    }

    private var setup: some View {
        DarkTile(spacing: 14) {
            Text("Mock checkride").font(Theme.display(32))
            Text("A practice oral exam for \(model.profile?.licence ?? "your licence") under \(model.regime == "faa" ? "the FAA ACS" : model.regime == "uk" ? "UK CAA rules" : model.regime == "easa" ? "EASA rules" : "your authority’s rules"). The examiner sets a scenario, asks one question at a time and follows up like the real thing.")
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
            option("Focus", Self.focuses, selection: $focus)
            option("Examiner", [("friendly", "Friendly"), ("strict", "Strict")], selection: $style)
            option("Length", [("8", "8 questions"), ("12", "12 questions"), ("16", "16 questions")], selection: Binding(get: { String(length) }, set: { length = Int($0) ?? 10 }))
            Toggle(isOn: $voice) { Text("Voice: examiner speaks, you answer out loud").font(.archivo(14.5)) }.tint(Theme.electric)
            Button { Task { await begin() } } label: { Text("Start the checkride") }.buttonStyle(.pill(.light, height: 48, spark: true))
            if !history.isEmpty {
                HStack(spacing: 8) {
                    Text("Recent scores").font(.archivo(12.5)).foregroundStyle(Theme.mist)
                    ForEach(Array(history.suffix(5).reversed().enumerated()), id: \.offset) { _, h in
                        let s = (h["s"] as? NSNumber)?.intValue ?? 0
                        Text("\(s)").font(.archivo(14, .semibold)).foregroundStyle(s >= 75 ? Theme.ok : s >= 60 ? Color(hex: 0xE0A21B) : Theme.danger)
                            .padding(.horizontal, 8).frame(height: 26).background(.white, in: Capsule())
                    }
                }
            }
        }
    }

    private func option(_ title: String, _ items: [(String, String)], selection: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ice)
            FlowLayout(spacing: 6) {
                ForEach(items, id: \.0) { k, l in
                    Button { selection.wrappedValue = k } label: {
                        Text(l).font(.archivo(13.5, .medium)).padding(.horizontal, 12).frame(height: 32)
                            .foregroundStyle(selection.wrappedValue == k ? Theme.ink : .white)
                            .background(selection.wrappedValue == k ? Color.white : Color.white.opacity(0.08), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func bubble(_ m: AskView.Message) -> some View {
        if m.role == "user" {
            HStack { Spacer(minLength: 40); Text(m.content).font(.archivo(15)).foregroundStyle(.white).padding(.horizontal, 14).padding(.vertical, 10).background(Theme.electric, in: RoundedRectangle(cornerRadius: 18, style: .continuous)) }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                if let s = Self.score(m.content) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text("\(s)").font(Theme.display(44)).foregroundStyle(s >= 75 ? Theme.ok : s >= 60 ? Color(hex: 0xE0A21B) : Theme.danger)
                        Text("/100 · \(Self.result(m.content).isEmpty ? "Debrief" : Self.result(m.content))").font(.archivo(14.5)).foregroundStyle(Theme.ink2)
                    }
                }
                if let e = m.error { ErrorText(text: e) }
                else if m.content.isEmpty { TypingDots() }
                else {
                    MarkdownText(text: m.content.components(separatedBy: "\n").filter { l in
                        let t = l.trimmingCharacters(in: .whitespaces).lowercased()
                        return !t.hasPrefix("score:") && !t.hasPrefix("result:") && !t.hasPrefix("## debrief")
                    }.joined(separator: "\n"))
                    Button { speak(m.content) } label: { Label("Read aloud", systemImage: "speaker.wave.2") }.font(.archivo(13, .semibold)).foregroundStyle(Theme.electric)
                }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hair))
        }
    }

    private var composer: some View {
        VStack(spacing: 8) {
            HStack {
                Text("Question \(min(messages.filter { $0.role == "assistant" && !$0.content.isEmpty }.count, length)) of about \(length)").font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                Spacer()
                Button("End and get my debrief") { draft = "[END] Please stop here and give me my debrief."; Task { await send() } }
                    .buttonStyle(.pill(.ink, height: 32)).disabled(busy)
            }
            HStack(alignment: .bottom, spacing: 8) {
                Button { if listener.listening { listener.stop() } else { listener.start { draft = $0 } } } label: {
                    Image(systemName: listener.listening ? "waveform" : "mic.fill").font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(listener.listening ? .white : Theme.ink).frame(width: 44, height: 44)
                        .background(listener.listening ? Theme.danger : Theme.paper, in: Circle()).overlay(Circle().strokeBorder(Theme.hair))
                }
                TextField("Answer the examiner…", text: $draft, axis: .vertical).font(.archivo(15.5)).lineLimit(1...6)
                    .padding(.horizontal, 16).padding(.vertical, 12)
                    .composerField()
                Button { Task { await send() } } label: {
                    Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(.white).frame(width: 44, height: 44)
                        .background(draft.trimmingCharacters(in: .whitespaces).isEmpty || busy ? Theme.mist : Theme.electric, in: Circle())
                }
                .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 8).composerBar()
    }

    // MARK: Actions

    private func begin() async {
        let f = Self.focuses.first { $0.0 == focus }?.1 ?? ""
        messages = [AskView.Message(role: "user", content: "Begin the mock checkride now: set the scenario and ask your first question.")]
        _ = f
        await send(initial: true)
    }

    private func send(initial: Bool = false) async {
        guard !busy else { return }
        let q = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard initial || !q.isEmpty else { return }
        listener.stop(); synth.stopSpeaking(at: .immediate)
        draft = ""; busy = true
        if !initial { messages.append(AskView.Message(role: "user", content: q)) }
        let bot = AskView.Message(role: "assistant", content: "")
        messages.append(bot)
        let hist = messages.filter { $0.error == nil && !($0.role == "assistant" && $0.content.isEmpty) }.map { ["role": $0.role, "content": $0.content] }
        let setup: [String: Any] = ["focus": focus, "style": style, "questions": length, "voice": voice]
        var final = ""
        do {
            final = try await API.shared.stream("flight/ask", body: ["messages": hist, "context": model.askContext, "mode": "examiner", "setup": setup]) { text in
                if let i = messages.firstIndex(where: { $0.id == bot.id }) { messages[i].content = text }
            }
        } catch {
            if let i = messages.firstIndex(where: { $0.id == bot.id }) { messages[i].error = error.localizedDescription }
            if (error as? APIError)?.status == 402 { model.upgrade(error.localizedDescription) }
        }
        busy = false
        if let s = Self.score(final) {
            history.append(["d": Day.todayISO, "s": s, "f": Self.focuses.first { $0.0 == focus }?.1 ?? ""])
            history = Array(history.suffix(20))
        }
        save()
        if voice, !final.isEmpty, Self.score(final) == nil {
            speak(final)
        }
    }

    private func speak(_ text: String) {
        let clean = text.components(separatedBy: "\n").filter { !$0.lowercased().contains("source") && !$0.hasPrefix("##") }.joined(separator: " ")
            .replacingOccurrences(of: "*", with: "").replacingOccurrences(of: "#", with: "")
        let u = AVSpeechUtterance(string: clean)
        u.voice = AVSpeechSynthesisVoice(language: model.regime == "faa" ? "en-US" : "en-GB")
        u.rate = 0.5
        synth.stopSpeaking(at: .immediate)
        synth.speak(u)
    }

    private func load() {
        let d = UserDefaults.standard
        if messages.isEmpty, let data = d.data(forKey: key), let list = try? JSONDecoder().decode([AskView.Message].self, from: data) { messages = list }
        if let data = d.data(forKey: key + "-history"), let h = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] { history = h }
        if let s = d.dictionary(forKey: key + "-setup") {
            focus = s["focus"] as? String ?? focus; style = s["style"] as? String ?? style
            length = s["questions"] as? Int ?? length; voice = s["voice"] as? Bool ?? voice
        }
    }

    private func save() {
        let d = UserDefaults.standard
        if let data = try? JSONEncoder().encode(messages.filter { $0.error == nil && !$0.content.isEmpty }.suffix(60)) { d.set(data, forKey: key) }
        if let data = try? JSONSerialization.data(withJSONObject: history) { d.set(data, forKey: key + "-history") }
        d.set(["focus": focus, "style": style, "questions": length, "voice": voice], forKey: key + "-setup")
    }
}

/// Wraps chips onto as many lines as they need.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, row: CGFloat = 0, maxX: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > 0 && x + size.width > width { x = 0; y += row + spacing; row = 0 }
            x += size.width + spacing; row = max(row, size.height); maxX = max(maxX, x - spacing)
        }
        return CGSize(width: proposal.width ?? maxX, height: y + row)
    }
    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, row: CGFloat = 0
        for s in subviews {
            let size = s.sizeThatFits(.unspecified)
            if x > bounds.minX && x + size.width > bounds.maxX { x = bounds.minX; y += row + spacing; row = 0 }
            s.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing; row = max(row, size.height)
        }
    }
}
