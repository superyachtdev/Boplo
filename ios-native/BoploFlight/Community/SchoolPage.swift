import SwiftUI

/// Flight school: join with a code; students see their school and messages; instructors see the roster and invite codes.
/// School plans are bought on the website, not in the app.
struct SchoolPage: View {
    @Environment(AppModel.self) private var model
    @State private var school: [String: Any]?
    @State private var loaded = false
    @State private var code = ""
    @State private var lookup: [String: Any]?
    @State private var error: String?
    @State private var busy = false
    @State private var confirmLeave = false

    private var role: String { school?["role"] as? String ?? "" }

    var body: some View {
        Page(title: school?["name"] as? String ?? "Flight school", subtitle: school == nil ? "Join your school with its code." : role == "student" ? "Your flight school on Boplo." : nil) {
            if !loaded {
                Tile { ProgressView().frame(maxWidth: .infinity) }
            } else if school == nil {
                joinTile
            } else if role == "student" {
                StudentSchoolView(school: school!) { confirmLeave = true }
            } else {
                StaffSchoolView(school: school!)
            }
            ErrorText(text: error)
        }
        .task { await load() }
        .refreshable { await load() }
        .alert("Leave \(school?["name"] as? String ?? "your school")?", isPresented: $confirmLeave) {
            Button("Leave school", role: .destructive) { Task { await leave() } }
            Button("Stay", role: .cancel) {}
        } message: { Text("Your instructors will stop seeing your training. Your desk moves to Free unless you have your own plan. You can rejoin later with the school’s code.") }
        .sheet(isPresented: Binding(get: { lookup != nil }, set: { if !$0 { lookup = nil } })) { joinSheet }
    }

    private var joinTile: some View {
        Tile(spacing: 12) {
            TileHead("Join your school")
            Text("Your school gives you a code. Joining gives you Advanced, paid for by your school.")
                .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            Labeled(label: "School code") {
                TextField("e.g. K7PX4M2Q", text: $code).textInputAutocapitalization(.characters).autocorrectionDisabled().boploField(font: .archivo(18, .semibold))
            }
            Button { Task { await find() } } label: { HStack { if busy { ProgressView() }; Text("Join school") } }
                .buttonStyle(.pill(.ink, height: 46))
                .disabled(busy || code.trimmingCharacters(in: .whitespaces).isEmpty)
        }
    }

    private static let shared = "your name and email, flights and hours, lesson notes and debriefs, syllabus progress, exam dates and scores, and your next lesson. They can debrief your flights, set your next lesson and sign off syllabus lessons, but they can’t change your flights or notes"

    private var joinSheet: some View {
        let info = lookup ?? [:]
        let name = info["name"] as? String ?? "this school"
        let staff = info["role"] as? String == "instructor"
        let active = info["active"] as? Bool ?? false
        return NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Join \(name)\(staff ? " as an instructor" : "")?").font(Theme.display(30)).fixedSize(horizontal: false, vertical: true)
                    if staff {
                        Text("You’ll see the school’s students on Boplo: their hours, progress and next lessons. Your own desk gets Advanced, paid for by \(name).").font(.archivo(15))
                    } else {
                        Text("You get Boplo Advanced, paid for by \(name).").font(.archivo(15))
                        Text("\(name)’s instructors will be able to see \(Self.shared). You can leave the school at any time.")
                            .font(.archivo(14)).padding(12).background(Theme.electric.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    if !active {
                        Text("\(name)’s plan isn’t active right now, so you can’t join yet.").font(.archivo(14)).padding(12)
                            .background(Color(hex: 0xF5A623).opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    ErrorText(text: error)
                    Button { Task { await join() } } label: { HStack { if busy { ProgressView().tint(.white) }; Text("Join school") } }
                        .primaryStyle().disabled(!active || busy)
                }
                .padding(20)
            }
            .background(Theme.cloud.ignoresSafeArea())
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Not now") { lookup = nil } } }
        }
        .presentationDetents([.medium, .large])
    }

    private func load() async {
        do { school = (try await API.shared.object("flight/school"))["school"] as? [String: Any] } catch { self.error = error.localizedDescription }
        loaded = true
    }

    private func find() async {
        busy = true; error = nil
        defer { busy = false }
        do { lookup = try JSONSerialization.jsonObject(with: try await API.shared.send("flight/school/lookup", method: "POST", body: ["code": code.trimmingCharacters(in: .whitespaces)])) as? [String: Any] }
        catch { self.error = error.localizedDescription }
    }

    private func join() async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let r = try JSONSerialization.jsonObject(with: try await API.shared.send("flight/school/join", method: "POST", body: ["code": code.trimmingCharacters(in: .whitespaces)])) as? [String: Any]
            school = r?["school"] as? [String: Any]
            lookup = nil; code = ""
            await model.refresh()
        } catch { self.error = error.localizedDescription }
    }

    private func leave() async {
        do {
            let r = try JSONSerialization.jsonObject(with: try await API.shared.send("flight/school/leave", method: "POST", body: [:])) as? [String: Any]
            school = r?["school"] as? [String: Any]
            await model.refresh()
        } catch { self.error = error.localizedDescription }
    }
}

