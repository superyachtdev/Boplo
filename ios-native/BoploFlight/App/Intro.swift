import SwiftUI
import UIKit

// The two moments that bracket the app:
//  • LaunchIntro: a cold start. Runway edge lights switch on from the threshold to the horizon, the
//    approach strobe runs out ahead of you, the wordmark settles, then the nose lifts and the desk shows through.
//  • TakeoffSequence: right after signing up or signing in. The tower clears you, you roll, rotate,
//    climb through cloud, and break out onto the desk (whose background is that same cloud colour).
// Both are drawn from one painter so they read as the same place. Reduce Motion gets still versions.

// MARK: - Runway painter

struct RunwayState {
    /// Share of edge lights switched on, nearest first.
    var lit: Double = 1
    /// Distance rolled, in runway units (camera height = 1).
    var travelled: Double = 0
    /// Roll speed in units per second, used for light streaks.
    var speed: Double = 0
    /// 0 level, 1 nose high enough that the ground has dropped out of view.
    var pitch: Double = 0
    /// Position of the approach strobe along the centreline, 0…1, or nil when it isn't running.
    var rabbit: Double?
    /// 0 night, 1 first light.
    var dawn: Double = 0
    /// Cloud you are climbing through, 0 clear, 1 white-out.
    var cloud: Double = 0
    /// Seconds since start, for drifting cloud and blinking lights.
    var time: Double = 0
    /// A light aircraft ahead of you on the centreline: distance away and height (camera height = 1).
    var plane: (z: Double, alt: Double)?
}

private struct RGB {
    var r, g, b: Double
    init(_ hex: UInt32) { r = Double((hex >> 16) & 0xFF) / 255; g = Double((hex >> 8) & 0xFF) / 255; b = Double(hex & 0xFF) / 255 }
    init(r: Double, g: Double, b: Double) { self.r = r; self.g = g; self.b = b }
    func mix(_ o: RGB, _ t: Double) -> RGB { RGB(r: r + (o.r - r) * t, g: g + (o.g - g) * t, b: b + (o.b - b) * t) }
    var color: Color { Color(red: r, green: g, blue: b) }
}

enum RunwayPainter {
    private static let skyTopNight = RGB(0x020611), skyTopDawn = RGB(0x0B2C78)
    private static let skyLowNight = RGB(0x0A1A44), skyLowDawn = RGB(0x4E8FFF)
    private static let groundNight = RGB(0x010309), groundDawn = RGB(0x0A1638)
    private static let cloud = RGB(0xEDF2FA)

