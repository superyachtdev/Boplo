import SwiftUI

/// Notes and questions for the next lesson, the preparation checklist, and the last debriefs beside them.
struct PrepareView: View {
    @Environment(AppModel.self) private var model

    @State private var lesson = ""
    @State private var hasDate = false
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Calendar.current.date(bySettingHour: 9, minute: 0, second: 0, of: Date()) ?? Date()
    @State private var checks: [CheckItem] = []
    @State private var newItem = ""
    @State private var questions = ""
    @State private var notes = ""
    @State private var busy = false
    @State private var error: String?
    @State private var saved = false
    @State private var loaded = false

    var body: some View {
        Page(title: "Prepare", subtitle: "Your notes and questions for the next lesson, with the last debriefs beside them.") {
            Tile {
                TileHead("Next lesson")
                Labeled(label: "Lesson") {
                    TextField("e.g. Lesson 12 · Navigation", text: $lesson).boploField()
                }
                Toggle(isOn: $hasDate.animation()) { Text("Date").font(.archivo(15, .medium)) }
                if hasDate {
                    DatePicker("Lesson date", selection: $date, displayedComponents: .date)
                        .font(.archivo(15))
                    Toggle(isOn: $hasTime.animation()) { Text("Start time").font(.archivo(15, .medium)) }
                    if hasTime {
                        DatePicker("Start time", selection: $time, displayedComponents: .hourAndMinute).font(.archivo(15))
                    }
                }
            }
            Tile {
                TileHead(title: "Preparation checklist") {
                    if !checks.isEmpty { Chip(text: "\(checks.filter(\.done).count) of \(checks.count)") }
                }
                if checks.isEmpty {
                    Text("Nothing on the list yet.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                }
                ForEach($checks) { $item in
                    HStack(spacing: 12) {
                        Button { withAnimation(.snappy) { item.done.toggle() } } label: {
                            Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 22))
                                .foregroundStyle(item.done ? Theme.electric : Theme.mist)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(item.done ? "Prepared" : "Mark as prepared")
                        TextField("Item", text: $item.text, axis: .vertical)
                            .font(.archivo(15))
                            .strikethrough(item.done, color: Theme.ink3)
                            .foregroundStyle(item.done ? Theme.ink3 : Theme.ink)
                        Button { withAnimation { checks.removeAll { $0.id == item.id } } } label: {
                            Image(systemName: "xmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Remove item")
                    }
                    .padding(.vertical, 4)
                }
                HStack(spacing: 8) {
                    TextField("Add something to prepare", text: $newItem)
                        .submitLabel(.done)
                        .onSubmit(add)
                        .boploField()
                    Button("Add", action: add).buttonStyle(.pill(.line, height: 50))
                }
            }
            Tile {
                TileHead("Questions for your instructor")
                TextField("One question per line", text: $questions, axis: .vertical)
                    .lineLimit(3...10)
                    .padding(.vertical, 12)
                    .boploField()
                TileHead("Preparation notes")
                TextField("Anything you want to remember", text: $notes, axis: .vertical)
                    .lineLimit(3...10)
                    .padding(.vertical, 12)
                    .boploField()
            }
            ErrorText(text: error)
            Button { Task { await save() } } label: {
                HStack { if busy { ProgressView().tint(.white) }; Text(saved ? "Saved" : "Save preparation") }
            }
            .buttonStyle(.pill(.blue, height: 52, full: true, spark: true))
            .disabled(busy)
            recent
            HStack(spacing: 10) {
                NavigationLink(value: Route.web(.weather)) { Text("Check the weather") }.buttonStyle(.pill(.line, height: 42))
                NavigationLink(value: Route.web(.radio)) { Text("Practise radio") }.buttonStyle(.pill(.line, height: 42))
            }
        }
        .navigationTitle("Prepare")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: load)
    }

    private var recent: some View {
        let list = Array(model.sortedFlights.prefix(3))
        return Tile {
            TileHead("From your last flights")
            if list.isEmpty {
                Text("Debrief notes from your flights will show here.").font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            }
            ForEach(list) { f in
                VStack(alignment: .leading, spacing: 4) {
                    Text("\(Day.short(f.date)) · \(f.lesson?.isEmpty == false ? f.lesson! : "\(f.dep) → \(f.arr)")")
                        .font(.archivo(12.5, .medium)).foregroundStyle(Theme.ink3)
                    Text(f.notes?.isEmpty == false ? f.notes! : "No debrief notes for this flight.")
                        .font(.archivo(14.5))
                        .foregroundStyle(f.notes?.isEmpty == false ? Theme.ink : Theme.ink3)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Theme.well, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
    }

    private func add() {
        let t = newItem.trimmingCharacters(in: .whitespaces)
        guard !t.isEmpty else { return }
        withAnimation { checks.append(CheckItem(done: false, text: t)) }
        newItem = ""
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        let p = model.profile
        lesson = p?.nextLesson ?? ""
        questions = p?.questions ?? ""
        notes = p?.notes ?? ""
        checks = p?.checks ?? []
        if let d = Day.date(p?.lessonDate) {
            hasDate = true
            var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(identifier: "UTC")!
            date = Calendar.current.date(from: utc.dateComponents([.year, .month, .day], from: d)) ?? Date()
        }
        if let t = p?.lessonTime, t.count == 5 {
            let parts = t.split(separator: ":").compactMap { Int($0) }
            if parts.count == 2, let d = Calendar.current.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: Date()) {
                hasTime = true; time = d
            }
        }
    }

    private func save() async {
        busy = true; error = nil
        defer { busy = false }
        let day: String = {
            guard hasDate else { return "" }
            let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
            return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        }()
        let hhmm: String = {
            guard hasDate, hasTime else { return "" }
            let c = Calendar.current.dateComponents([.hour, .minute], from: time)
            return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
        }()
        do {
            try await model.saveProfile([
                "nextLesson": lesson.trimmingCharacters(in: .whitespaces),
                "lessonDate": day,
                "lessonTime": hhmm,
                "questions": questions,
                "notes": notes,
                "checklist": CheckItem.write(checks)
            ])
            withAnimation { saved = true }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            withAnimation { saved = false }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