/// A student's view: plan status, messages with instructors, and what's shared.
struct StudentSchoolView: View {
    let school: [String: Any]
    var onLeave: () -> Void
    @State private var items: [[String: Any]] = []
    @State private var draft = ""
    @State private var error: String?
    @State private var sending = false

    var body: some View {
        let name = school["name"] as? String ?? "Your school"
        let active = school["active"] as? Bool ?? false
        DarkTile(spacing: 10) {
            Text(active ? "Covered by your school" : "Plan not active").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ice)
            Text(active ? "Advanced, paid for by \(name)" : "\(name)’s plan has lapsed").font(Theme.display(28)).fixedSize(horizontal: false, vertical: true)
            Text(active ? "Everything in Advanced is unlocked while you’re a member." : "You’re on Free until your school renews. Your records are all still here.")
                .font(.archivo(14.5)).foregroundStyle(Theme.mist)
        }
        if active {
            Tile(spacing: 10) {
                TileHead("You and your instructors")
                Text("Debriefs, lesson plans and sign-offs from \(name) land here. Message your instructors any time.").font(.archivo(14)).foregroundStyle(Theme.ink3)
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in CoachItem(item: it, canReport: true) }
                ErrorText(text: error)
                HStack(alignment: .bottom, spacing: 8) {
                    TextField("Ask your instructor something, or tell them how it’s going…", text: $draft, axis: .vertical).lineLimit(1...5).padding(.vertical, 12).boploField()
                    Button { Task { await send() } } label: {
                        Image(systemName: "arrow.up").font(.system(size: 15, weight: .bold)).foregroundStyle(.white).frame(width: 44, height: 44)
                            .background(draft.trimmingCharacters(in: .whitespaces).isEmpty ? Theme.mist : Theme.electric, in: Circle())
                    }
                    .disabled(sending || draft.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .task { await load() }
        }
        Tile(spacing: 10) {
            TileHead("What your instructors can see")
            Text("While you’re a member, \(name)’s instructors can see your name and email, flights and hours, lesson notes and debriefs, syllabus progress, exam dates and scores, and your next lesson.")
                .font(.archivo(14.5))
            Text("Leaving stops sharing straight away. You keep all your records, and your desk moves to Free unless you have your own plan.").font(.archivo(13.5)).foregroundStyle(Theme.ink3)
            Button("Leave \(name)", action: onLeave).buttonStyle(.pill(.line, height: 42))
        }
    }

    private func load() async {
        do { items = (try await API.shared.object("flight/coach"))["items"] as? [[String: Any]] ?? [] } catch { self.error = error.localizedDescription }
    }

    private func send() async {
        sending = true
        defer { sending = false }
        do {
            let r = try JSONSerialization.jsonObject(with: try await API.shared.send("flight/coach/msg", method: "POST", body: ["text": draft])) as? [String: Any]
            if let item = r?["item"] as? [String: Any] { items.append(item) }
            draft = ""
        } catch { self.error = error.localizedDescription }
    }
}

/// One entry in the coaching thread: message, debrief, lesson plan or sign-off.
struct CoachItem: View {
    let item: [String: Any]
    /// Students can report a message from staff (App Store guideline 1.2).
    var canReport = false
    @State private var confirm = false
    @State private var reported = false
    @State private var error: String?

