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

    /// Every country, popular ones first, with the licensing system and authority from the shared rules.
    static var countries: [Country] {
        let all = Rules.countries
        let popular = Rules.popular
        let top = popular.compactMap { code in all.first { $0.code == code } }
        let rest = all.filter { !popular.contains($0.code) }
        return (top + rest).map { c in
            let auth = Rules.authorityFor(c.code)
            return Country(code: c.code, name: c.name, regime: Rules.regimeFor(c.code), authority: auth.isEmpty ? "\(c.name) civil aviation authority" : auth)
        }
    }

    static func licences(for regime: String) -> [Licence] {
        let list = Rules.licences(regime).map { Licence(id: $0.id, label: $0.label, hours: $0.minHours ?? 0) }
        if !list.isEmpty { return list }
        return [.init(id: "PPL(A)", label: "PPL(A) · Private Pilot Licence", hours: 45)]
    }

    @State private var name = ""
    @State private var country = Country(code: "US", name: "United States", regime: "faa", authority: "FAA")
    @State private var licence = Licence(id: "Private Pilot", label: "Private Pilot certificate", hours: 40)
    @State private var countryList: [Country] = []
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
                            ForEach(countryList) { Text($0.name).tag($0) }
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
                Footnote(text: licence.hours > 0 ? "Published minimum: \(licence.hours) hours. Your instructor and authority decide what counts." : "Your instructor and authority decide what counts.")
            }
            ErrorText(text: error)
            Button {
                Task { await save() }
            } label: {
                HStack { if busy { ProgressView().tint(.white) }; Text("Open my desk") }
            }
            .primaryStyle()
            .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
            .padding(.top, 4)
        }
        .onAppear {
            if name.isEmpty { name = model.profile?.name ?? model.workspace?.user.display_name ?? "" }
            if countryList.isEmpty {
                countryList = Self.countries
                let region = Locale.current.region?.identifier ?? "US"
                if let c = countryList.first(where: { $0.code == region }) { country = c; licence = Self.licences(for: c.regime)[0] }
            }
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
                "goalHours": licence.hours > 0 ? licence.hours : 45,
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
