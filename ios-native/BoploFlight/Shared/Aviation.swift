import SwiftUI

// The instruments and paperwork of flying, as interface: an airspeed-style hours gauge, flight-strip
// logbook cards and a sectional-chart airfield symbol.

// MARK: - Hours gauge

/// Hours toward the licence, drawn like an airspeed indicator: a 270° dial with coloured arcs for
/// dual, solo and PIC time (the way an ASI shows its white, green and yellow arcs), ticks and a
/// needle that sweeps up to your total with a little overshoot.
struct HoursGauge: View {
    var dual: Double
    var solo: Double
    var pic: Double
    /// Hours flown before Boplo, counted in the total but not split by role.
    var other: Double = 0
    var goal: Double
    var size: CGFloat = 150

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var shown: Double = 0

    private var total: Double { dual + solo + pic + other }
    /// The dial runs to the goal, or a round number past your total if you've passed it.
    private var scale: Double {
        let g = goal > 0 ? goal : max(10, (total / 10).rounded(.up) * 10)
        return total > g ? (total / 10).rounded(.up) * 10 : g
    }
    private static let start = 135.0, sweep = 270.0

    var body: some View {
        ZStack {
            Canvas { ctx, sz in draw(&ctx, sz) }
            // Needle
            Capsule()
                .fill(LinearGradient(colors: [.white, Theme.ice], startPoint: .top, endPoint: .bottom))
                .frame(width: 3, height: size * 0.4)
                .offset(y: -size * 0.2 + 8)
                .rotationEffect(.degrees(Self.start + 90 + Self.sweep * min(1.04, shown / scale)))
                .shadow(color: Theme.electric.opacity(0.7), radius: 6)
            Circle().fill(Theme.navy).frame(width: 14, height: 14)
                .overlay(Circle().strokeBorder(.white.opacity(0.85), lineWidth: 2))
            VStack(spacing: 0) {
                Text(String(format: "%.1f", total))
                    .font(Theme.display(size * 0.2, bold: true)).tracking(-1)
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text(goal > 0 ? "of \(Int(goal)) h" : "hours").font(.archivo(11.5)).foregroundStyle(Theme.mist)
            }
            .foregroundStyle(.white)
            .offset(y: size * 0.27)
        }
        .frame(width: size, height: size)
        .onAppear {
            if reduceMotion { shown = total; return }
            withAnimation(.interpolatingSpring(stiffness: 60, damping: 9).delay(0.25)) { shown = total }
        }
        .onChange(of: total) { _, v in withAnimation(.interpolatingSpring(stiffness: 80, damping: 11)) { shown = v } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(goal > 0 ? "\(String(format: "%.1f", total)) of \(Int(goal)) hours" : "\(String(format: "%.1f", total)) hours")
    }

    private func draw(_ ctx: inout GraphicsContext, _ sz: CGSize) {
        let c = CGPoint(x: sz.width / 2, y: sz.height / 2)
        let r = min(sz.width, sz.height) / 2 - 2
        func angle(_ v: Double) -> Angle { .degrees(Self.start + Self.sweep * min(1, max(0, v / scale))) }
        func arc(_ from: Double, _ to: Double, radius: CGFloat, width: CGFloat, _ color: Color) {
            guard to > from else { return }
            var p = Path()
            p.addArc(center: c, radius: radius, startAngle: angle(from), endAngle: angle(to), clockwise: false)
            ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .butt))
        }
        // Bezel and face
        ctx.fill(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)),
                 with: .radialGradient(Gradient(colors: [Color(hex: 0x10265E).opacity(0.9), Color(hex: 0x050B1F).opacity(0.85)]), center: c, startRadius: 0, endRadius: r))
        ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(.white.opacity(0.14)), lineWidth: 1)
        // Track, then the role arcs in order: dual, solo, PIC, earlier hours
        let band = r - 9
        arc(0, scale, radius: band, width: 7, .white.opacity(0.08))
        var at = 0.0
        for (v, color) in [(other, Theme.mist), (dual, Theme.electricHi), (solo, Color(hex: 0x46C2FF)), (pic, Color(hex: 0x9C86FF))] {
            arc(at, at + v, radius: band, width: 7, color)
            at += v
        }
        // Goal mark: a red radial line, like Vne
        if goal > 0 && goal <= scale {
            let a = angle(goal).radians
            var p = Path()
            p.move(to: CGPoint(x: c.x + cos(a) * (r - 16), y: c.y + sin(a) * (r - 16)))
            p.addLine(to: CGPoint(x: c.x + cos(a) * (r - 1), y: c.y + sin(a) * (r - 1)))
            ctx.stroke(p, with: .color(Color(hex: 0xFF5A5A)), lineWidth: 2.5)
        }
        // Ticks and numbers
        let majors = 5
        for i in 0...(majors * 5) {
            let v = scale * Double(i) / Double(majors * 5)
            let a = angle(v).radians
            let major = i % 5 == 0
            let inner = r - (major ? 24 : 19)
            var p = Path()
            p.move(to: CGPoint(x: c.x + cos(a) * inner, y: c.y + sin(a) * inner))
            p.addLine(to: CGPoint(x: c.x + cos(a) * (r - 15), y: c.y + sin(a) * (r - 15)))
            ctx.stroke(p, with: .color(.white.opacity(major ? 0.9 : 0.4)), lineWidth: major ? 1.6 : 1)
            if major {
                let tr = r - 34
                ctx.draw(Text("\(Int(v.rounded()))").font(.archivo(10, .semibold)).foregroundColor(.white.opacity(0.75)),
                         at: CGPoint(x: c.x + cos(a) * tr, y: c.y + sin(a) * tr))
            }
        }
    }
}

