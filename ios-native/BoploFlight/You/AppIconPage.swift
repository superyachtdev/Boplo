import SwiftUI
import UIKit

/// Alternate Home Screen icons. Choosing one is an Advanced perk; everyone can see them.
struct AppIconPage: View {
    @Environment(AppModel.self) private var model
    @State private var current: String? = UIApplication.shared.alternateIconName
    @State private var error: String?

    private let icons: [(id: String?, name: String, note: String, preview: String)] = [
        (nil, "Boplo", "The original glow", "IconPreview-Default"),
        ("AppIcon-Night", "Night runway", "Edge lights to the horizon", "IconPreview-Night"),
        ("AppIcon-Dawn", "First light", "Dawn over the field", "IconPreview-Dawn"),
        ("AppIcon-Cloud", "Above the cloud", "Light, for light Home Screens", "IconPreview-Cloud"),
    ]

    var body: some View {
        Page(title: "App icon", subtitle: model.isAdvanced ? "Pick how Boplo looks on your Home Screen." : "Alternate icons come with Advanced.") {
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                ForEach(icons, id: \.name) { icon in
                    Button { choose(icon.id) } label: {
                        VStack(alignment: .leading, spacing: 10) {
                            Image(icon.preview)
                                .resizable().scaledToFit()
                                .clipShape(RoundedRectangle(cornerRadius: 26, style: .continuous))
                                .overlay(alignment: .topTrailing) {
                                    if current == icon.id {
                                        Image(systemName: "checkmark.circle.fill")
                                            .font(.system(size: 24))
                                            .symbolRenderingMode(.palette)
                                            .foregroundStyle(.white, Theme.electric)
                                            .padding(8)
                                    }
                                }
                            VStack(alignment: .leading, spacing: 2) {
                                Text(icon.name).font(.archivo(15, .semibold)).foregroundStyle(Theme.ink)
                                Text(icon.note).font(.archivo(12.5)).foregroundStyle(Theme.ink3)
                            }
                        }
                        .padding(12)
                        .background(Theme.paper, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .strokeBorder(current == icon.id ? Theme.electric : Theme.hair, lineWidth: current == icon.id ? 2 : 1))
                    }
                    .buttonStyle(.pressable)
                    .accessibilityAddTraits(current == icon.id ? .isSelected : [])
                }
            }
            ErrorText(text: error)
        }
    }

    private func choose(_ id: String?) {
        guard id != current else { return }
        guard model.isAdvanced || id == nil else { model.upgrade("Alternate app icons come with Advanced."); return }
        Haptic.tap(.light, 0.6)
        UIApplication.shared.setAlternateIconName(id) { err in
            Task { @MainActor in
                if let err { error = err.localizedDescription } else { current = id }
            }
        }
    }
}
