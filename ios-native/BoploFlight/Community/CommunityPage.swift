import SwiftUI

/// Q&A: questions and answers between student pilots (community API, same as the web).
struct CommunityPage: View {
    @Environment(AppModel.self) private var model
    @State private var topics: [(String, String)] = []
    @State private var questions: [[String: Any]] = []
    @State private var topic = ""
    @State private var sort = "new"
    @State private var search = ""
    @State private var loading = true
    @State private var error: String?
    @State private var asking = false
    @State private var searchTask: Task<Void, Never>?

    var body: some View {
        Page(title: "Q&A", subtitle: "Ask other student pilots, share what worked, and help the next person.") {
            Button { asking = true } label: { Text("Ask a question") }.buttonStyle(.pill(.blue, height: 46, spark: true))
            Text("Be kind and specific. Answers here are from other students, not instructors: check anything that matters with your school.")
                .font(.archivo(13.5)).padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.electric.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(Theme.ink3)
                TextField("Search questions", text: $search).font(.archivo(15.5))
            }
            .padding(.horizontal, 16).frame(height: 46).background(Theme.paper, in: Capsule()).overlay(Capsule().strokeBorder(Theme.hair))
            Picker("Sort", selection: $sort) { Text("Latest").tag("new"); Text("Top").tag("top"); Text("Unanswered").tag("open") }.pickerStyle(.segmented)
            if !topics.isEmpty {
                ChipRow(items: [ChipRow.Item(id: "", label: "All topics")] + topics.map { ChipRow.Item(id: $0.0, label: $0.1) }, selected: topic) { topic = $0 }
            }
            if loading {
                Tile { ProgressView().frame(maxWidth: .infinity) }
            } else if let error {
                Tile { Text("The community didn’t load.").font(.archivo(17, .semibold)); Text(error).font(.archivo(14)).foregroundStyle(Theme.ink3) }
            } else if questions.isEmpty {
                Tile {
                    Text(search.isEmpty && topic.isEmpty && sort != "open" ? "Be the first to ask." : "Nothing here yet.").font(.archivo(17, .semibold))
                    Text("Questions about lessons, exams, checkrides, radio, costs: anything another student might know.").font(.archivo(14)).foregroundStyle(Theme.ink3)
                }
            } else {
                ForEach(Array(questions.enumerated()), id: \.offset) { _, q in
                    NavigationLink { QuestionPage(id: q["id"] as? String ?? "", topics: topics) } label: { questionCard(q) }.buttonStyle(.plain)
                }
            }
        }
        .navigationTitle("Q&A")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: sort) { _, _ in Task { await load() } }
        .onChange(of: topic) { _, _ in Task { await load() } }
        .onChange(of: search) { _, _ in
            searchTask?.cancel()
            searchTask = Task { try? await Task.sleep(nanoseconds: 350_000_000); if !Task.isCancelled { await load() } }
        }
        .sheet(isPresented: $asking) { AskQuestionSheet(topics: topics) { Task { await load() } } }
    }

    private func questionCard(_ q: [String: Any]) -> some View {
        let answers = (q["answers"] as? NSNumber)?.intValue ?? 0
        return Tile(spacing: 8) {
            Text(q["title"] as? String ?? "").font(.archivo(16.5, .semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.leading)
            if let ex = q["excerpt"] as? String, !ex.isEmpty { Text(ex).font(.archivo(14)).foregroundStyle(Theme.ink3).lineLimit(2).multilineTextAlignment(.leading) }
            HStack(spacing: 8) {
                Chip(text: topics.first { $0.0 == q["topic"] as? String }?.1 ?? "General")
                Label("\((q["score"] as? NSNumber)?.intValue ?? 0)", systemImage: "arrow.up").font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                Label("\(answers)", systemImage: "bubble.left").font(.archivo(12.5)).foregroundStyle(answers > 0 ? Theme.ok : Theme.ink3)
                Spacer()
                Text(PilotTag.ago(q["last"] ?? q["at"])).font(.archivo(12)).foregroundStyle(Theme.ink3)
            }
            PilotTag(by: q["by"] as? [String: Any])
        }
    }

    private func load() async {
        var path = "flight/community/posts?sort=\(sort)"
        if !topic.isEmpty { path += "&topic=\(topic)" }
        let s = search.trimmingCharacters(in: .whitespaces)
        if !s.isEmpty { path += "&q=" + (s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "") }
        do {
            let d = try await API.shared.object(path)
            topics = ((d["topics"] as? [[String]]) ?? []).compactMap { $0.count >= 2 ? ($0[0], $0[1]) : nil }
            questions = d["questions"] as? [[String: Any]] ?? []
            error = nil
        } catch { self.error = error.localizedDescription }
        loading = false
    }
}

