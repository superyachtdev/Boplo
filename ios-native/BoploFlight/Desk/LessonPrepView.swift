import SwiftUI

/// The next lesson: what it is, when, and the questions to ask the instructor.
struct LessonPrepView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var lesson = ""
    @State private var hasDate = false
    @State private var date = Date()
    @State private var hasTime = false
    @State private var time = Date()
    @State private var questions = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Next lesson") {
                    TextField("e.g. Lesson 6 · Stalls", text: $lesson)
                    Toggle("Date", isOn: $hasDate.animation())
                    if hasDate {
                        DatePicker("Day", selection: $date, displayedComponents: .date)
                        Toggle("Time", isOn: $hasTime.animation())
                        if hasTime { DatePicker("Start", selection: $time, displayedComponents: .hourAndMinute) }
                    }
                }
                Section {
                    TextField("What do you want to ask your instructor?", text: $questions, axis: .vertical)
                        .lineLimit(4...10)
                } header: { Text("Questions for your instructor") } footer: {
                    Text("Write them the night before. You’ll remember them in the briefing.")
                }
                Section { ErrorText(text: error) }
            }
            .navigationTitle("Prepare")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(busy ? "Saving…" : "Save") { Task { await save() } }.disabled(busy)
                }
            }
        }
        .onAppear(perform: load)
    }

    private func load() {
        let p = model.profile
        lesson = p?.nextLesson ?? ""
        questions = p?.questions ?? ""
        if let d = p?.lessonDate, let parsed = Flight.dayFormat.date(from: d) {
            hasDate = true
            // shown in the user's calendar, stored as a plain date
            var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!
            date = Calendar.current.date(from: c.dateComponents([.year, .month, .day], from: parsed)) ?? Date()
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
                "questions": questions
            ])
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
