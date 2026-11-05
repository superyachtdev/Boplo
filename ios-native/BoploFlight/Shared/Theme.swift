import SwiftUI
import CoreText

/// The web app's design system (dist/flight-app.css), ported: cloud surface, white tiles, navy tiles with contours,
/// one electric-blue accent, Archivo type with the wide italic display face.
enum Theme {
    static let night = Color(hex: 0x020611)
    static let deep = Color(hex: 0x06102A)
    static let navy = Color(hex: 0x0A1A44)
    static let electric = Color(hex: 0x0A62FF)
    static let electricHi = Color(hex: 0x2F7BFF)
    static let ice = Color(hex: 0x9ED8FF)
    static let cloud = Color(hex: 0xEDF2FA)
    static let paper = Color.white
    static let well = Color(hex: 0xF6F8FD)
    static let ink = Color(hex: 0x050B1F)
    static let ink2 = Color(hex: 0x3E4C6E)
    static let ink3 = Color(hex: 0x6B7896)
    static let mist = Color(hex: 0x8FA0C4)
    static let hair = Color(hex: 0x050B1F).opacity(0.09)
    static let pic = Color(hex: 0x5B3FFF)
    static let danger = Color(hex: 0xD93A4A)
    static let ok = Color(hex: 0x1C8C5E)
    static let warn = Color(hex: 0xB7791F)

    static let tileRadius: CGFloat = 20

    /// The wide italic display face used for page titles and big numbers.
    static func display(_ size: CGFloat, bold: Bool = false) -> Font {
        .custom(bold ? "ArchivoDisplay-BoldItalic" : "ArchivoDisplay-Italic", size: size)
    }
}

extension Font {
    /// Archivo at a fixed size. Weight picks the matching static face.
    static func archivo(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "Archivo-Bold"
        case .semibold: name = "Archivo-SemiBold"
        case .medium: name = "Archivo-Medium"
        default: name = "Archivo-Regular"
        }
        return .custom(name, size: size)
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xFF) / 255, green: Double((hex >> 8) & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
    }
}

enum BoploFonts {
    /// Registers the bundled Archivo faces once at launch, wherever the build put them in the bundle.
    static func register() {
        let urls = (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [])
            + (Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: "Fonts") ?? [])
        for url in urls {
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

// MARK: - Page scaffold

/// A scrolling page on the cloud background with the big italic title, like the web app's iOS layout.
struct Page<Content: View>: View {
    let title: String
    var subtitle: String? = nil
    @ViewBuilder var content: Content

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(Theme.display(38))
                        .tracking(-1.2)
                        .foregroundStyle(Theme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle).font(.archivo(14.5)).foregroundStyle(Theme.ink3)
                    }
                }
                .padding(.top, 4)
                .padding(.bottom, 4)
                content
            }
            .padding(.horizontal, 16)
            .padding(.bottom, 28)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.cloud.ignoresSafeArea())
        // The big title is in the page, so the bar stays empty (the title still names the back button).
        .toolbar { ToolbarItem(placement: .principal) { Color.clear.frame(width: 1, height: 1) } }
    }
}

/// The horizontal row of pill links under a page title (Logbook · Map · Analytics, and so on).
struct ChipRow: View {
    struct Item: Identifiable {
        let id: String
        let label: String
    }
    let items: [Item]
    let selected: String
    var onSelect: (String) -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(items) { item in
                    let on = item.id == selected
                    Button { onSelect(item.id) } label: {
                        Text(item.label)
                            .font(.archivo(14, .semibold))
                            .padding(.horizontal, 14)
                            .frame(height: 34)
                            .foregroundStyle(on ? .white : Theme.ink2)
                            .background(on ? Theme.ink : Theme.ink.opacity(0.07), in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
        }
        .padding(.horizontal, -16)
    }
}

// MARK: - Tiles

/// White tile with the hairline border and soft blue shadow.
struct Tile<Content: View>: View {
    var padding: CGFloat = 20
    var spacing: CGFloat = 14
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.paper, in: RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous).strokeBorder(Theme.hair))
            .shadow(color: Color(hex: 0x052878).opacity(0.07), radius: 18, y: 10)
    }
}