    static func draw(_ ctx: inout GraphicsContext, size: CGSize, s: RunwayState) {
        let w = size.width, h = size.height
        let cx = w / 2
        let f = w * 0.95
        // Nose up: the ground (and the horizon with it) drops away below the screen.
        let horizon = h * (0.6 + 0.75 * s.pitch * s.pitch)
        func p(_ x: Double, _ z: Double) -> CGPoint { CGPoint(x: cx + x * f / z, y: horizon + f / z) }

        // Sky
        let top = skyTopNight.mix(skyTopDawn, s.dawn), low = skyLowNight.mix(skyLowDawn, s.dawn)
        ctx.fill(Path(CGRect(x: 0, y: 0, width: w, height: min(h, horizon + 1))),
                 with: .linearGradient(Gradient(colors: [top.color, low.color]), startPoint: .zero, endPoint: CGPoint(x: 0, y: horizon)))
        // The glow of the airfield (and later the sun) on the horizon
        let glowR = w * (0.9 + 0.4 * s.dawn)
        ctx.fill(Path(ellipseIn: CGRect(x: cx - glowR, y: horizon - glowR * 0.45, width: glowR * 2, height: glowR * 0.9)),
                 with: .radialGradient(Gradient(colors: [Theme.electricHi.opacity(0.32 + 0.25 * s.dawn), .clear]),
                                       center: CGPoint(x: cx, y: horizon), startRadius: 0, endRadius: glowR))

        if horizon < h {
            // Ground and runway surface
            ctx.fill(Path(CGRect(x: 0, y: horizon, width: w, height: h - horizon)), with: .color(groundNight.mix(groundDawn, s.dawn).color))
            var strip = Path()
            strip.move(to: p(-1.7, 0.6)); strip.addLine(to: p(1.7, 0.6)); strip.addLine(to: p(1.7, 120)); strip.addLine(to: p(-1.7, 120)); strip.closeSubpath()
            ctx.fill(strip, with: .linearGradient(Gradient(colors: [Color(hex: 0x0E1A3A).opacity(0.9), Color(hex: 0x0E1A3A).opacity(0.2)]),
                                                  startPoint: CGPoint(x: cx, y: h), endPoint: CGPoint(x: cx, y: horizon)))

            // Centreline: dashes that rush past as you roll
            let dash = 2.6
            let offset = s.travelled.truncatingRemainder(dividingBy: dash)
            for k in 0..<44 {
                let z0 = 0.8 + Double(k) * dash - offset
                guard z0 > 0.5 else { continue }
                let z1 = z0 + 1.0
                var d = Path()
                d.move(to: p(-0.05, z0)); d.addLine(to: p(0.05, z0)); d.addLine(to: p(0.05, z1)); d.addLine(to: p(-0.05, z1)); d.closeSubpath()
                ctx.fill(d, with: .color(.white.opacity(min(0.55, 2.2 / z0) * 0.8)))
            }

            // Lights: blurred glow first, then the sharp cores
            ctx.drawLayer { layer in
                layer.addFilter(.blur(radius: 7))
                lights(&layer, s: s, p: p, glow: true)
            }
            lights(&ctx, s: s, p: p, glow: false)
        }
        if let pl = s.plane { plane(&ctx, z: pl.z, alt: pl.alt, time: s.time, cx: cx, horizon: horizon, f: f) }

        // Cloud you climb through: a white wall rising from below, with puffs drifting past.
        if s.cloud > 0 {
            let c = s.cloud
            ctx.drawLayer { layer in
                layer.addFilter(.blur(radius: 26))
                for i in 0..<9 {
                    let fi = Double(i)
                    let x = (sin(fi * 2.31) * 0.5 + 0.5) * w
                    let y = h * (1.35 - 1.5 * c) + (fi.truncatingRemainder(dividingBy: 3)) * h * 0.18 - (s.time * 160).truncatingRemainder(dividingBy: h * 0.2)
                    let r = w * (0.35 + 0.15 * sin(fi * 1.7))
                    layer.fill(Path(ellipseIn: CGRect(x: x - r, y: y - r * 0.55, width: r * 2, height: r * 1.1)), with: .color(cloud.color.opacity(min(1, c * 1.6))))
                }
            }
            let edge = h * (1.25 - 1.6 * c)
            ctx.fill(Path(CGRect(x: 0, y: edge - h * 0.4, width: w, height: h * 2)),
                     with: .linearGradient(Gradient(stops: [.init(color: cloud.color.opacity(0), location: 0), .init(color: cloud.color, location: 0.22)]),
                                           startPoint: CGPoint(x: 0, y: edge - h * 0.4), endPoint: CGPoint(x: 0, y: edge + h * 1.6)))
            if c >= 1 { ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(cloud.color)) }
        }
    }

    /// A high-wing trainer seen from behind: fuselage, wing with struts, tailplane, fin, wheels,
    /// and its nav lights (red left, green right), strobes and beacon.
    private static func plane(_ ctx: inout GraphicsContext, z: Double, alt: Double, time: Double, cx: Double, horizon: Double, f: Double) {
        guard z > 0.6 else { return }
        let k = f / z
        let base = CGPoint(x: cx, y: horizon + (1 - alt) * k)
        func q(_ x: Double, _ y: Double) -> CGPoint { CGPoint(x: base.x + x * k, y: base.y + y * k) }
        func poly(_ pts: [(Double, Double)]) -> Path {
            var path = Path()
            path.move(to: q(pts[0].0, pts[0].1))
            for pt in pts.dropFirst() { path.addLine(to: q(pt.0, pt.1)) }
            path.closeSubpath()
            return path
        }
        func line(_ a: (Double, Double), _ b: (Double, Double), _ width: Double, _ color: Color) {
            var path = Path(); path.move(to: q(a.0, a.1)); path.addLine(to: q(b.0, b.1))
            ctx.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: max(0.8, width * k), lineCap: .round))
        }

        // Landing light washing the runway ahead, fading as it climbs away.
        if alt < 0.7 {
            let zz = z + 3.5, k2 = f / zz
            let c = CGPoint(x: cx, y: horizon + k2)
            let rw = 1.5 * k2, rh = 0.35 * k2
            ctx.fill(Path(ellipseIn: CGRect(x: c.x - rw, y: c.y - rh, width: rw * 2, height: rh * 2)),
                     with: .radialGradient(Gradient(colors: [Color.white.opacity(0.22 * (1 - alt / 0.7)), .clear]), center: c, startRadius: 0, endRadius: rw))
        }
        // Its shadow, left on the runway as the wheels come off.
        if alt > 0.01 && alt < 1 {
            let g = CGPoint(x: cx, y: horizon + k)
            ctx.fill(Path(ellipseIn: CGRect(x: g.x - 0.5 * k, y: g.y - 0.04 * k, width: k, height: 0.08 * k)), with: .color(.black.opacity(0.35 * (1 - alt))))
        }

        let strut = Color(hex: 0x33456E), metal = Color(hex: 0x1A2747)
        let skin = GraphicsContext.Shading.linearGradient(Gradient(colors: [Color(hex: 0xF2F6FF), Color(hex: 0xB8C6E4), Color(hex: 0x6E7FA6)]),
                                                         startPoint: q(0, -0.56), endPoint: q(0, -0.06))
        // Main gear
        line((-0.06, -0.12), (-0.18, -0.03), 0.018, strut)
        line((0.06, -0.12), (0.18, -0.03), 0.018, strut)
        for x in [-0.18, 0.18] {
            ctx.fill(Path(ellipseIn: CGRect(x: q(x, 0).x - 0.026 * k, y: q(0, -0.075).y, width: 0.052 * k, height: 0.075 * k)), with: .color(metal))
        }
        // Wing struts, then the wing on top of the cabin (slight dihedral)
        line((-0.1, -0.17), (-0.4, -0.335), 0.012, strut)
        line((0.1, -0.17), (0.4, -0.335), 0.012, strut)
        ctx.fill(poly([(-0.66, -0.37), (0, -0.36), (0.66, -0.37), (0.66, -0.345), (0.1, -0.33), (-0.1, -0.33), (-0.66, -0.345)]), with: skin)
        // Fuselage (seen tail-on it's a rounded box tapering into the tail cone)
        ctx.fill(Path(roundedRect: CGRect(x: q(-0.12, 0).x, y: q(0, -0.335).y, width: 0.24 * k, height: 0.22 * k), cornerRadius: 0.07 * k), with: skin)
        ctx.fill(Path(ellipseIn: CGRect(x: q(-0.06, 0).x, y: q(0, -0.27).y, width: 0.12 * k, height: 0.1 * k)), with: .color(Color(hex: 0x52638C)))
        // Tailplane and fin, nearest to you
        ctx.fill(poly([(-0.27, -0.215), (0.27, -0.215), (0.27, -0.195), (0, -0.19), (-0.27, -0.195)]), with: skin)
        ctx.fill(poly([(-0.022, -0.21), (0.022, -0.21), (0.012, -0.56), (-0.01, -0.56)]), with: skin)
        // Boplo blue stripe on the fin
        ctx.fill(poly([(-0.019, -0.34), (0.019, -0.34), (0.017, -0.4), (-0.017, -0.4)]), with: .color(Theme.electric))

        // Lights, with a soft glow
        let strobe = time.truncatingRemainder(dividingBy: 1.1) < 0.07
        let beacon = time.truncatingRemainder(dividingBy: 0.85) < 0.18
        var dots: [(CGPoint, Color, Double)] = [
            (q(-0.66, -0.357), Color(hex: 0xFF4A4A), 1),
            (q(0.66, -0.357), Color(hex: 0x4AF29A), 1),
            (q(0, -0.205), .white, 0.8),
        ]
        if strobe { dots += [(q(-0.66, -0.357), .white, 1.8), (q(0.66, -0.357), .white, 1.8)] }
        if beacon { dots.append((q(0, -0.565), Color(hex: 0xFF3B3B), 1.2)) }
        let r = max(1.3, 0.022 * k)
        ctx.drawLayer { layer in
            layer.addFilter(.blur(radius: max(3, r * 2.2)))
            for (pt, color, size) in dots {
                let rr = r * 3 * size
                layer.fill(Path(ellipseIn: CGRect(x: pt.x - rr, y: pt.y - rr, width: rr * 2, height: rr * 2)), with: .color(color.opacity(0.85)))
            }
        }
        for (pt, color, size) in dots {
            let rr = r * size
            ctx.fill(Path(ellipseIn: CGRect(x: pt.x - rr, y: pt.y - rr, width: rr * 2, height: rr * 2)), with: .color(color))
        }
    }

    private static func lights(_ ctx: inout GraphicsContext, s: RunwayState, p: (Double, Double) -> CGPoint, glow: Bool) {
        let spacing = 2.2, count = 40
        let offset = s.travelled.truncatingRemainder(dividingBy: spacing)
        let edge = Color(hex: 0xDCEEFF)
        let streak = s.speed * 0.045

        func dot(_ x: Double, _ z: Double, _ color: Color, _ boost: Double = 1) {
            guard z > 0.45 else { return }
            let a = p(x, z)
            let r = max(0.7, 6.5 / z) * (glow ? 2.6 : 1) * boost
            let alpha = min(1, 0.3 + 2.4 / z) * (glow ? 0.55 : 1)
            if streak > 0.05 {
                let b = p(x, z + streak)
                var line = Path(); line.move(to: a); line.addLine(to: b)
                ctx.stroke(line, with: .color(color.opacity(alpha)), style: StrokeStyle(lineWidth: r * 1.5, lineCap: .round))
            } else {
                ctx.fill(Path(ellipseIn: CGRect(x: a.x - r, y: a.y - r, width: r * 2, height: r * 2)), with: .color(color.opacity(alpha)))
            }
        }

        // Green threshold bar, only while you're still on it.
        if s.travelled < 2 {
            for i in 0..<8 { dot(-1.75 + Double(i) * 0.5, 1.1 - s.travelled, Color(hex: 0x5CF2A0)) }
        }
        // White edge lights, switched on nearest first.
        for i in 0..<count {
            guard Double(i) / Double(count) < s.lit else { break }
            let z = 1.3 + Double(i) * spacing - offset
            dot(-1.7, z, edge); dot(1.7, z, edge)
        }
        // Red end lights at the far end.
        if s.lit >= 0.98 {
            for i in 0..<6 { dot(-1.25 + Double(i) * 0.5, 1.3 + Double(count) * spacing, Color(hex: 0xFF5A5A)) }
        }
        // The approach strobe, running out to the horizon.
        if let r = s.rabbit {
            let z = 1.6 + pow(r, 1.6) * 70
            dot(0, z, .white, 2.4 * (1 - r * 0.6))
        }
    }
}

