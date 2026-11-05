import SwiftUI

/// Ask Boplo: the study assistant. Same endpoint and desk context as the web chat (/flight/ask).
struct AskView: View {
    @Environment(AppModel.self) private var model

    struct Message: Codable, Identifiable, Equatable {
        var id = UUID()
        var role: String
        var content: String
        var error: String?
    }

    @State private var messages: [Message] = []
    @State private var draft = ""
    @State private var busy = false
    @State private var usage: String?
    @FocusState private var focused: Bool

    private var storeKey: String { "boplo-ask-" + (model.workspace?.user.email ?? "me") }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    if messages.isEmpty { hello } else {
                        ForEach(messages) { m in bubble(m).id(m.id) }
                    }
                    Text((usage.map { $0 + " " } ?? "") + "Boplo can make mistakes. It’s a study aid, not a flight briefing or your instructor. Check anything important with them and official sources.")
                        .font(.archivo(12)).foregroundStyle(Theme.ink3)
                        .padding(.top, 6)
                        .id("foot")
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Theme.cloud.ignoresSafeArea())
            .onChange(of: messages) { _, _ in withAnimation { proxy.scrollTo("foot", anchor: .bottom) } }
            .safeAreaInset(edge: .bottom) { composer }
        }
        .navigationTitle("Ask Boplo")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button { messages = []; save() } label: { Label("New chat", systemImage: "square.and.pencil") }
                    NavigationLink(value: Route.web(.checkride)) { Label("Mock checkride", systemImage: "person.wave.2") }
                } label: { Image(systemName: "ellipsis.circle") }
            }
        }
        .onAppear(perform: load)
        .task { await loadUsage() }
    }

    private var suggestions: [String] {
        let p = model.profile
        return [
            p?.nextLesson?.isEmpty == false ? "Help me prepare for \(p!.nextLesson!)" : "What should I prepare before my next lesson?",
            "Quiz me on air law, one question at a time",
            "Decode this METAR: EGLL 211650Z 27016KT 9999 FEW041 10/04 Q1006",
            "Why does an aircraft stall?",
            model.flights.contains { $0.notes?.isEmpty == false } ? "Look at my recent debriefs. What should I work on?" : "How do I make a good radio call in the circuit?",
            model.regime == "faa" ? "What are the VFR weather minimums in Class E airspace?" : "What are the VMC minima in class G airspace?"
        ]
    }

    private var hello: some View {
        DarkTile(spacing: 14) {
            Image(systemName: "sparkle")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Theme.electric)
                .frame(width: 44, height: 44)
                .background(.white, in: Circle())
            Text("\(model.profile?.firstName.isEmpty == false ? "Hi \(model.profile!.firstName)." : "Hi.") What are we studying today?")
                .font(Theme.display(30)).tracking(-0.8)
                .fixedSize(horizontal: false, vertical: true)
            Text("Ask anything about flying theory, rules, weather, radio or your own training. Boplo cites official sources and knows your desk.")
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
            VStack(alignment: .leading, spacing: 8) {
                ForEach(suggestions, id: \.self) { s in
                    Button { draft = s; Task { await send() } } label: {
                        Text(s).font(.archivo(14, .medium)).multilineTextAlignment(.leading)
                            .padding(.horizontal, 14).padding(.vertical, 10)
                            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.ice.opacity(0.18)))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    @ViewBuilder
    private func bubble(_ m: Message) -> some View {
        if m.role == "user" {
            HStack {
                Spacer(minLength: 40)
                Text(m.content)
                    .font(.archivo(15))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(Theme.electric, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            }
        } else {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "sparkle")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Theme.ink, in: Circle())
                VStack(alignment: .leading, spacing: 8) {
                    if let e = m.error {
                        ErrorText(text: e)
                        if e.contains("Advanced") { Button("See Advanced") { model.upgrade() }.buttonStyle(.pill(.blue, height: 38)) }
                    } else if m.content.isEmpty {
                        TypingDots()
                    } else {
                        MarkdownText(text: m.content)
                        Button {
                            UIPasteboard.general.string = m.content
                        } label: { Text("Copy").font(.archivo(13, .semibold)).foregroundStyle(Theme.electric) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.paper, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(Theme.hair))
            }
        }
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Ask about theory, rules, weather, radio…", text: $draft, axis: .vertical)
                .font(.archivo(15.5))
                .lineLimit(1...6)
                .focused($focused)
                .padding(.horizontal, 16).padding(.vertical, 12)
                .background(Theme.paper, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.hair))
            Button { Task { await send() } } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 44, height: 44)
                    .background(draft.trimmingCharacters(in: .whitespaces).isEmpty || busy ? Theme.mist : Theme.electric, in: Circle())
            }
            .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty || busy)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial)
    }

    // MARK: - Actions

    private func send() async {
        let q = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, !busy else { return }
        draft = ""; busy = true
        messages.append(Message(role: "user", content: q))
        let bot = Message(role: "assistant", content: "")
        messages.append(bot)
        let history = messages.filter { $0.error == nil && !($0.role == "assistant" && $0.content.isEmpty) }
            .suffix(20).map { ["role": $0.role, "content": $0.content] }
        do {
            _ = try await API.shared.stream("flight/ask", body: ["messages": Array(history), "context": model.askContext]) { text in
                if let i = messages.firstIndex(where: { $0.id == bot.id }) { messages[i].content = text }
            }
        } catch {
            if let i = messages.firstIndex(where: { $0.id == bot.id }) { messages[i].error = error.localizedDescription }
            if (error as? APIError)?.status == 402 { model.upgrade(error.localizedDescription) }
        }
        busy = false
        save()
        await loadUsage()
    }

    private func load() {
        guard messages.isEmpty, let data = UserDefaults.standard.data(forKey: storeKey),
              let list = try? JSONDecoder().decode([Message].self, from: data) else { return }
        messages = list
    }

    private func save() {
        let keep = messages.filter { $0.error == nil && !$0.content.isEmpty }.suffix(40)
        if let data = try? JSONEncoder().encode(Array(keep)) { UserDefaults.standard.set(data, forKey: storeKey) }
    }

    private func loadUsage() async {
        guard let obj = try? await API.shared.object("flight/ask/usage") else { return }
        if (obj["on"] as? Bool) == false { usage = "Ask Boplo is offline right now."; return }
        if let left = (obj["left"] as? NSNumber)?.intValue, let limit = (obj["limit"] as? NSNumber)?.intValue {
            usage = "\(left) of \(limit) questions left today."
        }
    }
}

