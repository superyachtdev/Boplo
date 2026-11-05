import SwiftUI

// Liquid Glass, used the way Apple's HIG asks: only on the functional layer (bars, the primary action,
// controls floating over maps and the composer). Cards, rows, chips and heroes stay solid content.
// The app supports iOS 17, so every glass API sits behind `#available(iOS 26.0, *)` with a solid fallback.

extension View {
    /// A secondary control that floats over content (map, media, dark hero): neutral glass (iOS 26), white pill before.
    @ViewBuilder
    func floatingAction(height: CGFloat = 44) -> some View {
        if #available(iOS 26.0, *) {
            self
                .font(.archivo(15, .semibold))
                .frame(minHeight: height - 16)
                .buttonStyle(.glass)
                .controlSize(.large)
        } else {
            self.buttonStyle(.pill(.light, height: height))
        }
    }

    /// An icon-only floating control: a glass circle (iOS 26), a white circle before.
    @ViewBuilder
    func floatingIcon() -> some View {
        if #available(iOS 26.0, *) {
            self.buttonStyle(.glass).buttonBorderShape(.circle).controlSize(.large)
        } else {
            self.buttonStyle(CircleFallbackStyle())
        }
    }

    /// Custom floating glass in a shape (readouts over the map). Plain material before iOS 26 is not used:
    /// older systems get a solid white surface, which reads as content rather than imitation glass.
    @ViewBuilder
    func glassSurface<S: Shape>(_ shape: S, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            self.glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
        } else {
            self.background(Theme.paper, in: shape).overlay(shape.stroke(Theme.hair))
        }
    }

    /// Groups nearby custom glass so it samples and renders together.
    @ViewBuilder
    func glassGroup(spacing: CGFloat? = nil) -> some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: spacing) { self }
        } else {
            self
        }
    }

    /// Tab bar shrinks while reading (iPhone, iOS 26).
    @ViewBuilder
    func minimizingTabBar() -> some View {
        if #available(iOS 26.0, *) {
            self.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            self
        }
    }

    /// Search collapses into a toolbar button until tapped (iOS 26).
    @ViewBuilder
    func minimizedSearch() -> some View {
        if #available(iOS 26.0, *) {
            self.searchToolbarBehavior(.minimize)
        } else {
            self
        }
    }

    /// Pins a floating bar to the bottom; on iOS 26 it joins the scroll edge effect so content stays legible under it.
    @ViewBuilder
    func bottomBar<Bar: View>(@ViewBuilder _ bar: () -> Bar) -> some View {
        if #available(iOS 26.0, *) {
            self.safeAreaBar(edge: .bottom) { bar() }
        } else {
            self.safeAreaInset(edge: .bottom) { bar() }
        }
    }
}

private struct CircleFallbackStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: 44, height: 44)
            .background(Theme.paper, in: Circle())
            .overlay(Circle().strokeBorder(Theme.hair))
            .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
    }
}

/// Cards and rows that respond to a press: a slight sink and dim, like a physical card.
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(.snappy(duration: 0.18), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == PressableStyle {
    static var pressable: PressableStyle { PressableStyle() }
}

/// The one primary action on a screen: prominent glass tinted electric blue on iOS 26, the solid blue pill before.
struct PrimaryButton<Label: View>: View {
    var full: Bool = true
    var busy: Bool = false
    let action: () -> Void
    @ViewBuilder var label: Label

    var body: some View {
        if #available(iOS 26.0, *) {
            Button(action: action) { content.padding(.vertical, 4) }
                .buttonStyle(.glassProminent)
                .tint(Theme.electric)
                .controlSize(.large)
        } else {
            Button(action: action) { content }
                .buttonStyle(.pill(.blue, height: 52, full: full))
        }
    }

    private var content: some View {
        HStack(spacing: 8) {
            if busy { ProgressView().tint(.white) }
            label
        }
        .font(.archivo(16, .semibold))
        .frame(maxWidth: full ? .infinity : nil)
    }
}

extension PrimaryButton where Label == Text {
    init(_ title: String, full: Bool = true, busy: Bool = false, action: @escaping () -> Void) {
        self.full = full; self.busy = busy; self.action = action; self.label = Text(title)
    }
}

extension View {
    /// Applies the primary-action look to an existing Button: prominent electric glass on iOS 26, the blue pill before.
    @ViewBuilder
    func primaryStyle(full: Bool = true, tint: Color = Theme.electric) -> some View {
        if #available(iOS 26.0, *) {
            self
                .font(.archivo(16, .semibold))
                .buttonStyle(.glassProminent)
                .buttonSizing(full ? .flexible : .fitted)
                .frame(maxWidth: full ? .infinity : nil)
                .tint(tint)
                .controlSize(.large)
        } else {
            self.buttonStyle(.pill(tint == Theme.danger ? .danger : .blue, height: 52, full: full))
        }
    }
}

extension View {
    /// The composer's text field: a glass capsule-ish field on iOS 26, the white field before.
    @ViewBuilder
    func composerField() -> some View {
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        if #available(iOS 26.0, *) {
            self.glassEffect(.regular.interactive(), in: shape)
        } else {
            self.background(Theme.paper, in: shape).overlay(shape.strokeBorder(Theme.hair))
        }
    }

    /// The bar holding a composer. On iOS 26 its glass pieces render together and float over the
    /// conversation; before, it sits on the page colour.
    @ViewBuilder
    func composerBar() -> some View {
        if #available(iOS 26.0, *) {
            GlassEffectContainer(spacing: 10) { self }
        } else {
            self.background(Theme.cloud.opacity(0.97))
        }
    }
}