private func clamp01(_ x: Double) -> Double { min(1, max(0, x)) }
private func smooth(_ x: Double) -> Double { let t = clamp01(x); return t * t * (3 - 2 * t) }
private func easeOut(_ x: Double) -> Double { let t = clamp01(x); return 1 - pow(1 - t, 3) }

enum Haptic {
    static func tap(_ style: UIImpactFeedbackGenerator.FeedbackStyle, _ intensity: CGFloat = 1) {
        UIImpactFeedbackGenerator(style: style).impactOccurred(intensity: intensity)
    }
}

// MARK: - Cold launch

struct LaunchIntro: View {
    /// True once the app knows where to go (signed out, setup or the desk).
    var ready: Bool
    /// The app underneath should appear now (it settles into place while the intro lifts away).
    var onReveal: () -> Void
    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var exitAt: Date?
    @State private var isReady = false
    @State private var minDone = false
    @State private var markIn = false
    @State private var leaving = false
    @State private var gone = false

    var body: some View {
        ZStack {
            TimelineView(.animation(paused: reduceMotion)) { tl in
                let t = tl.date.timeIntervalSince(start)
                let e = exitAt.map { tl.date.timeIntervalSince($0) } ?? 0
                Canvas { ctx, size in
                    var s = RunwayState()
                    s.lit = reduceMotion ? 1 : easeOut((t - 0.05) / 0.85)
                    // A trainer ahead of you rolls, lifts off and climbs away over the horizon.
                    let tp = reduceMotion ? 0 : t
                    let roll = max(0, tp - 0.15)
                    let air = max(0, tp - 1.05)
                    s.plane = (z: 2.6 + 0.9 * roll + 5 * pow(roll, 2.2), alt: 1.1 * pow(air, 1.7))
                    s.pitch = reduceMotion ? 0 : smooth(e / 0.8) * 0.75
                    s.travelled = reduceMotion ? 0 : pow(max(0, e), 2) * 6
                    s.time = t
                    RunwayPainter.draw(&ctx, size: size, s: s)
                }
            }
            Contours(seed: 0).opacity(0.22).blendMode(.screen).allowsHitTesting(false)
            GeometryReader { geo in
                BoploWordmark(height: 42)
                    .opacity(markIn && !leaving ? 1 : 0)
                    .blur(radius: markIn ? 0 : 10)
                    .scaleEffect(leaving ? 1.08 : markIn ? 1 : 0.94)
                    .offset(y: markIn ? (leaving ? -16 : 0) : 14)
                    .position(x: geo.size.width / 2, y: geo.size.height * 0.4)
            }
        }
        .ignoresSafeArea()
        .statusBarHidden(true)
        .opacity(gone ? 0 : 1)
        .allowsHitTesting(!gone)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Boplo Flight")
        .onAppear {
            start = Date()
            isReady = ready
            withAnimation(.spring(response: 0.7, dampingFraction: 0.85).delay(reduceMotion ? 0 : 0.85)) { markIn = true }
        }
        .onChange(of: ready) { _, v in isReady = v; tryExit() }
        .task {
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.5 : 2.1))
            minDone = true
            tryExit()
            // Never hold anyone at the door: if the network is slow, show the app's own loading state.
            try? await Task.sleep(for: .seconds(3))
            if exitAt == nil { isReady = true; tryExit() }
        }
    }

    private func tryExit() {
        guard minDone, isReady, exitAt == nil else { return }
        exitAt = Date()
        Haptic.tap(.soft, 0.7)
        onReveal()
        withAnimation(.easeIn(duration: 0.4)) { leaving = true }
        withAnimation(.easeOut(duration: reduceMotion ? 0.3 : 0.55).delay(reduceMotion ? 0 : 0.28)) { gone = true }
        Task {
            try? await Task.sleep(for: .seconds(reduceMotion ? 0.35 : 0.9))
            onFinish()
        }
    }
}

