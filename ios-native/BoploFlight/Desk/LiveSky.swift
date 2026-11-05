import SwiftUI

/// What the sky over your home airfield is doing right now: time of day from the clock, cloud,
/// rain and wind from its latest METAR. The desk hero paints itself from this, so opening the app
/// tells you whether it's a flying day before you read a word.
struct SkyNow: Equatable {
    enum Phase: String { case night, dawn, day, dusk }
    enum Cover: Int, Comparable {
        case clear, few, scattered, broken, overcast
        static func < (a: Cover, b: Cover) -> Bool { a.rawValue < b.rawValue }
    }

    var phase: Phase = SkyNow.phaseAt(Date())
    var cover: Cover = .clear
    var rain = false
    var snow = false
    var windKt = 0
    var gustKt = 0
    /// VFR, MVFR, IFR or LIFR, as the weather service categorises it.
    var category = ""
    var station = ""

    static func phaseAt(_ date: Date) -> Phase {
        let h = Calendar.current.component(.hour, from: date)
        switch h {
        case 6..<8: return .dawn
        case 8..<17: return .day
        case 17..<20: return .dusk
        default: return .night
        }
    }

    /// Reads the parts of a raw METAR that change the picture.
    mutating func read(metar raw: String) {
        let groups = raw.uppercased().split(separator: " ").map(String.init)
        var worst = Cover.clear
        for g in groups {
            if g.hasPrefix("OVC") || g.hasPrefix("VV") { worst = max(worst, .overcast) }
            else if g.hasPrefix("BKN") { worst = max(worst, .broken) }
            else if g.hasPrefix("SCT") { worst = max(worst, .scattered) }
            else if g.hasPrefix("FEW") { worst = max(worst, .few) }
            let wx = g.trimmingCharacters(in: CharacterSet(charactersIn: "+-"))
            if wx.contains("RA") || wx.contains("DZ") || wx.hasPrefix("SH") || wx.hasPrefix("TS") { rain = true }
            if wx.contains("SN") { snow = true }
            if g.hasSuffix("KT"), let m = g.range(of: #"^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$"#, options: .regularExpression) {
                let w = String(g[m])
                let digits = w.dropFirst(3).prefix { $0.isNumber }
                windKt = Int(digits) ?? 0
                if let gi = w.firstIndex(of: "G") { gustKt = Int(w[w.index(after: gi)...].prefix { $0.isNumber }) ?? 0 }
            }
        }
        cover = worst
    }

    var summary: String {
        var parts: [String] = []
        if !station.isEmpty { parts.append(station) }
        if !category.isEmpty { parts.append(category) }
        if windKt > 0 { parts.append(gustKt > 0 ? "\(windKt)G\(gustKt) kt" : "\(windKt) kt") } else if !station.isEmpty { parts.append("Calm") }
        return parts.joined(separator: " · ")
    }

    var categoryColor: Color {
        switch category {
        case "VFR": return Color(hex: 0x5CF2A0)
        case "MVFR": return Color(hex: 0x7FB8FF)
        case "IFR": return Color(hex: 0xFF6B6B)
        case "LIFR": return Color(hex: 0xE58BFF)
        default: return Theme.ice
        }
    }
}

@MainActor
@Observable
final class SkyWatch {
    static let shared = SkyWatch()
    private(set) var now = SkyNow()
    private var loadedFor = ""
    private var loadedAt = Date.distantPast

    func refresh(code: String, country: String) async {
        now.phase = SkyNow.phaseAt(Date())
        guard !code.isEmpty else { return }
        if code == loadedFor && Date().timeIntervalSince(loadedAt) < 15 * 60 { return }
        var path = "flight/weather?ids=\(code.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? code)"
        if let a = await AirfieldStore.shared.find(code, home: country) { path += "&lat=\(a.lat)&lng=\(a.lng)" }
        guard let obj = try? await API.shared.object(path), let s = (obj["stations"] as? [[String: Any]])?.first else { return }
        var next = SkyNow()
        next.station = s["id"] as? String ?? code
        next.category = s["fltCat"] as? String ?? ""
        next.read(metar: s["raw"] as? String ?? "")
        withAnimation(.easeInOut(duration: 1.2)) { now = next }
        loadedFor = code
        loadedAt = Date()
    }
}