/// Navy tile with the contour lines, used for "Up next", the study hero and Ask Boplo.
struct DarkTile<Content: View>: View {
    var padding: CGFloat = 22
    var spacing: CGFloat = 14
    var seed: Double = 3.7
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: spacing) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .foregroundStyle(Color(hex: 0xF2F6FF))
            .background {
                ZStack {
                    LinearGradient(colors: [Theme.navy, Color(hex: 0x040B22)], startPoint: .topLeading, endPoint: UnitPoint(x: 0.75, y: 1))
                    Contours(seed: seed).opacity(0.45)
                }
                .clipShape(RoundedRectangle(cornerRadius: Theme.tileRadius, style: .continuous))
            }
            .environment(\.colorScheme, .dark)
    }
}

/// Tile heading row: title on the left, an optional trailing view (link, chip).
struct TileHead<Trailing: View>: View {
    let title: String
    @ViewBuilder var trailing: Trailing
    var body: some View {
        HStack(alignment: .center) {
            Text(title).font(.archivo(17, .semibold)).tracking(-0.2)
            Spacer(minLength: 8)
            trailing
        }
    }
}

extension TileHead where Trailing == EmptyView {
    init(_ title: String) { self.title = title; self.trailing = EmptyView() }
}

/// Small rounded label (status, counts). `tone` matches the web's .chip.ok / .warn.
struct Chip: View {
    enum Tone { case plain, ok, warn, bad, blue, dark }
    let text: String
    var tone: Tone = .plain
    var body: some View {
        Text(text)
            .font(.archivo(12.5, .medium))
            .lineLimit(1)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .foregroundStyle(fg)
            .background(bg, in: Capsule())
            .overlay(Capsule().strokeBorder(tone == .plain ? Theme.hair : .clear))
    }
    private var fg: Color {
        switch tone {
        case .plain: return Theme.ink2
        case .ok: return Theme.ok
        case .warn: return Theme.warn
        case .bad: return Theme.danger
        case .blue: return Theme.electric
        case .dark: return Theme.ice
        }
    }
    private var bg: Color {
        switch tone {
        case .plain: return Theme.well
        case .ok: return Theme.ok.opacity(0.1)
        case .warn: return Color(hex: 0xF5A623).opacity(0.14)
        case .bad: return Theme.danger.opacity(0.1)
        case .blue: return Theme.electric.opacity(0.1)
        case .dark: return Theme.ice.opacity(0.1)
        }
    }
}

// MARK: - Buttons

/// The web's pill buttons. `spark` adds the round icon on the right, as on "Log a flight" and "Prepare".
struct PillButtonStyle: ButtonStyle {
    enum Kind { case blue, light, ink, line, danger }
    var kind: Kind = .blue
    var height: CGFloat = 48
    var full: Bool = false
    var spark: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 10) {
            configuration.label
                .font(.archivo(height < 40 ? 14 : 15.5, .semibold))
                .lineLimit(1)
            if spark {
                Image(systemName: "sparkle")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(sparkFg)
                    .frame(width: height - 18, height: height - 18)
                    .background(sparkBg, in: Circle())
            }
        }
        .padding(.leading, height < 40 ? 14 : 20)
        .padding(.trailing, spark ? 9 : (height < 40 ? 14 : 20))
        .frame(height: height)
        .frame(maxWidth: full ? .infinity : nil)
        .foregroundStyle(fg)
        .background(bg, in: Capsule())
        .overlay(Capsule().strokeBorder(border))
        .shadow(color: shadow, radius: 14, y: 8)
        .scaleEffect(configuration.isPressed ? 0.98 : 1)
        .opacity(configuration.isPressed ? 0.9 : 1)
        .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }

    private var fg: Color {
        switch kind { case .blue, .ink: return .white; case .light, .line: return Theme.ink; case .danger: return Theme.danger }
    }
    private var bg: Color {
        switch kind { case .blue: return Theme.electric; case .light, .line, .danger: return .white; case .ink: return Theme.ink }
    }
    private var border: Color {
        switch kind { case .line: return Theme.hair; case .danger: return Theme.danger.opacity(0.35); default: return .clear }
    }
    private var shadow: Color {
        switch kind { case .blue: return Theme.electric.opacity(0.35); case .light: return Theme.electricHi.opacity(0.35); default: return .clear }
    }
    private var sparkBg: Color { kind == .blue || kind == .ink ? .white : Theme.electric }
    private var sparkFg: Color { kind == .blue || kind == .ink ? Theme.electric : .white }
}