/// The legend under the gauge: what each arc means.
struct GaugeLegend: View {
    var dual: Double, solo: Double, pic: Double
    var body: some View {
        HStack(spacing: 12) {
            item("Dual", dual, Theme.electricHi)
            item("Solo", solo, Color(hex: 0x46C2FF))
            item("PIC", pic, Color(hex: 0x9C86FF))
        }
    }
    private func item(_ label: String, _ h: Double, _ color: Color) -> some View {
        HStack(spacing: 5) {
            RoundedRectangle(cornerRadius: 1.5).fill(color).frame(width: 10, height: 3)
            Text("\(label) \(String(format: "%.1f", h))").font(.archivo(12, .medium)).foregroundStyle(Theme.mist).monospacedDigit()
        }
    }
}

// MARK: - Flight strip

/// A logbook entry styled as an ATC flight strip: a coloured holder edge for the role, the route
/// in strip lettering, the details on one line and a sketch of the track on the right.
struct FlightStrip: View {
    let flight: Flight

    private var roleColor: Color {
        switch flight.role {
        case "solo": return Color(hex: 0x1B7FB8)
        case "pic": return Theme.pic
        default: return Theme.electric
        }
    }

    var body: some View {
        HStack(spacing: 0) {
            Rectangle().fill(roleColor).frame(width: 5)
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(flight.dep.isEmpty ? "----" : flight.dep)
                        Image(systemName: "airplane").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.ink3)
                        Text(flight.arr.isEmpty ? "----" : flight.arr)
                    }
                    .font(.system(size: 17, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Theme.ink)
                    HStack(spacing: 6) {
                        Text(Day.short(flight.date))
                        Text(flight.roleLabel.uppercased()).font(.system(size: 11, weight: .bold, design: .monospaced)).foregroundStyle(roleColor)
                        if let reg = flight.registration, !reg.isEmpty { Text(reg.uppercased()).font(.system(size: 12, design: .monospaced)) }
                        Text("\(Int(flight.landings ?? 0)) ldg")
                    }
                    .font(.archivo(13))
                    .foregroundStyle(Theme.ink3)
                    if let l = flight.lesson, !l.isEmpty {
                        Text(l).font(.archivo(13.5)).foregroundStyle(Theme.ink2).lineLimit(1)
                    }
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 4) {
                    TrackSketch(points: flight.track, color: roleColor)
                        .frame(width: 54, height: 30)
                    Text(hoursText(flight.mins))
                        .font(.system(size: 17, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Theme.ink)
                }
            }
            .padding(.vertical, 13)
            .padding(.leading, 13)
            .padding(.trailing, 15)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.paper)
        .overlay(alignment: .trailing) {
            // The strip's punched edge
            VStack(spacing: 7) { ForEach(0..<3, id: \.self) { _ in Circle().fill(Theme.cloud).frame(width: 5, height: 5) } }
                .padding(.trailing, 4)
        }
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(Theme.hair))
        .contentShape(Rectangle())
    }
}