    var body: some View {
        let staff = item["fromStaff"] as? Bool ?? false
        let kind = item["kind"] as? String ?? "msg"
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(item["author"] as? String ?? "").font(.archivo(13, .semibold))
                Text(kind == "debrief" ? "Debrief" : kind == "plan" ? "Lesson plan" : kind == "signoff" ? "Sign-off" : "").font(.archivo(12)).foregroundStyle(Theme.electric)
                Spacer()
                Text(PilotTag.ago(item["at"])).font(.archivo(11.5)).foregroundStyle(Theme.ink3)
                if canReport && (item["fromStaff"] as? Bool ?? false), let id = item["id"] as? String {
                    Menu {
                        Button(reported ? "Reported" : "Report this message", systemImage: "flag") { confirm = true }.disabled(reported)
                    } label: {
                        Image(systemName: "ellipsis").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.ink3).frame(width: 28, height: 22)
                    }
                    .accessibilityLabel("More")
                    .confirmationDialog("Report this message?", isPresented: $confirm, titleVisibility: .visible) {
                        Button("Report", role: .destructive) { Task { await report(id) } }
                    } message: { Text("Boplo reviews reported messages within 24 hours. Your school isn’t told who reported it.") }
                }
            }
            switch kind {
            case "debrief":
                if let w = item["wentWell"] as? String, !w.isEmpty { Text("Went well: \(w)").font(.archivo(14)) }
                if let w = item["workOn"] as? String, !w.isEmpty { Text("Work on: \(w)").font(.archivo(14)) }
            case "plan":
                Text([item["lesson"] as? String, (item["date"] as? String).map { Day.short($0) }].compactMap { $0 }.joined(separator: " · ")).font(.archivo(14, .semibold))
                ForEach(Array(((item["prep"] as? [String]) ?? []).enumerated()), id: \.offset) { _, p in Text("• \(p)").font(.archivo(14)) }
                if let n = item["note"] as? String, !n.isEmpty { Text(n).font(.archivo(14)).foregroundStyle(Theme.ink2) }
            case "signoff":
                Text("\(item["itemName"] as? String ?? "") · \(item["status"] as? String == "d" ? "signed off" : "in progress")").font(.archivo(14))
            default:
                Text(item["text"] as? String ?? "").font(.archivo(14.5))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(staff ? Theme.well : Theme.electric.opacity(0.07), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .bottomTrailing) {
            if reported { Text("Reported").font(.archivo(11, .semibold)).foregroundStyle(Theme.ink3).padding(8) }
            else if let error { Text(error).font(.archivo(11)).foregroundStyle(Theme.danger).padding(8) }
        }
    }

    private func report(_ id: String) async {
        do {
            try await API.shared.send("flight/coach/report", method: "POST", body: ["id": id, "reason": "reported"])
            reported = true
            Haptic.tap(.light, 0.6)
        } catch { self.error = error.localizedDescription }
    }
}

/// Instructors and school admins: invite codes, at-a-glance numbers and the roster.
struct StaffSchoolView: View {
    let school: [String: Any]
    @State private var roster: [[String: Any]]?
    @State private var filter = "all"
    @State private var error: String?
    @State private var copied = false

    private func n(_ k: String) -> Int { (school[k] as? NSNumber)?.intValue ?? 0 }
    private func days(_ iso: String?) -> Int? { Day.daysUntil(iso).map { -$0 } }

    private struct Row: Identifiable {
        let id: String, name: String, role: String, email: String
        let minutes: Int, solo: Int, recent: Int
        let quiet: Int?, flag: String, waiting: Bool, unread: Int, toDebrief: Int
        let licence: String, nextLesson: String, lessonDate: String, goal: Int, goalPct: Int
    }