extension ButtonStyle where Self == PillButtonStyle {
    static func pill(_ kind: PillButtonStyle.Kind = .blue, height: CGFloat = 48, full: Bool = false, spark: Bool = false) -> PillButtonStyle {
        PillButtonStyle(kind: kind, height: height, full: full, spark: spark)
    }
}

/// Blue text link, as used in tile heads ("Edit", "Open logbook").
struct TextLink: View {
    let title: String
    var action: () -> Void
    var body: some View {
        Button(action: action) {
            Text(title).font(.archivo(14, .semibold)).foregroundStyle(Theme.electric)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Progress

/// The licence ring: track plus electric arc, with a centre label.
struct Ring<Label: View>: View {
    let progress: Double
    var size: CGFloat = 150
    var lineWidth: CGFloat = 10
    var track: Color = Theme.ink.opacity(0.07)
    var fill: Color = Theme.electric
    @ViewBuilder var label: Label
    @State private var shown: Double = 0

    var body: some View {
        ZStack {
            Circle().stroke(track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: shown)
                .stroke(fill, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            label
        }
        .frame(width: size, height: size)
        .onAppear { withAnimation(.timingCurve(0.2, 0.7, 0.1, 1, duration: 1.2)) { shown = max(0, min(1, progress)) } }
        .onChange(of: progress) { _, v in withAnimation(.easeOut(duration: 0.6)) { shown = max(0, min(1, v)) } }
    }
}

/// Thin rounded progress bar.
struct Bar: View {
    let value: Double
    var height: CGFloat = 6
    var track: Color = Theme.ink.opacity(0.07)
    var fill: Color = Theme.electric
    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(fill).frame(width: max(value > 0 ? height : 0, geo.size.width * max(0, min(1, value))))
            }
        }
        .frame(height: height)
    }
}

// MARK: - Contours

/// The topographic contour field from the web app (same value-noise + marching squares), drawn with Canvas.
struct Contours: View {
    var seed: Double = 3.7
    var body: some View {
        Canvas { ctx, size in
            let (minor, major) = ContourField.paths(size: size, seed: seed)
            ctx.stroke(minor, with: .color(Color(hex: 0x2F7BFF).opacity(0.42)), lineWidth: 1)
            ctx.stroke(major, with: .color(Theme.ice.opacity(0.32)), lineWidth: 1)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

enum ContourField {
    static func paths(size: CGSize, seed: Double) -> (Path, Path) {
        let w = max(size.width, 1), h = max(size.height, 1)
        func hash(_ x: Double, _ z: Double) -> Double { let s = sin(x * 127.1 + z * 311.7 + seed) * 43758.5453; return s - floor(s) }
        func lerp(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
        func vn(_ x: Double, _ z: Double) -> Double {
            let xi = floor(x), zi = floor(z), xf = x - xi, zf = z - zi
            let u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf)
            return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v)
        }
        func fbm(_ x: Double, _ z: Double) -> Double {
            var s = 0.0, a = 0.5, f = 1.0
            for _ in 0..<4 { s += a * vn(x * f, z * f); f *= 2; a *= 0.5 }
            return s
        }
        let n = 44, m = max(8, Int((Double(n) * h / w).rounded()))
        var grid = [[Double]](repeating: [Double](repeating: 0, count: n + 1), count: m + 1)
        for j in 0...m { for i in 0...n { grid[j][i] = fbm(Double(i) / Double(n) * 4.2 + 1.3, Double(j) / Double(m) * 4.2 * h / w + 0.7) } }
        var minor = Path(), major = Path()
        let levels = [0.3, 0.36, 0.42, 0.48, 0.54, 0.6, 0.66, 0.72]
        for (li, level) in levels.enumerated() {
            var p = Path()
            for j in 0..<m {
                for i in 0..<n {
                    let v = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]]
                    let c = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
                    var e: [CGPoint] = []
                    for k in 0..<4 {
                        let a = v[k], b = v[(k + 1) % 4]
                        if (a < level) != (b < level) {
                            let t = (level - a) / (b - a), q0 = c[k], q1 = c[(k + 1) % 4]
                            let x = lerp(Double(q0.0), Double(q1.0), t) / Double(n) * w
                            let y = lerp(Double(q0.1), Double(q1.1), t) / Double(m) * h
                            e.append(CGPoint(x: x, y: y))
                        }
                    }
                    var k = 0
                    while k + 1 < e.count { p.move(to: e[k]); p.addLine(to: e[k + 1]); k += 2 }
                }
            }
            if li % 3 == 2 { major.addPath(p) } else { minor.addPath(p) }
        }
        return (minor, major)
    }
}

// MARK: - Bits

struct BoploWordmark: View {
    var height: CGFloat = 34
    var showFlight = true
    var flightColor: Color = .white
    var body: some View {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
            Image("Wordmark").resizable().scaledToFit().frame(height: height)
            if showFlight {
                Text("Flight").font(.archivo(height * 0.5, .medium)).foregroundStyle(flightColor.opacity(0.75))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Boplo Flight")
    }
}

struct ErrorText: View {
    let text: String?
    var body: some View {
        if let text, !text.isEmpty {
            Text(text)
                .font(.archivo(13.5, .medium))
                .foregroundStyle(Theme.danger)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Small grey explanatory text under tiles.
struct Footnote: View {
    let text: String
    var body: some View {
        Text(text).font(.archivo(12.5)).foregroundStyle(Theme.ink3).fixedSize(horizontal: false, vertical: true)
    }
}

/// A row that opens another screen: icon, title, subtitle, chevron.
struct MenuRow: View {
    let icon: String
    let title: String
    var subtitle: String? = nil
    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(Theme.electric)
                .frame(width: 26)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.archivo(15.5, .semibold)).foregroundStyle(Theme.ink)
                if let subtitle { Text(subtitle).font(.archivo(13)).foregroundStyle(Theme.ink3).multilineTextAlignment(.leading) }
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(Theme.mist)
        }
        .padding(.vertical, 14)
        .padding(.horizontal, 18)
        .contentShape(Rectangle())
    }
}

/// Text field styled like the web's inputs: white, hairline, rounded.
struct BoploFieldStyle: ViewModifier {
    var dark = false
    var font: Font = .archivo(16)
    func body(content: Content) -> some View {
        content
            .font(font)
            .padding(.horizontal, 16)
            .frame(minHeight: 50)
            .background(dark ? Color.white.opacity(0.06) : Color.white, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(dark ? Theme.ice.opacity(0.22) : Theme.hair))
    }
}

extension View {
    func boploField(dark: Bool = false, font: Font = .archivo(16)) -> some View { modifier(BoploFieldStyle(dark: dark, font: font)) }
}

/// Labeled field block: small label above the control.
struct Labeled<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(.archivo(13, .medium)).foregroundStyle(Theme.ink2)
            content
        }
    }
}
