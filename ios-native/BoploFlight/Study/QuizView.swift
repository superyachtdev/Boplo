import SwiftUI

/// One practice session: question, shuffled answers, explanation, then a result with what to look at again.
struct QuizView: View {
    let session: QuizSession
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var index = 0
    @State private var picked: Int?
    @State private var answers: [(id: String, ok: Bool)] = []
    @State private var orders: [[Int]] = []
    @State private var finished = false
    @State private var resultScore = 0
    @State private var readinessAfter = 0
    @State private var more: [Int: String] = [:]
    @State private var explaining = false

    private var q: QuestionBank.Question? { index < session.questions.count ? session.questions[index] : nil }
    private var right: Int { answers.filter(\.ok).count }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    if finished { result } else if let q { question(q) }
                }
                .padding(16)
            }
            .background(Theme.cloud.ignoresSafeArea())
            .sensoryFeedback(trigger: picked) { _, new in
                guard let new, let q else { return nil }
                return new == q.answer ? .success : .error
            }
            .navigationTitle(finished ? "" : session.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(finished ? "Done" : "End") {
                        if finished || answers.isEmpty { dismiss() } else { Task { await finish(early: true) } }
                    }
                }
            }
        }
        .onAppear {
            if orders.isEmpty { orders = session.questions.map { q in Array(q.options.indices).shuffled() } }
        }
        .interactiveDismissDisabled(!answers.isEmpty && !finished)
    }

    // MARK: Question

    @ViewBuilder
    private func question(_ q: QuestionBank.Question) -> some View {
        let answered = picked != nil
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Question \(index + 1) of \(session.questions.count)").font(.archivo(13, .medium)).foregroundStyle(Theme.ink3)
                Spacer()
                if session.kind != .subject(q.subject) {
                    Text(session.subjects.first { $0.id == q.subject }?.name ?? "").font(.archivo(13, .medium)).foregroundStyle(Theme.ink3)
                }
            }
            Bar(value: Double(index) / Double(session.questions.count), height: 5)
        }
        Text(q.q)
            .font(.archivo(21, .semibold))
            .tracking(-0.3)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.top, 4)
        VStack(spacing: 10) {
            ForEach(orders.indices.contains(index) ? orders[index] : Array(q.options.indices), id: \.self) { oi in
                Button { pick(oi, q) } label: {
                    HStack(alignment: .top, spacing: 12) {
                        Text(q.options[oi]).font(.archivo(15.5, .medium)).multilineTextAlignment(.leading)
                        Spacer(minLength: 0)
                        if answered && oi == q.answer { Image(systemName: "checkmark.circle.fill").foregroundStyle(Theme.ok) }
                        else if answered && oi == picked { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.danger) }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(Theme.ink)
                    .background(optionFill(oi, q), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(optionStroke(oi, q), lineWidth: answered && (oi == q.answer || oi == picked) ? 1.5 : 1))
                    .opacity(answered && oi != q.answer && oi != picked ? 0.55 : 1)
                }
                .buttonStyle(.plain)
                .disabled(answered)
            }
        }
        if let picked {
            let ok = picked == q.answer
            VStack(alignment: .leading, spacing: 10) {
                (Text(ok ? "Correct. " : "Not quite. ").font(.archivo(15, .semibold)).foregroundColor(ok ? Theme.ok : Theme.danger)
                 + Text(q.explain).font(.archivo(15)).foregroundColor(Theme.ink2))
                    .fixedSize(horizontal: false, vertical: true)
                if let extra = more[index] {
                    Divider().overlay(Theme.hair)
                    MarkdownText(text: extra)
                } else if explaining {
                    TypingDots()
                } else {
                    Button { Task { await explain(q) } } label: {
                        Label("Explain it another way with Ask Boplo", systemImage: "sparkle").font(.archivo(14, .semibold))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.electric)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background((ok ? Theme.ok : Theme.danger).opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .transition(.opacity.combined(with: .move(edge: .bottom)))
            HStack {
                Text("\(right) correct so far").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
                Spacer()
                Button {
                    if index + 1 < session.questions.count {
                        withAnimation(.snappy) { index += 1; self.picked = nil }
                    } else {
                        Task { await finish(early: false) }
                    }
                } label: { Text(index + 1 < session.questions.count ? "Next question" : "See results") }
                    .primaryStyle(full: false)
            }
        }
    }

    private func optionFill(_ oi: Int, _ q: QuestionBank.Question) -> Color {
        guard picked != nil else { return Theme.paper }
        if oi == q.answer { return Theme.ok.opacity(0.08) }
        if oi == picked { return Theme.danger.opacity(0.07) }
        return Theme.paper
    }
    private func optionStroke(_ oi: Int, _ q: QuestionBank.Question) -> Color {
        guard picked != nil else { return Theme.hair }
        if oi == q.answer { return Theme.ok }
        if oi == picked { return Theme.danger }
        return Theme.hair
    }

    private func pick(_ oi: Int, _ q: QuestionBank.Question) {
        guard picked == nil else { return }
        withAnimation(.snappy) { picked = oi }
        let ok = oi == q.answer
        answers.append((q.id, ok))
        UINotificationFeedbackGenerator().notificationOccurred(ok ? .success : .error)
    }

    private func explain(_ q: QuestionBank.Question) async {
        guard let picked else { return }
        explaining = true
        defer { explaining = false }
        let at = index
        let prompt = """
        I'm practising a theory question.
        Question: \(q.q)
        Options: \(q.options.joined(separator: " | "))
        Correct answer: \(q.options[q.answer])
        I chose: \(q.options[picked])
        The app's explanation: \(q.explain)

        Explain it another way in under 120 words, with a simple way to remember it\(picked != q.answer ? ", and why my choice is wrong" : "").
        """
        do {
            _ = try await API.shared.stream("flight/ask", body: ["messages": [["role": "user", "content": prompt]], "context": model.askContext]) { text in
                more[at] = text
            }
        } catch {
            more[at] = error.localizedDescription
            if (error as? APIError)?.status == 402 { model.upgrade(error.localizedDescription) }
        }
    }

    // MARK: Result

    private var missed: [QuestionBank.Question] {
        answers.filter { !$0.ok }.compactMap { a in session.questions.first { $0.id == a.id } }
    }

    @ViewBuilder
    private var result: some View {
        let pm = model.passMark
        let pass = resultScore >= pm
        Text(session.kind == .mock ? "Mock exam result" : session.kind == .review ? "Review done" : "Session complete")
            .font(Theme.display(34)).tracking(-1)
        Text("\(right) of \(answers.count) correct · exam readiness now \(readinessAfter)%.")
            .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
        Tile {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text("\(resultScore)%").font(Theme.display(64)).tracking(-2)
                    .foregroundStyle(session.kind == .mock ? (pass ? Theme.ok : Theme.danger) : Theme.ink)
                Text(session.kind == .mock ? (pass ? "At or above the \(pm)% pass mark" : "Below the \(pm)% pass mark") : "this session")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            }
        }
        if missed.isEmpty {
            Text("Everything right. Nice work.").font(.archivo(15)).foregroundStyle(Theme.ink2)
        } else {
            Tile {
                TileHead("Worth another look")
                ForEach(missed) { q in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(q.q).font(.archivo(15, .semibold))
                        Text("\(q.options[q.answer]). \(q.explain)").font(.archivo(14)).foregroundStyle(Theme.ink2)
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        Button { dismiss() } label: { Text("Back to subjects") }
            .primaryStyle()
    }

    private func finish(early: Bool) async {
        var st = StudyState(json: model.profile?.study)
        st.record(answers)
        resultScore = Int((Double(right) / Double(max(1, answers.count)) * 100).rounded())
        if session.kind == .mock && !early { st.mocks.append((Day.todayISO, resultScore)) }
        if let bank = QuestionBank.shared?.pack(for: model.regime) { readinessAfter = st.readiness(bank.questions) }
        withAnimation { finished = true }
        try? await model.saveProfile(["study": st.json()])
    }
}
