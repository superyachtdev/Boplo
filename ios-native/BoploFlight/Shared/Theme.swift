import SwiftUI

enum Theme {
    static let night = Color(red: 2 / 255, green: 6 / 255, blue: 17 / 255)        // #020611
    static let deep = Color(red: 6 / 255, green: 16 / 255, blue: 42 / 255)        // #06102A
    static let electric = Color(red: 10 / 255, green: 98 / 255, blue: 255 / 255)  // #0A62FF
    static let ice = Color(red: 158 / 255, green: 216 / 255, blue: 255 / 255)     // #9ED8FF
    static let cloud = Color(red: 237 / 255, green: 242 / 255, blue: 250 / 255)   // #EDF2FA
    static let ink = Color(red: 5 / 255, green: 11 / 255, blue: 31 / 255)         // #050B1F
    static let mist = Color(red: 143 / 255, green: 160 / 255, blue: 196 / 255)    // #8FA0C4

    /// The big italic headings the website uses, in the system font.
    static func display(_ size: CGFloat) -> Font { .system(size: size, weight: .bold).italic() }
}

struct BoploWordmark: View {
    var color: Color = Theme.ink
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "airplane")
                .font(.system(size: 20, weight: .bold))
                .rotationEffect(.degrees(-45))
            Text("boplo")
                .font(.system(size: 30, weight: .heavy).italic())
            Text("Flight")
                .font(.system(size: 17, weight: .medium))
                .opacity(0.7)
                .padding(.top, 6)
        }
        .foregroundStyle(color)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Boplo Flight")
    }
}

/// A white rounded card on the cloud background.
struct Card<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.background, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

struct ErrorText: View {
    let text: String?
    var body: some View {
        if let text, !text.isEmpty {
            Text(text)
                .font(.footnote)
                .foregroundStyle(.red)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