/// Renders the assistant's markdown: headings, bullet and numbered lists, bold, italics, links.
struct MarkdownText: View {
    let text: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                switch block {
                case .heading(let s): inline(s).font(.archivo(15.5, .semibold))
                case .bullet(let s, let marker):
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(marker).font(.archivo(15, .semibold)).foregroundStyle(Theme.electric)
                        inline(s).font(.archivo(15))
                    }
                case .sources(let s):
                    Text("Sources · " + s).font(.archivo(12.5, .medium)).foregroundStyle(Theme.ink3)
                case .para(let s): inline(s).font(.archivo(15))
                }
            }
        }
        .foregroundStyle(Theme.ink)
        .tint(Theme.electric)
        .textSelection(.enabled)
    }

    private enum Block { case heading(String), bullet(String, String), sources(String), para(String) }

    private var blocks: [Block] {
        var out: [Block] = []
        var n = 0
        for raw in text.components(separatedBy: "\n") {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty { n = 0; continue }
            let lower = line.lowercased().replacingOccurrences(of: "*", with: "")
            if lower.hasPrefix("sources:") || lower.hasPrefix("source:") {
                out.append(.sources(String(line.drop(while: { $0 != ":" }).dropFirst()).replacingOccurrences(of: "*", with: "").trimmingCharacters(in: .whitespaces)))
            } else if line.hasPrefix("#") {
                out.append(.heading(line.trimmingCharacters(in: CharacterSet(charactersIn: "# "))))
            } else if line.hasPrefix("- ") || line.hasPrefix("* ") || line.hasPrefix("• ") {
                out.append(.bullet(String(line.dropFirst(2)), "•"))
            } else if let r = line.range(of: #"^\d+[.)]\s+"#, options: .regularExpression) {
                n += 1
                out.append(.bullet(String(line[r.upperBound...]), "\(n)."))
            } else {
                out.append(.para(line))
            }
        }
        return out
    }

    private func inline(_ s: String) -> Text {
        if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) { return Text(a) }
        return Text(s)
    }
}

struct TypingDots: View {
    @State private var on = false
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { i in
                Circle().fill(Theme.mist).frame(width: 7, height: 7)
                    .opacity(on ? 1 : 0.3)
                    .animation(.easeInOut(duration: 0.6).repeatForever().delay(Double(i) * 0.18), value: on)
            }
        }
        .padding(.vertical, 6)
        .onAppear { on = true }
    }
}