/// "Priya · EGHP · PPL(A)"
struct PilotTag: View {
    let by: [String: Any]?
    var body: some View {
        let parts = [by?["name"] as? String, by?["airfield"] as? String, by?["licence"] as? String].compactMap { $0 }.filter { !$0.isEmpty }
        if !parts.isEmpty {
            Text(parts.joined(separator: " · ")).font(.archivo(12.5, .medium)).foregroundStyle(Theme.ink2)
        }
    }

    static func ago(_ v: Any?) -> String {
        guard let ms = (v as? NSNumber)?.doubleValue else { return "" }
        let s = Date().timeIntervalSince1970 - ms / 1000
        if s < 60 { return "just now" }
        if s < 3600 { return "\(Int(s / 60)) min ago" }
        if s < 86400 { return "\(Int(s / 3600)) h ago" }
        if s < 86400 * 30 { return plural(Int(s / 86400), "day") + " ago" }
        return Date(timeIntervalSince1970: ms / 1000).formatted(date: .abbreviated, time: .omitted)
    }
}

struct AskQuestionSheet: View {
    let topics: [(String, String)]
    var onPosted: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var topic = "general"
    @State private var bodyText = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Labeled(label: "Your question") { TextField("e.g. How did you prepare for the navigation exam?", text: $title, axis: .vertical).padding(.vertical, 12).boploField() }
                    Labeled(label: "Topic") {
                        Picker("Topic", selection: $topic) { ForEach(topics.isEmpty ? [("general", "General")] : topics, id: \.0) { Text($0.1).tag($0.0) } }.pickerStyle(.menu).tint(Theme.ink)
                    }
                    Labeled(label: "Details (optional)") { TextField("Add context: your licence, aircraft, what you’ve tried.", text: $bodyText, axis: .vertical).lineLimit(4...10).padding(.vertical, 12).boploField() }
                    Footnote(text: "Others see your first name, home airfield and licence. Don’t share personal details, and follow your instructor’s advice over anything posted here.")
                    ErrorText(text: error)
                }
                .padding(16)
            }
            .background(Theme.cloud.ignoresSafeArea())
            .navigationTitle("Ask the community")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Posting…" : "Post") { Task { await post() } }.disabled(busy || title.trimmingCharacters(in: .whitespaces).count < 5)
                }
            }
        }
    }

    private func post() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await API.shared.send("flight/community/posts", method: "POST", body: ["title": title, "topic": topic, "body": bodyText])
            onPosted(); dismiss()
        } catch { self.error = error.localizedDescription }
    }
}

struct QuestionPage: View {
    let id: String
    let topics: [(String, String)]
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var question: [String: Any]?
    @State private var answers: [[String: Any]] = []
    @State private var reply = ""
    @State private var busy = false
    @State private var error: String?
    @State private var reported: Set<String> = []