    private var rows: [Row] {
        (roster ?? []).map { m in
            let role = m["role"] as? String ?? "student"
            let minutes = (m["minutes"] as? NSNumber)?.intValue ?? 0
            let goal = (m["goalHours"] as? NSNumber)?.intValue ?? 45
            let quiet = days(m["lastFlight"] as? String)
            let flights = (m["flights"] as? NSNumber)?.intValue ?? 0
            let joined = ((m["joinedAt"] as? NSNumber)?.doubleValue ?? 0) / 1000
            var flag = ""
            if role == "student" {
                if m["setup"] as? Bool == false { flag = "Hasn’t set up Boplo yet" }
                else if flights == 0 { flag = Date().timeIntervalSince1970 - joined > 7 * 86400 ? "No flights logged yet" : "" }
                else if let q = quiet, q > 21 { flag = "Hasn’t flown in \(q) days" }
            }
            let unread = (m["unread"] as? NSNumber)?.intValue ?? 0, deb = (m["toDebrief"] as? NSNumber)?.intValue ?? 0
            return Row(id: m["id"] as? String ?? UUID().uuidString, name: m["name"] as? String ?? "", role: role, email: m["email"] as? String ?? "",
                       minutes: minutes, solo: (m["soloMinutes"] as? NSNumber)?.intValue ?? 0, recent: (m["recentMinutes"] as? NSNumber)?.intValue ?? 0,
                       quiet: quiet, flag: flag, waiting: role == "student" && unread + deb > 0, unread: unread, toDebrief: deb,
                       licence: [m["licence"] as? String, m["authority"] as? String].compactMap { $0 }.joined(separator: " · "),
                       nextLesson: m["nextLesson"] as? String ?? "", lessonDate: m["lessonDate"] as? String ?? "", goal: goal,
                       goalPct: goal > 0 ? min(100, Int(Double(minutes) / 60 / Double(goal) * 100)) : 0)
        }
    }

