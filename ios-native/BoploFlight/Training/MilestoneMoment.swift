import SwiftUI

/// Full-screen celebration the first time the app sees a new milestone (first solo, first
/// cross-country, an hours mark): two contrails draw across the night, the number lands, and the
/// logbook stamp comes down. Then share it as a boarding pass.
struct MilestoneMoment: View {
    let milestone: Milestone
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var start = Date()
    @State private var numberIn = false
    @State private var textIn = false
    @State private var stamped = false
    @State private var sharing = false

    var body: some View {
        ZStack {
            RadialGradient(colors: [Color(hex: 0x0B1E4E), Color(hex: 0x040B22), Theme.night], center: UnitPoint(x: 0.8, y: 0), startRadius: 0, endRadius: 800)
                .ignoresSafeArea()
            Contours(seed: 4.4).opacity(0.4).ignoresSafeArea()
            TimelineView(.animation(paused: reduceMotion)) { tl in
                let t = reduceMotion ? 10 : tl.date.timeIntervalSince(start)
                Canvas { ctx, size in contrails(&ctx, size, t) }
                    .ignoresSafeArea()
            }
            .allowsHitTesting(false)

            VStack(alignment: .leading, spacing: 0) {
                Spacer()
                Label("New logbook milestone", systemImage: "seal.fill")
                    .font(.archivo(14, .semibold))
                    .foregroundStyle(Theme.ice)
                    .opacity(textIn ? 1 : 0)
                    .padding(.bottom, 10)
                Text(milestone.big)
                    .font(Theme.display(118, bold: true))
                    .tracking(-4)
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.35)
                    .scaleEffect(numberIn ? 1 : 1.25, anchor: .bottomLeading)
                    .opacity(numberIn ? 1 : 0)
                    .blur(radius: numberIn ? 0 : 12)
                Text(milestone.unit)
                    .font(.archivo(18, .medium)).foregroundStyle(Theme.ice)
                    .opacity(textIn ? 1 : 0)
                Text(milestone.title)
                    .font(Theme.display(44)).tracking(-1.4).foregroundStyle(.white)
                    .padding(.top, 18)
                    .opacity(textIn ? 1 : 0)
                    .offset(y: textIn ? 0 : 12)
                Text([milestone.date.map { Day.full($0) }, milestone.detail.isEmpty ? nil : milestone.detail].compactMap { $0 }.joined(separator: " · "))
                    .font(.archivo(15)).foregroundStyle(Theme.mist)
                    .padding(.top, 6)
                    .opacity(textIn ? 1 : 0)
                Spacer()
                VStack(spacing: 12) {
                    Button { sharing = true } label: { Label("Share your pass", systemImage: "square.and.arrow.up") }
                        .primaryStyle()
                    Button("Back to the desk") { dismiss() }
                        .font(.archivo(15.5, .semibold))
                        .foregroundStyle(Theme.ice)
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .opacity(stamped ? 1 : 0)
            }
            .padding(.horizontal, 28)
            .padding(.bottom, 12)

            stamp
                .rotationEffect(.degrees(-14))
                .scaleEffect(stamped ? 1 : 2.2)
                .opacity(stamped ? 0.92 : 0)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                .padding(.top, 110)
                .padding(.trailing, 34)
                .allowsHitTesting(false)
        }
        .statusBarHidden(true)
        .sheet(isPresented: $sharing) { MilestoneShareSheet(milestone: milestone) }
        .onAppear {
            start = Date()
            let d = reduceMotion ? 0.0 : 1.0
            withAnimation(.spring(response: 0.55, dampingFraction: 0.72).delay(0.55 * d)) { numberIn = true }
            withAnimation(.easeOut(duration: 0.5).delay(0.85 * d)) { textIn = true }
            withAnimation(.spring(response: 0.28, dampingFraction: 0.55).delay(1.45 * d)) { stamped = true }
            Task {
                try? await Task.sleep(for: .seconds(0.55 * d)); Haptic.tap(.medium)
                try? await Task.sleep(for: .seconds(0.9 * d)); Haptic.tap(.heavy)
                UINotificationFeedbackGenerator().notificationOccurred(.success)
            }
        }
        .accessibilityElement(children: .contain)
    }

    /// A round logbook stamp: name, date, "Logged".
    private var stamp: some View {
        let ink = Color(hex: 0xFF6B6B)
        return ZStack {
            Circle().strokeBorder(ink, lineWidth: 4)
            Circle().strokeBorder(ink, lineWidth: 1.5).padding(8)
            VStack(spacing: 2) {
                Text("LOGGED").font(.system(size: 22, weight: .heavy, design: .monospaced))
                Text(milestone.date.map { Day.short($0) } ?? "").font(.system(size: 13, weight: .bold, design: .monospaced))
                Text(model.homeCode.isEmpty ? "BOPLO" : model.homeCode).font(.system(size: 13, weight: .bold, design: .monospaced))
            }
            .foregroundStyle(ink)
        }
        .frame(width: 132, height: 132)
    }

    /// Two contrails drawn across the sky behind a small plane, then slowly spreading.
    private func contrails(_ ctx: inout GraphicsContext, _ size: CGSize, _ t: Double) {
        let w = size.width, h = size.height
        let p = min(1, max(0, (t - 0.1) / 1.6))
        let ease = 1 - pow(1 - p, 3)
        func point(_ u: Double) -> CGPoint {
            // A gentle climbing arc from lower left to upper right
            let x = -0.1 * w + u * 1.25 * w
            let y = h * 0.62 - sin(u * .pi * 0.85) * h * 0.38 - u * h * 0.06
            return CGPoint(x: x, y: y)
        }
        let n = 90
        let spread = min(1, max(0, (t - 1.0) / 4))
        for (offset, alpha) in [(-5.0, 0.55), (5.0, 0.55)] {
            var path = Path()
            for i in 0...n {
                let u = Double(i) / Double(n) * ease
                var q = point(u)
                q.y += offset
                if i == 0 { path.move(to: q) } else { path.addLine(to: q) }
            }
            ctx.drawLayer { layer in
                layer.addFilter(.blur(radius: 3 + spread * 6))
                layer.stroke(path, with: .color(.white.opacity(alpha * (1 - spread * 0.4))), style: StrokeStyle(lineWidth: 3 + spread * 6, lineCap: .round))
            }
        }
        if p < 1 || t < 2.6 {
            let tip = point(ease), prev = point(max(0, ease - 0.01))
            let angle = atan2(tip.y - prev.y, tip.x - prev.x)
            var plane = ctx
            plane.translateBy(x: tip.x, y: tip.y)
            plane.rotate(by: .radians(angle))
            plane.draw(Text(Image(systemName: "airplane")).font(.system(size: 22, weight: .bold)).foregroundColor(.white), at: .zero)
        }
    }
}
