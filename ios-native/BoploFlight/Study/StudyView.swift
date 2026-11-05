import SwiftUI

/// Study tab: theory practice with spaced repetition, plus the training tools (progress, prepare, budget, radio, currency, Ask).
struct StudyView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()
    @State private var session: QuizSession?

    private var bank: QuestionBank.Pack? { QuestionBank.shared?.pack(for: model.regime) }
    private var state: StudyState { StudyState(json: model.profile?.study) }

    var body: some View {
        NavigationStack(path: $path) {
            Page(title: "Study") {
                ChipRow(items: [
                    .init(id: "study", label: "Study"), .init(id: "ask", label: "Ask Boplo"), .init(id: "progress", label: "Progress"),
                    .init(id: "prepare", label: "Prepare"), .init(id: "radio", label: "Radio"), .init(id: "currency", label: "Currency"),
                    .init(id: "budget", label: "Budget")
                ], selected: "study") { id in
                    switch id {
                    case "ask": path.append(Route.ask)
                    case "prepare": path.append(Route.prepare)
                    case "progress": path.append(Route.web(.progress))
                    case "radio": path.append(Route.web(.radio))
                    case "currency": path.append(Route.web(.currency))
                    case "budget": path.append(Route.web(.budget))
                    default: break
                    }
                }
                if !model.isAdvanced {
                    locked
                } else if let bank {
                    practice(bank)
                } else {
                    Tile { Text("Questions didn’t load. Restart the app to try again.").font(.archivo(15)) }
                }
                askTile
            }
            .logFlightButton(model)
            .boploDestinations()
            .fullScreenCover(item: $session) { s in
                QuizView(session: s)
            }
        }
    }

    // MARK: Free plan

    private var locked: some View {
        DarkTile {
            Text("Advanced").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
            Text("Practise for your theory exams.").font(Theme.display(32)).tracking(-1).fixedSize(horizontal: false, vertical: true)
            Text("Practice questions by subject, weakest first, and timed mock exams with your authority’s pass mark.")
                .font(.archivo(15)).foregroundStyle(Theme.mist)
            Button { model.upgrade("Study is part of Advanced.") } label: { Text("Upgrade to Advanced") }
                .buttonStyle(.pill(.light, height: 48, spark: true))
        }
    }

    // MARK: Practice

    @ViewBuilder
    private func practice(_ bank: QuestionBank.Pack) -> some View {
        let st = state
        let qs = bank.questions
        let due = st.dueQuestions(qs).count
        let fresh = qs.filter { st.records[$0.id] == nil }.count
        let ready = st.readiness(qs)
        let pm = model.passMark

        Button { start(.mock, bank) } label: { Text("Start a mock exam") }
            .buttonStyle(.pill(.blue, height: 48, spark: true))

        let reviewer: String? = QuestionBank.shared?.reviewed?.by
        Text(reviewer != nil ? "Reviewed by \(reviewer!). " : "Early-access question bank. Original questions written for Boplo, awaiting review by a flight instructor. ")
            .font(.archivo(13.5, .semibold)) + Text("Use them for practice alongside your official study material, not instead of it.").font(.archivo(13.5)).foregroundColor(Theme.ink2)

        DarkTile {
            HStack(alignment: .center, spacing: 18) {
                Ring(progress: Double(ready) / 100, size: 96, lineWidth: 9, track: Theme.ice.opacity(0.16), fill: Theme.ice) {
                    Text("\(ready)%").font(Theme.display(24)).foregroundStyle(.white)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text("Exam readiness").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ice)
                    Text(StudyState.readyLabel(ready)).font(.archivo(14.5, .medium)).foregroundStyle(Theme.mist)
                }
            }
            Text(due > 0 ? "\(plural(due, "question")) due for review" : fresh > 0 ? "Nothing due. Learn something new." : "All caught up.")
                .font(Theme.display(28)).tracking(-0.8).fixedSize(horizontal: false, vertical: true)
            Text("Questions you get right come back after longer and longer gaps; ones you miss come back tomorrow. A few minutes a day is how it sticks.")
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
            Button { start(.review, bank) } label: { Text(due > 0 ? "Start today’s review" : "Learn 10 new") }
                .buttonStyle(.pill(.light, height: 48, spark: true))
                .disabled(due == 0 && fresh == 0)
        }

        ForEach(bank.subjects) { s in
            let score = st.score(qs, subject: s.id)
            let readyS = st.readiness(qs, subject: s.id)
            let seen = qs.filter { $0.subject == s.id && st.records[$0.id] != nil }.count
            Button { start(.subject(s.id), bank) } label: {
                Tile(spacing: 10) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(s.name).font(.archivo(17, .semibold)).foregroundStyle(Theme.ink)
                        Spacer()
                        if let score { Chip(text: "\(score)%", tone: score >= pm ? .ok : .bad) } else { Chip(text: "\(s.count) questions") }
                    }
                    Text(s.blurb).font(.archivo(14)).foregroundStyle(Theme.ink3).multilineTextAlignment(.leading)
                    Bar(value: Double(readyS) / 100, height: 5)
                    Text("\(readyS)% ready · \(seen) of \(s.count) practised").font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                }
            }
            .buttonStyle(.plain)
        }

        let weakest = bank.subjects.compactMap { s -> (QuestionBank.Subject, Int)? in
            guard let sc = st.score(qs, subject: s.id), sc < pm else { return nil }
            return (s, sc)
        }.sorted { $0.1 < $1.1 }
        Tile {
            TileHead("Focus next")
            if weakest.isEmpty {
                Text(st.records.isEmpty ? "Practise a subject and the ones that need work show up here." : "Every subject you’ve practised is at or above the \(pm)% pass mark.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            } else {
                ForEach(Array(weakest.prefix(3)), id: \.0.id) { s, sc in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack { Text(s.name).font(.archivo(14.5)); Spacer(); Text("\(sc)%").font(.archivo(14.5, .semibold)) }
                        Bar(value: Double(sc) / 100, height: 6)
                    }
                }
                Button { start(.subject(weakest[0].0.id), bank) } label: { Text("Practise \(weakest[0].0.name)") }
                    .buttonStyle(.pill(.ink, height: 40))
            }
        }

        Tile {
            TileHead(title: "Mock exams") { Chip(text: "Pass mark \(pm)%") }
            if st.mocks.isEmpty {
                Text("16 mixed questions across all subjects, scored against the pass mark your authority uses.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            } else {
                ForEach(Array(st.mocks.suffix(5).reversed().enumerated()), id: \.offset) { _, m in
                    HStack {
                        Text(Day.dayMonth(m.d)).font(.archivo(14.5)).foregroundStyle(Theme.ink2)
                        Spacer()
                        Text("\(m.s)% \(m.s >= pm ? "pass" : "below pass")").font(.archivo(14.5, .semibold)).foregroundStyle(m.s >= pm ? Theme.ok : Theme.danger)
                    }
                }
            }
        }
    }

    private var askTile: some View {
        VStack(spacing: 0) {
            NavigationLink(value: Route.ask) { MenuRow(icon: "sparkle", title: "Ask Boplo", subtitle: "Your aviation study assistant") }
            Divider().overlay(Theme.hair).padding(.leading, 58)
            NavigationLink(value: Route.web(.checkride)) { MenuRow(icon: WebFeature.checkride.icon, title: WebFeature.checkride.title, subtitle: WebFeature.checkride.subtitle) }
            Divider().overlay(Theme.hair).padding(.leading, 58)
            NavigationLink(value: Route.web(.radio)) { MenuRow(icon: WebFeature.radio.icon, title: WebFeature.radio.title, subtitle: WebFeature.radio.subtitle) }
        }
        .buttonStyle(.plain)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous).strokeBorder(Theme.hair))
    }

    // MARK: Sessions

    private func start(_ kind: QuizSession.Kind, _ bank: QuestionBank.Pack) {
        let st = state
        var qs: [QuestionBank.Question]
        switch kind {
        case .review:
            let due = st.dueQuestions(bank.questions).sorted { (StudyState.due(st.records[$0.id]) ?? 0) < (StudyState.due(st.records[$1.id]) ?? 0) }.prefix(15)
            let fresh = bank.questions.filter { st.records[$0.id] == nil }.shuffled().prefix(max(0, 10 - due.count))
            qs = Array(due + fresh).shuffled()
        case .mock:
            qs = Array(bank.questions.shuffled().prefix(16))
        case .subject(let id):
            func weight(_ q: QuestionBank.Question) -> Double {
                guard let r = st.records[q.id], r[1] > 0 else { return -1 }
                return Double(r[0]) / Double(r[1])
            }
            qs = Array(bank.questions.filter { $0.subject == id }
                .map { ($0, weight($0) + Double.random(in: 0..<0.35)) }
                .sorted { $0.1 < $1.1 }.map(\.0).prefix(10))
        }
        guard !qs.isEmpty else { return }
        let title: String = {
            switch kind {
            case .mock: return "Mock exam"
            case .review: return "Daily review"
            case .subject(let id): return bank.subjects.first { $0.id == id }?.name ?? "Practice"
            }
        }()
        session = QuizSession(kind: kind, title: title, questions: qs, subjects: bank.subjects)
    }
}

struct QuizSession: Identifiable {
    enum Kind: Equatable { case review, mock, subject(String) }
    let id = UUID()
    let kind: Kind
    let title: String
    let questions: [QuestionBank.Question]
    let subjects: [QuestionBank.Subject]
}
