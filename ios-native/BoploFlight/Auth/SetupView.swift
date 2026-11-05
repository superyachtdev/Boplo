import SwiftUI

/// First run for a new account: name, where you train and what you're training for.
/// Saves the same profile fields the website's setup does.
struct SetupView: View {
    @Environment(AppModel.self) private var model

    struct Country: Identifiable, Hashable {
        let code: String, name: String, regime: String, authority: String
        var id: String { code }
    }
    struct Licence: Hashable { let id: String, label: String, hours: Int }

    static let countries: [Country] = [
        .init(code: "US", name: "United States", regime: "faa", authority: "FAA"),
        .init(code: "GB", name: "United Kingdom", regime: "uk", authority: "UK CAA"),
        .init(code: "IE", name: "Ireland", regime: "easa", authority: "Irish Aviation Authority (EASA)"),
        .init(code: "ES", name: "Spain", regime: "easa", authority: "AESA (EASA)"),
        .init(code: "FR", name: "France", regime: "easa", authority: "DGAC (EASA)"),
        .init(code: "DE", name: "Germany", regime: "easa", authority: "Luftfahrt-Bundesamt (LBA) (EASA)"),
        .init(code: "IT", name: "Italy", regime: "easa", authority: "ENAC (EASA)"),
        .init(code: "NL", name: "Netherlands", regime: "easa", authority: "ILT (EASA)"),
        .init(code: "PT", name: "Portugal", regime: "easa", authority: "ANAC (EASA)"),
        .init(code: "SE", name: "Sweden", regime: "easa", authority: "Swedish Transport Agency (EASA)")
    ]

    static func licences(for regime: String) -> [Licence] {
        switch regime {
        case "faa": return [.init(id: "Private Pilot", label: "Private Pilot certificate", hours: 40),
                            .init(id: "Sport Pilot", label: "Sport Pilot certificate", hours: 20)]
        case "uk": return [.init(id: "PPL(A)", label: "PPL(A) · Private Pilot Licence", hours: 40),
                           .init(id: "NPPL(A)", label: "NPPL(A) · National Private Pilot Licence", hours: 32)]
        default: return [.init(id: "PPL(A)", label: "PPL(A) · Private Pilot Licence", hours: 45),
                          .init(id: "LAPL(A)", label: "LAPL(A) · Light Aircraft Pilot Licence", hours: 30)]
        }
    }

    @State private var name = ""
    @State private var country = SetupView.countries[0]
    @State private var licence = SetupView.licences(for: "faa")[0]
    @State private var airport = ""
    @State private var hoursSoFar = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        Page(title: "Set up your desk", subtitle: "A few details and your desk is ready. You can change any of this later.") {
            Tile {
                TileHead("You")
                Labeled(label: "Your name") {
                    TextField("First and last name", text: $name)
                        .textContentType(.name)
                        .boploField()
                }
            }
            Tile {
                TileHead("Where you train")
                Labeled(label: "Country") {
                    Menu {
                        Picker("Country", selection: $country) {
                            ForEach(Self.countries) { Text($0.name).tag($0) }
                        }
                    } label: { pickerLabel(country.name) }
                }
                .onChange(of: country) { _, value in licence = Self.licences(for: value.regime)[0] }
                Labeled(label: "Licensing authority") {
                    Text(country.authority).font(.archivo(15.5, .medium)).foregroundStyle(Theme.ink2)
                }
                Labeled(label: "Home airfield") {
                    TextField("e.g. KSEE or EGHP", text: $airport)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .boploField()
                }
            }
            Tile {
                TileHead("Your licence")
                Labeled(label: "Training for") {
                    Menu {
                        Picker("Training for", selection: $licence) {
                            ForEach(Self.licences(for: country.regime), id: \.self) { Text($0.label).tag($0) }
                        }
                    } label: { pickerLabel(licence.label) }
                }
                Labeled(label: "Hours flown before Boplo (optional)") {
                    TextField("0", text: $hoursSoFar)
                        .keyboardType(.decimalPad)
                        .boploField()
                }
                Footnote(text: "Published minimum: \(licence.hours) hours. Your instructor and authority decide what counts.")
            }
            ErrorText(text: error)
            Button {
                Task { await save() }
            } label: {
                HStack { if busy { ProgressView().tint(.white) }; Text("Open my desk") }
            }
            .buttonStyle(.pill(.blue, height: 52, full: true, spark: true))
            .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            .padding(.top, 4)
        }
        .onAppear {
            if name.isEmpty { name = model.profile?.name ?? model.workspace?.user.display_name ?? "" }
        }
    }

    private func pickerLabel(_ text: String) -> some View {
        HStack {
            Text(text).font(.archivo(16)).foregroundStyle(Theme.ink).lineLimit(1)
            Spacer()
            Image(systemName: "chevron.up.chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(Theme.ink3)
        }
        .boploField()
    }

    private func save() async {
        busy = true; error = nil
        defer { busy = false }
        let opening = Int(((Double(hoursSoFar.replacingOccurrences(of: ",", with: ".")) ?? 0) * 60).rounded())
        do {
            try await model.saveProfile([
                "name": name.trimmingCharacters(in: .whitespaces),
                "country": country.name,
                "countryCode": country.code,
                "regime": country.regime,
                "authority": country.authority,
                "licence": licence.id,
                "goalHours": licence.hours,
                "airport": airport.trimmingCharacters(in: .whitespaces).uppercased(),
                "openingMinutes": max(0, opening),
                "complete": true,
                "step": 4
            ])
        } catch {
            self.error = error.localizedDescription
        }
    }
}
