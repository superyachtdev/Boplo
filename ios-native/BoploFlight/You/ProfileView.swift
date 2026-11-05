import SwiftUI

/// Profile: training, flying and costs, the same fields as the web profile page.
struct ProfileView: View {
    @Environment(AppModel.self) private var model

    @State private var name = ""
    @State private var licence = ""
    @State private var authority = ""
    @State private var hasTarget = false
    @State private var target = Date()
    @State private var goal = ""
    @State private var airport = ""
    @State private var school = ""
    @State private var aircraft = ""
    @State private var registration = ""
    @State private var frequency = "Still deciding"
    @State private var topics = ""
    @State private var opening = ""
    @State private var currency = "USD"
    @State private var rateAircraft = ""
    @State private var rateInstructor = ""
    @State private var reminders = false
    @State private var busy = false
    @State private var saved = false
    @State private var error: String?
    @State private var loaded = false

    private static let frequencies = ["Twice a week", "Weekly", "Monthly", "Intensive course", "Still deciding"]
    private static let currencies = ["USD", "GBP", "EUR", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK", "ZAR"]

    var body: some View {
        Page(title: "Profile", subtitle: model.workspace?.user.email.map { "Signed in as \($0)" }) {
            Tile {
                TileHead("You and your training")
                Labeled(label: "Your name") { TextField("Name", text: $name).textContentType(.name).boploField() }
                Labeled(label: "Licence") {
                    Menu {
                        Picker("Licence", selection: $licence) {
                            ForEach(SetupView.licences(for: model.regime), id: \.id) { Text($0.label).tag($0.id) }
                            if !SetupView.licences(for: model.regime).contains(where: { $0.id == licence }) && !licence.isEmpty { Text(licence).tag(licence) }
                        }
                    } label: { menuLabel(licence.isEmpty ? "Choose" : licence) }
                }
                .onChange(of: licence) { old, new in
                    if old != "" , let l = SetupView.licences(for: model.regime).first(where: { $0.id == new }) { goal = "\(l.hours)" }
                }
                Labeled(label: "Licensing authority") { TextField("e.g. UK CAA", text: $authority).boploField() }
                HStack(spacing: 10) {
                    Labeled(label: "Hours goal") { TextField("40", text: $goal).keyboardType(.numberPad).boploField() }
                    Labeled(label: "Hours before Boplo") { TextField("0", text: $opening).keyboardType(.decimalPad).boploField() }
                }
                Toggle(isOn: $hasTarget.animation()) { Text("Target date").font(.archivo(15, .medium)) }
                if hasTarget { DatePicker("Licence by", selection: $target, displayedComponents: .date).font(.archivo(15)) }
                Labeled(label: "Home airfield") { TextField("e.g. EGHP · Popham", text: $airport).boploField() }
                Labeled(label: "School or club") { TextField("Optional", text: $school).boploField() }
            }
            Tile {
                TileHead("Flying")
                Labeled(label: "Aircraft type") { TextField("e.g. PA-28 Warrior", text: $aircraft).boploField() }
                Labeled(label: "Registration") { TextField("e.g. G-BOPL", text: $registration).textInputAutocapitalization(.characters).boploField() }
                Labeled(label: "How often you fly") {
                    Menu {
                        Picker("How often you fly", selection: $frequency) { ForEach(Self.frequencies, id: \.self) { Text($0).tag($0) } }
                    } label: { menuLabel(frequency) }
                }
                Labeled(label: "Theory to revisit") { TextField("e.g. Air law, navigation", text: $topics).boploField() }
                Toggle(isOn: $reminders) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Email reminders").font(.archivo(15, .medium))
                        Text("When it’s been a while, and the day before a lesson.").font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                    }
                }
            }
            Tile {
                TileHead("Costs")
                Labeled(label: "Currency") {
                    Menu {
                        Picker("Currency", selection: $currency) { ForEach(Self.currencies, id: \.self) { Text($0).tag($0) } }
                    } label: { menuLabel(currency) }
                }
                HStack(spacing: 10) {
                    Labeled(label: "Aircraft, per hour") { TextField("0", text: $rateAircraft).keyboardType(.decimalPad).boploField() }
                    Labeled(label: "Instructor, per hour") { TextField("0", text: $rateInstructor).keyboardType(.decimalPad).boploField() }
                }
                Footnote(text: "Used by the budget to estimate what’s left. Rates stay private to you.")
            }
            ErrorText(text: error)
            Button { Task { await save() } } label: {
                HStack { if busy { ProgressView().tint(.white) }; Text(saved ? "Saved" : "Save profile") }
            }
            .primaryStyle()
            .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .onAppear(perform: load)
    }

    private func menuLabel(_ text: String) -> some View {
        HStack {
            Text(text).font(.archivo(16)).foregroundStyle(Theme.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3)
        }
        .boploField()
    }

    private func load() {
        guard !loaded else { return }
        loaded = true
        let p = model.profile
        let raw = model.rawProfile
        name = p?.name ?? ""
        licence = p?.licence ?? ""
        authority = p?.authority ?? ""
        if let d = Day.date(p?.target) {
            hasTarget = true
            var utc = Calendar(identifier: .gregorian); utc.timeZone = TimeZone(identifier: "UTC")!
            target = Calendar.current.date(from: utc.dateComponents([.year, .month, .day], from: d)) ?? Date()
        }
        goal = (p?.goalHours).map { "\(Int($0))" } ?? ""
        airport = p?.airport ?? ""
        school = p?.school ?? ""
        aircraft = p?.aircraft ?? ""
        registration = p?.registration ?? ""
        frequency = p?.frequency?.isEmpty == false ? p!.frequency! : "Still deciding"
        topics = raw["topics"] as? String ?? ""
        let om = (raw["openingMinutes"] as? NSNumber)?.doubleValue ?? 0
        opening = om > 0 ? String(format: "%.1f", om / 60) : ""
        currency = (raw["currency"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (model.regime == "faa" ? "USD" : model.regime == "uk" ? "GBP" : "EUR")
        rateAircraft = (raw["rateAircraft"] as? NSNumber).map { "\($0)" } ?? ""
        rateInstructor = (raw["rateInstructor"] as? NSNumber).map { "\($0)" } ?? ""
        reminders = p?.reminders == true
    }

    private func save() async {
        busy = true; error = nil
        defer { busy = false }
        func num(_ s: String) -> Double? { Double(s.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) }
        var changes: [String: Any] = [
            "name": name.trimmingCharacters(in: .whitespaces),
            "licence": licence,
            "authority": authority.trimmingCharacters(in: .whitespaces),
            "airport": airport.trimmingCharacters(in: .whitespaces),
            "school": school.trimmingCharacters(in: .whitespaces),
            "aircraft": aircraft.trimmingCharacters(in: .whitespaces),
            "registration": registration.trimmingCharacters(in: .whitespaces).uppercased(),
            "frequency": frequency,
            "topics": topics,
            "currency": currency,
            "reminders": reminders,
            "openingMinutes": max(0, Int(((num(opening) ?? 0) * 60).rounded()))
        ]
        if let g = num(goal) { changes["goalHours"] = Int(g) }
        if let r = num(rateAircraft) { changes["rateAircraft"] = r }
        if let r = num(rateInstructor) { changes["rateInstructor"] = r }
        if hasTarget {
            let c = Calendar.current.dateComponents([.year, .month, .day], from: target)
            changes["target"] = String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
        } else {
            changes["target"] = ""
        }
        do {
            try await model.saveProfile(changes)
            withAnimation { saved = true }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            withAnimation { saved = false }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