// MARK: - After sign-up / sign-in

struct TakeoffSequence: View {
    let name: String
    let firstTime: Bool
    var signedOut = false
    /// Wait on the dark runway (up to 1.5 s) until the app knows who you are, so the clearance can use your name.
    var hold = false
    /// The screen is fully cloud: mount the desk underneath now.
    var onCovered: () -> Void
    var onFinish: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var covered = false
    @State private var finished = false
    @State private var rotated = false
    @State private var lastBump: Double = 0
    @State private var started = false

    // Beats, in seconds.
    private var roll: Double { 1.35 }
    private var rotate: Double { 2.45 }
    private var cloudIn: Double { reduceMotion ? 1.7 : 2.85 }
    private var whiteOut: Double { cloudIn + (reduceMotion ? 0.35 : 0.6) }
    private var end: Double { whiteOut + 0.5 }

    var body: some View {
        TimelineView(.animation) { tl in
            let t = started ? tl.date.timeIntervalSince(start) : 0
            ZStack(alignment: .topLeading) {
                Canvas { ctx, size in
                    var s = RunwayState()
                    s.time = t
                    s.lit = 1
                    if !reduceMotion {
                        let r = max(0, t - roll)
                        s.travelled = 7 * pow(r, 2.3)
                        s.speed = 7 * 2.3 * pow(r, 1.3)
                        s.pitch = smooth((t - rotate) / 0.8)
                        s.dawn = smooth((t - rotate + 0.2) / 1.0)
                    }
                    s.cloud = smooth((t - cloudIn) / (whiteOut - cloudIn))
                    RunwayPainter.draw(&ctx, size: size, s: s)
                }
                .ignoresSafeArea()

                clearance(t)
                    .padding(.horizontal, 28)
                    .padding(.top, 96)
            }
            .opacity(min(clamp01(t / 0.3), 1 - clamp01((t - whiteOut) / 0.45)))
            .onChange(of: Int(t * 20)) { _, _ in tick(t) }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            // Tap to skip straight to the climb through cloud.
            guard started else { return }
            let t = Date().timeIntervalSince(start)
            if t < cloudIn - 0.3 { start = Date().addingTimeInterval(-(cloudIn - 0.3)) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isStaticText)
        .statusBarHidden(true)
        .onAppear { if !hold { begin() } }
        .onChange(of: hold) { _, h in if !h { begin() } }
        .task {
            try? await Task.sleep(for: .seconds(1.5))
            begin()
        }
    }

    private func begin() {
        guard !started else { return }
        start = Date()
        started = true
    }

    private func clearance(_ t: Double) -> some View {
        let out = reduceMotion ? 0 : smooth((t - (rotate - 0.15)) / 0.45)
        return VStack(alignment: .leading, spacing: 14) {
            Label("Boplo tower", systemImage: "dot.radiowaves.left.and.right")
                .font(.archivo(13.5, .semibold))
                .foregroundStyle(Theme.ice)
                .modifier(Beat(t: t, at: 0.35, reduce: reduceMotion))
            VStack(alignment: .leading, spacing: 0) {
                Text("Cleared for")
                    .modifier(Beat(t: t, at: 0.55, reduce: reduceMotion))
                Text("take-off,")
                    .modifier(Beat(t: t, at: 0.72, reduce: reduceMotion))
                Text(name.isEmpty ? "pilot." : "\(name).")
                    .foregroundStyle(Theme.ice)
                    .modifier(Beat(t: t, at: 0.89, reduce: reduceMotion))
            }
            .font(Theme.display(52))
            .tracking(-1.8)
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            Text(signedOut ? "Sign in and your desk is waiting just above the cloud." : firstTime ? "Your desk is set up. Next lesson, logbook and study are waiting above the cloud." : "Welcome back. Your desk is just above the cloud.")
                .font(.archivo(16))
                .foregroundStyle(Theme.mist)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 320, alignment: .leading)
                .modifier(Beat(t: t, at: 1.1, reduce: reduceMotion))
        }
        .opacity(1 - out)
        .offset(y: -40 * out)
    }

    private func tick(_ t: Double) {
        if !reduceMotion {
            // A rumble that quickens as you roll, then a firm bump as the wheels leave the ground.
            let r = t - roll
            if r > 0 && t < rotate && t - lastBump >= max(0.07, 0.26 - r * 0.17) {
                lastBump = t
                Haptic.tap(.light, 0.35 + min(0.5, r * 0.4))
            }
            if t >= rotate && !rotated { rotated = true; Haptic.tap(.medium, 0.9) }
        }
        if t >= whiteOut && !covered { covered = true; Haptic.tap(.soft, 0.6); onCovered() }
        if t >= end && !finished { finished = true; onFinish() }
    }
}

/// One line of the clearance arriving: it sharpens and settles into place.
private struct Beat: ViewModifier {
    let t: Double
    let at: Double
    let reduce: Bool
    func body(content: Content) -> some View {
        let k = reduce ? (t >= at ? 1 : 0) : easeOut((t - at) / 0.5)
        return content
            .opacity(k)
            .blur(radius: (1 - k) * 8)
            .offset(y: (1 - k) * 12)
    }
}