    var body: some View {
        Page(title: "Q&A") {
            if let q = question {
                post(q, isQuestion: true)
                Text(plural(answers.count, "answer")).font(.archivo(16, .semibold)).padding(.top, 6)
                ForEach(Array(answers.enumerated()), id: \.offset) { _, a in post(a, isQuestion: false) }
                Tile(spacing: 10) {
                    TileHead("Your answer")
                    TextField("Share what worked for you", text: $reply, axis: .vertical).lineLimit(3...10).padding(.vertical, 12).boploField()
                    Footnote(text: "Shown with your first name, home airfield and licence.")
                    ErrorText(text: error)
                    Button("Post answer") { Task { await answer() } }.buttonStyle(.pill(.blue, height: 44))
                        .disabled(busy || reply.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            } else if let error {
                Tile { Text(error).font(.archivo(15)) }
            } else {
                Tile { ProgressView().frame(maxWidth: .infinity) }
            }
        }
        .navigationTitle("Question")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func post(_ p: [String: Any], isQuestion: Bool) -> some View {
        let pid = p["id"] as? String ?? ""
        let mine = p["mine"] as? Bool ?? false
        let my = (p["my"] as? NSNumber)?.intValue ?? 0
        return Tile(spacing: 10) {
            if isQuestion {
                Chip(text: topics.first { $0.0 == p["topic"] as? String }?.1 ?? "General")
                Text(p["title"] as? String ?? "").font(Theme.display(26)).tracking(-0.6).fixedSize(horizontal: false, vertical: true)
            }
            if let b = p["body"] as? String, !b.isEmpty { Text(b).font(.archivo(15)).foregroundStyle(Theme.ink2) }
            HStack {
                PilotTag(by: p["by"] as? [String: Any])
                Text(PilotTag.ago(p["at"])).font(.archivo(12)).foregroundStyle(Theme.ink3)
                Spacer()
            }
            HStack(spacing: 14) {
                HStack(spacing: 6) {
                    Button { Task { await vote(pid, my == 1 ? 0 : 1) } } label: { Image(systemName: my == 1 ? "arrowtriangle.up.fill" : "arrowtriangle.up") }.disabled(mine)
                    Text("\((p["score"] as? NSNumber)?.intValue ?? 0)").font(.archivo(14.5, .semibold)).monospacedDigit()
                    Button { Task { await vote(pid, my == -1 ? 0 : -1) } } label: { Image(systemName: my == -1 ? "arrowtriangle.down.fill" : "arrowtriangle.down") }.disabled(mine)
                }
                .foregroundStyle(Theme.electric)
                Spacer()
                if mine || model.billing?.owner == true {
                    Button("Delete", role: .destructive) { Task { await delete(pid, isQuestion: isQuestion) } }.font(.archivo(13, .semibold))
                }
                if !mine {
                    Button(reported.contains(pid) ? "Reported" : "Report") { Task { await report(pid) } }.font(.archivo(13, .semibold)).foregroundStyle(Theme.ink3).disabled(reported.contains(pid))
                }
            }
            .buttonStyle(.plain)
            if p["hidden"] as? Bool == true { Chip(text: "Hidden after reports", tone: .warn) }
        }
    }

    private func load() async {
        do {
            let d = try await API.shared.object("flight/community/posts/\(id)")
            question = d["question"] as? [String: Any]
            answers = d["answers"] as? [[String: Any]] ?? []
        } catch { self.error = error.localizedDescription }
    }

    private func vote(_ pid: String, _ v: Int) async {
        do { try await API.shared.send("flight/community/vote", method: "POST", body: ["id": pid, "v": v]); await load() } catch { self.error = error.localizedDescription }
    }

    private func report(_ pid: String) async {
        do { try await API.shared.send("flight/community/report", method: "POST", body: ["id": pid, "reason": "reported"]); reported.insert(pid) } catch { self.error = error.localizedDescription }
    }

    private func delete(_ pid: String, isQuestion: Bool) async {
        do {
            try await API.shared.send("flight/community/posts/\(pid)", method: "DELETE", body: [:])
            if isQuestion { dismiss() } else { await load() }
        } catch { self.error = error.localizedDescription }
    }

    private func answer() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            try await API.shared.send("flight/community/posts/\(id)/answers", method: "POST", body: ["body": reply])
            reply = ""
            await load()
        } catch { self.error = error.localizedDescription }
    }
}
