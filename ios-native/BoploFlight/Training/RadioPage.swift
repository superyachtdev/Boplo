import SwiftUI
import Speech
import AVFoundation

/// Radio practice: say a call out loud (on-device speech recognition) and Boplo checks every element.
struct RadioPage: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        let set = RadioScenarios(model)
        let best = model.json("radio")
        return Page(title: "Radio practice", subtitle: "Practise \(set.faa ? "FAA" : "UK and ICAO")-style calls out loud. Boplo listens and checks you included everything.") {
            if !model.isAdvanced {
                LockedTile(title: "Sound confident on the radio.", text: "Practise real scenarios with your own callsign. Boplo listens and checks every element of your call.", message: "Radio practice is part of Advanced.")
            } else {
                (Text("Practice scripts. ").font(.archivo(13.5, .semibold)) + Text("Phraseology varies between airfields and countries; follow your school and \(set.faa ? "the AIM" : "CAP 413 or your national phraseology guide"). Your callsign is ").font(.archivo(13.5)) + Text(set.callsign).font(.archivo(13.5, .semibold)) + Text(" (\(set.reg)). Change your registration in your profile.").font(.archivo(13.5)))
                    .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.electric.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                ForEach(set.scenarios) { s in
                    NavigationLink { RadioDrill(scenario: s) } label: {
                        Tile(spacing: 8) {
                            HStack(alignment: .firstTextBaseline) {
                                Text(s.title).font(.archivo(17, .semibold)).foregroundStyle(Theme.ink)
                                Spacer()
                                if let b = (best[s.id] as? NSNumber)?.intValue { Chip(text: "\(b)%", tone: b >= 100 ? .ok : .warn) }
                            }
                            Text(s.situation).font(.archivo(14)).foregroundStyle(Theme.ink3).multilineTextAlignment(.leading)
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .navigationTitle("Radio practice")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct RadioScenario: Identifiable {
    struct Element {
        let label: String
        let check: (String) -> Bool
    }
    let id: String
    let title: String
    let situation: String
    let atc: String
    let model: String
    var reply: String = ""
    let elements: [Element]
}

/// The web app's radioScenarios(), with the pilot's own callsign and airfield.
@MainActor
struct RadioScenarios {
    let scenarios: [RadioScenario]
    let callsign: String
    let reg: String
    let faa: Bool

    static let phon: [String: String] = ["alpha": "a", "alfa": "a", "bravo": "b", "charlie": "c", "delta": "d", "echo": "e", "foxtrot": "f", "golf": "g", "hotel": "h", "india": "i", "juliet": "j", "juliett": "j", "kilo": "k", "lima": "l", "mike": "m", "november": "n", "oscar": "o", "papa": "p", "quebec": "q", "romeo": "r", "sierra": "s", "tango": "t", "uniform": "u", "victor": "v", "whiskey": "w", "whisky": "w", "xray": "x", "yankee": "y", "zulu": "z", "zero": "0", "one": "1", "wun": "1", "two": "2", "three": "3", "tree": "3", "four": "4", "fower": "4", "five": "5", "fife": "5", "six": "6", "seven": "7", "eight": "8", "ait": "8", "nine": "9", "niner": "9", "thousand": "000", "hundred": "00", "decimal": ""]
    static let letters = Dictionary(uniqueKeysWithValues: "alpha bravo charlie delta echo foxtrot golf hotel india juliett kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey x-ray yankee zulu".split(separator: " ").map { (String($0.prefix(1)), $0.prefix(1).uppercased() + $0.dropFirst()) })
    static let digits = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Niner"]

    static func spell(_ s: String) -> String {
        s.uppercased().filter { $0.isLetter || $0.isNumber }.map { c -> String in
            if let d = c.wholeNumberValue { return digits[d] }
            return letters[String(c).lowercased()] ?? String(c)
        }.joined(separator: " ")
    }

    /// Spoken or typed call → compact form: "golf alpha bravo" → "gab", "two seven" → "27".
    static func compact(_ t: String) -> String {
        t.lowercased().replacingOccurrences(of: "x-ray", with: "xray")
            .components(separatedBy: CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789.").inverted)
            .filter { !$0.isEmpty }
            .map { phon[$0] ?? $0 }
            .joined()
            .replacingOccurrences(of: ".", with: "")
    }

    init(_ model: AppModel) {
        let p = model.profile
        faa = model.regime == "faa"
        let r = (p?.registration?.isEmpty == false ? p!.registration! : (faa ? "N123AB" : "G-ABCD")).uppercased().replacingOccurrences(of: " ", with: "")
        reg = r
        let cs = Self.spell(r), csC = Self.compact(cs)
        callsign = cs
        let type = p?.aircraft?.isEmpty == false ? p!.aircraft! : (faa ? "Cessna 172" : "PA-28")
        let letters = r.filter { $0.isLetter || $0.isNumber }
        let abbr = faa ? "\(type.split(separator: " ").first.map(String.init) ?? type) \(Self.spell(String(letters.suffix(3))))" : "\(Self.spell(String(letters.prefix(1)))) \(Self.spell(String(letters.suffix(2))))"
        let abC = Self.compact(abbr)
        let abReg = faa ? Self.compact(String(letters.suffix(3))) : Self.compact(String(letters.prefix(1)) + String(letters.suffix(2)))
        let place: String = {
            let parts = (p?.airport ?? "").components(separatedBy: "·")
            if parts.count > 1 {
                var n = parts[1].trimmingCharacters(in: .whitespaces)
                for suf in [" Airfield", " Airport", " Aerodrome"] where n.hasSuffix(suf) { n = String(n.dropLast(suf.count)) }
                if !n.isEmpty { return n }
            }
            return faa ? "Centennial" : "Popham"
        }()
        let pc = Self.compact(place)
        let re: (String, [String]) -> RadioScenario.Element = { label, needles in
            RadioScenario.Element(label: label) { t in needles.contains { !$0.isEmpty && t.contains($0) } }
        }
        let isFAA = model.regime == "faa"
        let csEl = re("Your callsign", [csC, abC, abReg, Self.compact(r)])
        let may = RadioScenario.Element(label: "MAYDAY three times") { t in t.components(separatedBy: "mayday").count - 1 >= 3 }
        let list: [RadioScenario]
        if isFAA {
            list = [
                RadioScenario(id: "f-ctaf", title: "Position report at a non-towered airport", situation: "You’re on the left downwind for runway 28 at \(place), planning to land.", atc: "",
                              model: "\(place) traffic, \(type) \(cs), left downwind runway two eight, full stop, \(place).",
                              elements: [re("Starts with the airport and “traffic”", [pc + "traffic"]), csEl, re("Position: left downwind", ["leftdownwind"]), re("Runway 28", ["runway28", "28"]), re("Intentions (full stop or touch and go)", ["fullstop", "touchandgo", "land"]), .init(label: "Ends with the airport name") { $0.hasSuffix(pc) }]),
                RadioScenario(id: "f-gnd", title: "Ground: ready to taxi", situation: "You’re at the flight school ramp at \(place) with ATIS information Bravo, departing VFR to the north.", atc: "",
                              model: "\(place) Ground, \(type) \(cs), at the flight school ramp, ready to taxi, VFR northbound, with information Bravo.",
                              elements: [re("Who you’re calling (Ground)", ["ground"]), csEl, re("Where you are", ["ramp", "parking", "flightschool", "apron"]), re("Ready to taxi", ["readytotaxi", "taxi"]), re("VFR and direction", ["vfr"]), re("ATIS: information Bravo", ["informationb", "withb", "atisb"])]),
                RadioScenario(id: "f-hold", title: "Read back a taxi clearance", situation: "Ground replies with your taxi instructions. Read them back.", atc: "\(abbr), runway two eight, taxi via Alpha, hold short of runway two eight.",
                              model: "Runway two eight, taxi via Alpha, hold short runway two eight, \(abbr).",
                              elements: [re("Runway 28", ["runway28", "28"]), re("Taxi via Alpha", ["viaa", "taxia", "alpha"]), re("Hold short runway 28 (hold-short instructions must be read back)", ["holdshortrunway28", "holdshortofrunway28", "holdshort28", "holdshort"]), csEl]),
                RadioScenario(id: "f-to", title: "Read back a take-off clearance", situation: "Tower clears you for take-off.", atc: "\(abbr), wind two six zero at eight, runway two eight, cleared for takeoff.",
                              model: "Runway two eight, cleared for takeoff, \(abbr).", elements: [re("Runway 28", ["runway28", "28"]), re("Cleared for takeoff", ["clearedfortakeoff", "clearedtakeoff"]), csEl]),
                RadioScenario(id: "f-may", title: "MAYDAY: engine failure", situation: "Your engine has failed 10 miles north of \(place) at 3,500 ft, heading 180, two people on board. You’re going to make a forced landing.", atc: "",
                              model: "MAYDAY MAYDAY MAYDAY, \(place) Tower, \(type) \(cs), engine failure, forced landing, one zero miles north of \(place), three thousand five hundred feet, heading one eight zero, two persons on board.",
                              elements: [may, csEl, re("Nature of the emergency", ["engine", "failure", "fire", "fuel"]), re("Intentions", ["forcedlanding", "landing", "land"]), re("Position", ["miles", "north", "south", "east", "west", "overhead"]), re("Altitude", ["feet", "altitude", "3500"]), re("Heading", ["heading"]), re("People on board", ["onboard", "pob", "souls"])])
            ]
        } else {
            list = [
                RadioScenario(id: "u-check", title: "Radio check", situation: "You’ve just started up at \(place) and want to check your radio with \(place) Radio.", atc: "",
                              model: "\(place) Radio, \(cs), radio check.", reply: "\(cs), \(place) Radio, readability five.",
                              elements: [re("Station you’re calling", [pc + "radio", pc]), csEl, re("“Radio check”", ["radiocheck"])]),
                RadioScenario(id: "u-taxi", title: "Read back a taxi clearance", situation: "ATC gives you taxi instructions and the pressure setting. Read back everything that must be read back.", atc: "\(abbr), taxi holding point Alpha One, runway two seven, QNH one zero one three.",
                              model: "Taxi holding point Alpha One, runway two seven, QNH one zero one three, \(abbr).",
                              elements: [re("Holding point Alpha One", ["holdingpointa1", "a1"]), re("Runway 27", ["runway27", "27"]), re("QNH 1013", ["qnh1013", "1013"]), csEl]),
                RadioScenario(id: "u-dep", title: "Read back a take-off clearance", situation: "Tower clears you for take-off and gives the surface wind.", atc: "\(abbr), runway two seven, cleared for take-off, surface wind two five zero degrees eight knots.",
                              model: "Runway two seven, cleared for take-off, \(abbr).", elements: [re("Runway 27", ["runway27", "27"]), re("Cleared for take-off", ["clearedfortakeoff", "clearedtakeoff"]), csEl]),
                RadioScenario(id: "u-dw", title: "Downwind call", situation: "You’re turning downwind in the circuit at \(place) and plan to land.", atc: "",
                              model: "\(abbr), downwind to land.", elements: [csEl, re("Downwind", ["downwind"]), re("Intentions (land, touch and go)", ["toland", "land", "touchandgo", "fullstop", "lowapproach"])]),
                RadioScenario(id: "u-may", title: "MAYDAY: engine failure", situation: "Your engine has failed 10 miles north of \(place) at 2,500 ft, heading 180, two people on board. You’re going to make a forced landing.", atc: "",
                              model: "MAYDAY MAYDAY MAYDAY, \(place) Radio, \(cs), \(type), engine failure, forced landing, one zero miles north of \(place), passing two thousand five hundred feet, heading one eight zero, student pilot, two persons on board.",
                              elements: [may, re("Station you’re calling", [pc, "radio", "information", "centre", "approach", "tower"]), csEl, re("Nature of the emergency", ["engine", "failure", "fire", "fuel"]), re("Intentions", ["forcedlanding", "landing", "land"]), re("Position", ["miles", "north", "south", "east", "west", "overhead"]), re("Level or altitude", ["feet", "altitude", "flightlevel", "2500"]), re("Heading", ["heading"]), re("Pilot qualification", ["studentpilot", "student", "ppl", "qualif"]), re("People on board", ["onboard", "pob"])])
            ]
        }
        scenarios = list
    }
}

struct RadioDrill: View {
    let scenario: RadioScenario
    @Environment(AppModel.self) private var model
    @State private var call = ""
    @State private var results: [(String, Bool)]?
    @State private var listener = SpeechListener()
    @State private var synth = AVSpeechSynthesizer()

    private var score: Int {
        guard let r = results, !r.isEmpty else { return 0 }
        return Int((Double(r.filter(\.1).count) / Double(r.count) * 100).rounded())
    }

    var body: some View {
        Page(title: scenario.title, subtitle: scenario.situation) {
            if scenario.atc.isEmpty {
                DarkTile(spacing: 8) {
                    Text("Your call").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
                    Text("Make the call for this situation.").font(.archivo(17, .medium))
                }
            } else {
                DarkTile(spacing: 10) {
                    Text("ATC says").font(.archivo(13, .semibold)).foregroundStyle(Theme.ice)
                    Text("“\(scenario.atc)”").font(.archivo(17, .medium))
                    Button { speak(scenario.atc) } label: { Label("Play", systemImage: "speaker.wave.2.fill") }
                        .buttonStyle(.pill(.light, height: 38))
                }
            }
            Tile(spacing: 12) {
                TileHead("Your transmission")
                TextField("Tap Speak and say your call, or type it", text: $call, axis: .vertical)
                    .lineLimit(3...8).padding(.vertical, 12).boploField()
                HStack(spacing: 8) {
                    Button {
                        if listener.listening { listener.stop() } else { listener.start { call = $0 } }
                    } label: {
                        Label(listener.listening ? "Listening… tap to stop" : "Speak", systemImage: listener.listening ? "waveform" : "mic.fill")
                    }
                    .buttonStyle(.pill(listener.listening ? .ink : .line, height: 46))
                    Button("Check my call") { Task { await check() } }
                        .buttonStyle(.pill(.blue, height: 46))
                        .disabled(call.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                ErrorText(text: listener.error)
            }
            if let results {
                Tile(spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("\(score)%").font(Theme.display(52)).foregroundStyle(score == 100 ? Theme.ok : Theme.danger)
                        Text(score == 100 ? "Everything included." : "Some parts are missing.").font(.archivo(15)).foregroundStyle(Theme.ink2)
                    }
                    ForEach(Array(results.enumerated()), id: \.offset) { _, r in
                        Label(r.0, systemImage: r.1 ? "checkmark.circle.fill" : "xmark.circle.fill")
                            .font(.archivo(14.5)).foregroundStyle(r.1 ? Theme.ok : Theme.danger)
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("A model call").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ink3)
                        Text("“\(scenario.model)”").font(.archivo(15))
                        if !scenario.reply.isEmpty {
                            Text("Reply").font(.archivo(12.5, .semibold)).foregroundStyle(Theme.ink3).padding(.top, 4)
                            Text("“\(scenario.reply)”").font(.archivo(15))
                        }
                        Button { speak(scenario.model) } label: { Label("Hear it", systemImage: "speaker.wave.2") }
                            .font(.archivo(13.5, .semibold)).foregroundStyle(Theme.electric).padding(.top, 4)
                    }
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.well, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
            }
        }
        .navigationTitle("Radio practice")
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { listener.stop(); synth.stopSpeaking(at: .immediate) }
    }

    private func speak(_ text: String) {
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: model.regime == "faa" ? "en-US" : "en-GB")
        u.rate = 0.52
        synth.stopSpeaking(at: .immediate)
        synth.speak(u)
    }

    private func check() async {
        listener.stop()
        let t = RadioScenarios.compact(call)
        guard !t.isEmpty else { return }
        withAnimation { results = scenario.elements.map { ($0.label, $0.check(t)) } }
        UINotificationFeedbackGenerator().notificationOccurred(score == 100 ? .success : .warning)
        var best = model.json("radio")
        best[scenario.id] = max((best[scenario.id] as? NSNumber)?.intValue ?? 0, score)
        try? await model.saveJSON("radio", best)
    }
}

/// On-device speech recognition for spoken calls.
@MainActor
@Observable
final class SpeechListener {
    private(set) var listening = false
    var error: String?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-GB"))

    func start(onText: @escaping (String) -> Void) {
        error = nil
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard status == .authorized else { self.error = "Speech recognition is off for Boplo. Turn it on in Settings, or type your call."; return }
                AVAudioApplication.requestRecordPermission { ok in
                    Task { @MainActor in
                        guard ok else { self.error = "Microphone access is off for Boplo. Turn it on in Settings, or type your call."; return }
                        self.begin(onText)
                    }
                }
            }
        }
    }

    private func begin(_ onText: @escaping (String) -> Void) {
        guard let recognizer, recognizer.isAvailable else { error = "Speech recognition isn’t available right now. Type your call instead."; return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let req = SFSpeechAudioBufferRecognitionRequest()
            req.shouldReportPartialResults = true
            request = req
            let input = engine.inputNode
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0), block: Self.tap(req))
            engine.prepare()
            try engine.start()
            listening = true
            task = recognizer.recognitionTask(with: req, resultHandler: Self.handler { text, done in
                Task { @MainActor in
                    if let text { onText(text) }
                    if done { self.stop() }
                }
            })
        } catch {
            self.error = "The microphone couldn’t start. Type your call instead."
            stop()
        }
    }

    // Built outside the main actor: the audio and recognition callbacks run on background queues.
    nonisolated private static func tap(_ req: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in req.append(buffer) }
    }

    nonisolated private static func handler(_ out: @escaping @Sendable (String?, Bool) -> Void) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, err in out(result?.bestTranscription.formattedString, err != nil || result?.isFinal == true) }
    }

    func stop() {
        guard listening || task != nil else { return }
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