    var body: some View {
        let all = rows
        let students = all.filter { $0.role == "student" }, staff = all.filter { $0.role != "student" }
        let flagged = students.filter { !$0.flag.isEmpty }, waiting = students.filter(\.waiting)
        let active14 = students.filter { ($0.quiet ?? 9999) <= 14 }.count
        let list: [Row] = (filter == "staff" ? staff : filter == "attention" ? flagged : filter == "waiting" ? waiting : students)
            .sorted { a, b in
                if filter == "staff" { return a.name < b.name }
                if a.waiting != b.waiting { return a.waiting }
                if a.flag.isEmpty != b.flag.isEmpty { return !a.flag.isEmpty }
                return (a.quiet ?? 9999) > (b.quiet ?? 9999)
            }
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 8), GridItem(.flexible(), spacing: 8)], spacing: 8) {
            box("Students", "\(n("students"))", "of \(n("seats")) · \(plural(n("staff"), "instructor"))")
            box("Flew in 14 days", "\(active14)", students.isEmpty ? "No students yet" : "\(Int(Double(active14) / Double(students.count) * 100))% of students")
            box("Need a nudge", "\(flagged.count)", "Quiet 3+ weeks, or not started")
            box("Hours, 30 days", decimalHours(students.reduce(0) { $0 + $1.recent }), "Logged by your students")
        }
        Tile(spacing: 12) {
            TileHead("Invite students")
            Text("Students join with this code or link and get Advanced straight away. They see exactly what’s shared before they join, and can leave any time.")
                .font(.archivo(13.5)).foregroundStyle(Theme.ink3)
            Text(school["studentCode"] as? String ?? "").font(.system(size: 30, weight: .bold, design: .monospaced)).tracking(4).textSelection(.enabled)
            HStack(spacing: 8) {
                if let link = school["studentLink"] as? String, let url = URL(string: link) {
                    ShareLink(item: url, message: Text("Join \(school["name"] as? String ?? "our school") on Boplo Flight. Your school covers Advanced.")) { Text("Share student link") }
                        .buttonStyle(.pill(.blue, height: 40))
                    Button(copied ? "Copied" : "Copy") { UIPasteboard.general.string = link; copied = true }.buttonStyle(.pill(.line, height: 40))
                }
            }
            Divider().overlay(Theme.hair)
            Text("Instructor code").font(.archivo(14, .semibold))
            Text(school["staffCode"] as? String ?? "").font(.system(size: 20, weight: .bold, design: .monospaced)).tracking(3).textSelection(.enabled)
        }
        Tile(spacing: 12) {
            TileHead("Students")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach([("all", "All \(students.count)"), ("waiting", "Waiting on you \(waiting.count)"), ("attention", "Need a nudge \(flagged.count)"), ("staff", "Instructors \(staff.count)")], id: \.0) { id, label in
                        Button { filter = id } label: {
                            Text(label).font(.archivo(13, .semibold)).padding(.horizontal, 12).frame(height: 32)
                                .foregroundStyle(filter == id ? .white : Theme.ink2).background(filter == id ? Theme.ink : Theme.ink.opacity(0.06), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            if let error { ErrorText(text: error) }
            else if roster == nil { ProgressView().frame(maxWidth: .infinity) }
            else if list.isEmpty {
                Text(filter == "attention" ? "Everyone’s flying." : filter == "waiting" ? "You’re all caught up." : filter == "staff" ? "No other instructors yet." : "No students yet. Share your student code or link, and students appear here as they join.")
                    .font(.archivo(14.5)).foregroundStyle(Theme.ink3)
            }
            ForEach(list) { r in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(r.name).font(.archivo(15.5, .semibold))
                        Spacer()
                        if r.role == "student" { Text("\(decimalHours(r.minutes)) h").font(.archivo(15, .semibold)).monospacedDigit() }
                    }
                    if r.role != "student" {
                        Text(r.email + (r.role == "admin" ? " · manages the plan" : "")).font(.archivo(13)).foregroundStyle(Theme.ink3)
                    } else {
                        if r.waiting {
                            Text([r.unread > 0 ? "\(r.unread) new message\(r.unread == 1 ? "" : "s")" : nil, r.toDebrief > 0 ? "\(r.toDebrief) to debrief" : nil].compactMap { $0 }.joined(separator: " · "))
                                .font(.archivo(12.5, .semibold)).foregroundStyle(Theme.electric)
                        }
                        Text(!r.flag.isEmpty ? r.flag : r.licence).font(.archivo(13)).foregroundStyle(r.flag.isEmpty ? Theme.ink3 : Theme.danger)
                        HStack(spacing: 8) {
                            Bar(value: Double(r.goalPct) / 100, height: 5).frame(width: 90)
                            Text("\(r.goalPct)% of \(r.goal) h · last flew \(r.quiet.map { $0 <= 0 ? "today" : $0 == 1 ? "yesterday" : "\($0) days ago" } ?? "—")")
                                .font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                        }
                        if !r.nextLesson.isEmpty { Text("Next: \(r.nextLesson)\(r.lessonDate.isEmpty ? "" : " · \(Day.short(r.lessonDate))")").font(.archivo(12.5)).foregroundStyle(Theme.ink2) }
                    }
                }
                .padding(.vertical, 6)
                Divider().overlay(Theme.hair)
            }
            Footnote(text: "Debriefs, lesson plans and sign-offs for each student are on the school dashboard at boplo.app.")
        }
        .task { await load() }
    }

    private func box(_ k: String, _ v: String, _ note: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(k).font(.archivo(12.5)).foregroundStyle(Theme.ink3)
            Text(v).font(.archivo(24, .semibold)).monospacedDigit()
            Text(note).font(.archivo(11.5)).foregroundStyle(Theme.ink3).lineLimit(2)
        }
        .padding(14).frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
        .background(Theme.paper, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Theme.hair))
    }

    private func load() async {
        do { roster = (try await API.shared.object("flight/school/roster"))["members"] as? [[String: Any]] ?? [] } catch { self.error = error.localizedDescription }
    }
}