/// The painted sky behind the desk hero. Animated gently (clouds drift, stars twinkle, rain falls);
/// still under Reduce Motion.
struct SkyBackdrop: View {
    let sky: SkyNow
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var colors: [Color] {
        let dim = sky.cover >= .broken
        switch sky.phase {
        case .night: return [Color(hex: 0x030918), Color(hex: 0x0A1A44)]
        case .dawn: return dim ? [Color(hex: 0x1C2C5A), Color(hex: 0x5A6C99)] : [Color(hex: 0x10265E), Color(hex: 0x3D6FD9), Color(hex: 0xF0A27A)]
        case .day: return dim ? [Color(hex: 0x23407A), Color(hex: 0x5878A8)] : [Color(hex: 0x0A4BD6), Color(hex: 0x2F7BFF), Color(hex: 0x7FBCFF)]
        case .dusk: return dim ? [Color(hex: 0x1A2550), Color(hex: 0x4A4E7A)] : [Color(hex: 0x0E1E52), Color(hex: 0x5B3FB0), Color(hex: 0xF07D5A)]
        }
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                let w = size.width, h = size.height
                ctx.fill(Path(CGRect(origin: .zero, size: size)),
                         with: .linearGradient(Gradient(colors: colors), startPoint: .zero, endPoint: CGPoint(x: w * 0.3, y: h)))
                // Sun or moon glow
                let glow: (CGPoint, Color, CGFloat) = {
                    switch sky.phase {
                    case .night: return (CGPoint(x: w * 0.82, y: h * 0.16), Theme.ice.opacity(0.22), w * 0.35)
                    case .dawn: return (CGPoint(x: w * 0.15, y: h * 1.0), Color(hex: 0xFFC48A).opacity(0.55), w * 0.8)
                    case .day: return (CGPoint(x: w * 0.85, y: h * 0.05), Color.white.opacity(0.35), w * 0.6)
                    case .dusk: return (CGPoint(x: w * 0.9, y: h * 1.0), Color(hex: 0xFF9A6A).opacity(0.5), w * 0.8)
                    }
                }()
                let k = sky.cover >= .broken ? 0.35 : 1.0
                ctx.fill(Path(ellipseIn: CGRect(x: glow.0.x - glow.2, y: glow.0.y - glow.2, width: glow.2 * 2, height: glow.2 * 2)),
                         with: .radialGradient(Gradient(colors: [glow.1.opacity(k), .clear]), center: glow.0, startRadius: 0, endRadius: glow.2))
                if sky.phase == .night {
                    // Moon and stars (stars hide behind cloud)
                    ctx.fill(Path(ellipseIn: CGRect(x: w * 0.82 - 9, y: h * 0.16 - 9, width: 18, height: 18)), with: .color(Color(hex: 0xEAF3FF).opacity(sky.cover >= .broken ? 0.25 : 0.9)))
                    let starCount = sky.cover >= .broken ? 6 : sky.cover >= .scattered ? 22 : 44
                    for i in 0..<starCount {
                        let fi = Double(i)
                        let x = (sin(fi * 12.9898) * 43758.5453).truncatingRemainder(dividingBy: 1)
                        let y = (sin(fi * 78.233) * 12543.123).truncatingRemainder(dividingBy: 1)
                        let px = abs(x) * w, py = abs(y) * h * 0.75
                        let tw = 0.45 + 0.55 * (0.5 + 0.5 * sin(t * (1.2 + fi.truncatingRemainder(dividingBy: 5) * 0.4) + fi))
                        let r = fi.truncatingRemainder(dividingBy: 7) == 0 ? 1.4 : 0.9
                        ctx.fill(Path(ellipseIn: CGRect(x: px - r, y: py - r, width: r * 2, height: r * 2)), with: .color(.white.opacity(tw * 0.85)))
                    }
                }
                // Cloud: soft banks drifting left to right, more and lower as cover increases
                if sky.cover > .clear {
                    let banks = [0, 2, 4, 7, 10][sky.cover.rawValue]
                    let shade: Color = sky.phase == .night ? Color(hex: 0x3A4C7A) : sky.cover >= .broken ? Color(hex: 0xC9D3E6) : .white
                    ctx.drawLayer { layer in
                        layer.addFilter(.blur(radius: 18))
                        for i in 0..<banks {
                            let fi = Double(i)
                            let speed = 6 + fi.truncatingRemainder(dividingBy: 3) * 4
                            let x = ((fi * 97 + t * speed).truncatingRemainder(dividingBy: Double(w) + 260)) - 130
                            let y = h * (0.12 + (fi * 0.137).truncatingRemainder(dividingBy: 0.62))
                            let rw = 90 + fi.truncatingRemainder(dividingBy: 4) * 26, rh = rw * 0.38
                            layer.fill(Path(ellipseIn: CGRect(x: x - rw, y: y - rh, width: rw * 2, height: rh * 2)),
                                       with: .color(shade.opacity(sky.cover >= .broken ? 0.55 : 0.4)))
                        }
                    }
                }
                // Rain or snow
                if sky.rain || sky.snow {
                    for i in 0..<70 {
                        let fi = Double(i)
                        let x0 = abs((sin(fi * 3.17) * 9187.3).truncatingRemainder(dividingBy: 1)) * (w + 40) - 20
                        let speed = sky.snow ? 40.0 : 420.0
                        let y = ((fi * 53.1 + t * speed).truncatingRemainder(dividingBy: Double(h) + 40)) - 20
                        if sky.snow {
                            let x = x0 + sin(t + fi) * 6
                            ctx.fill(Path(ellipseIn: CGRect(x: x - 1.6, y: y - 1.6, width: 3.2, height: 3.2)), with: .color(.white.opacity(0.7)))
                        } else {
                            var p = Path(); p.move(to: CGPoint(x: x0, y: y)); p.addLine(to: CGPoint(x: x0 - 3, y: y + 11))
                            ctx.stroke(p, with: .color(.white.opacity(0.32)), lineWidth: 1)
                        }
                    }
                }
                // Horizon haze at the bottom so the readout stays legible
                ctx.fill(Path(CGRect(x: 0, y: h * 0.55, width: w, height: h * 0.45)),
                         with: .linearGradient(Gradient(colors: [.clear, Color(hex: 0x050B1F).opacity(0.35)]), startPoint: CGPoint(x: 0, y: h * 0.55), endPoint: CGPoint(x: 0, y: h)))
            }
        }
        .accessibilityHidden(true)
    }
}