/// A flight's GPS track squeezed into a little box; a dashed route line when there's no track.
struct TrackSketch: View {
    let points: [TrackPoint]
    var color: Color = Theme.electric
    var body: some View {
        Canvas { ctx, size in
            if points.count >= 2 {
                let lats = points.map(\.lat), lngs = points.map(\.lng)
                let minLat = lats.min()!, maxLat = lats.max()!, minLng = lngs.min()!, maxLng = lngs.max()!
                let span = max(maxLat - minLat, (maxLng - minLng) * cos(minLat * .pi / 180), 0.0005)
                let sx = (size.width - 4) / span, sy = (size.height - 4) / span
                let s = min(sx, sy)
                let w = (maxLng - minLng) * cos(minLat * .pi / 180) * s, h = (maxLat - minLat) * s
                let ox = (size.width - w) / 2, oy = (size.height - h) / 2
                var p = Path()
                let step = max(1, points.count / 120)
                for (i, pt) in points.enumerated() where i % step == 0 || i == points.count - 1 {
                    let q = CGPoint(x: ox + (pt.lng - minLng) * cos(minLat * .pi / 180) * s, y: oy + (maxLat - pt.lat) * s)
                    if p.isEmpty { p.move(to: q) } else { p.addLine(to: q) }
                }
                ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: 1.6, lineCap: .round, lineJoin: .round))
            } else {
                var p = Path()
                p.move(to: CGPoint(x: 4, y: size.height - 6))
                p.addQuadCurve(to: CGPoint(x: size.width - 4, y: 6), control: CGPoint(x: size.width * 0.35, y: 4))
                ctx.stroke(p, with: .color(Theme.ink3.opacity(0.45)), style: StrokeStyle(lineWidth: 1.4, lineCap: .round, dash: [3, 4]))
                for q in [CGPoint(x: 4, y: size.height - 6), CGPoint(x: size.width - 4, y: 6)] {
                    ctx.fill(Path(ellipseIn: CGRect(x: q.x - 2.5, y: q.y - 2.5, width: 5, height: 5)), with: .color(Theme.ink3.opacity(0.6)))
                }
            }
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Sectional chart airfield

/// An airfield as it's printed on a sectional chart: a ring with tick marks, the runway inside,
/// and the identifier beside it. Used faintly behind "Up next".
struct SectionalAirfield: View {
    var code: String
    var color: Color = Theme.electric
    var body: some View {
        Canvas { ctx, size in
            let r = min(size.width, size.height) * 0.32
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            ctx.stroke(Path(ellipseIn: CGRect(x: c.x - r, y: c.y - r, width: r * 2, height: r * 2)), with: .color(color), lineWidth: 3)
            for i in 0..<8 {
                let a = Double(i) * .pi / 4
                var p = Path()
                p.move(to: CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r))
                p.addLine(to: CGPoint(x: c.x + cos(a) * (r + 9), y: c.y + sin(a) * (r + 9)))
                ctx.stroke(p, with: .color(color), lineWidth: 3)
            }
            // Two crossing runways
            for (a, len) in [(-0.45, 0.8), (0.9, 0.55)] {
                var p = Path()
                p.move(to: CGPoint(x: c.x - cos(a) * r * len, y: c.y - sin(a) * r * len))
                p.addLine(to: CGPoint(x: c.x + cos(a) * r * len, y: c.y + sin(a) * r * len))
                ctx.stroke(p, with: .color(color), style: StrokeStyle(lineWidth: 6, lineCap: .butt))
            }
            if !code.isEmpty {
                ctx.draw(Text(code).font(.system(size: 15, weight: .bold, design: .rounded)).foregroundColor(color),
                         at: CGPoint(x: c.x, y: c.y + r + 24))
            }
        }
        .accessibilityHidden(true)
    }
}
