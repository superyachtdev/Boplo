import SwiftUI
import AuthenticationServices

/// Sign in with Apple, or an emailed 6-digit code. Google isn't offered in the app:
/// it refuses sign-in from inside apps, and an email that matches a Google account opens that same account.
struct SignInView: View {
    @Environment(AppModel.self) private var model

    private enum Step { case choose, email, code }
    @State private var step: Step = .choose
    @State private var email = ""
    @State private var code = ""
    @State private var busy = false
    @State private var note: String?
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        ZStack {
            LinearGradient(colors: [Theme.deep, Theme.night], startPoint: .top, endPoint: .bottom)
                .ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer()
                VStack(spacing: 14) {
                    BoploWordmark(color: .white)
                    Text("Your flying, in one place.")
                        .font(Theme.display(26))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                    Text("Prep every lesson, log every flight and see exactly what’s left.")
                        .font(.callout)
                        .foregroundStyle(Theme.mist)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }
                Spacer()
                VStack(spacing: 12) {
                    switch step {
                    case .choose: chooser
                    case .email: emailForm
                    case .code: codeForm
                    }
                    if let note { Text(note).font(.footnote).foregroundStyle(Theme.ice).multilineTextAlignment(.center) }
                    if let error { Text(error).font(.footnote).foregroundStyle(Color(red: 1, green: 0.55, blue: 0.55)).multilineTextAlignment(.center) }
                }
                .padding(.horizontal, 24)
                legal
                    .padding(.top, 20)
                    .padding(.bottom, 12)
            }
        }
        .preferredColorScheme(.dark)
    }

    private var chooser: some View {
        VStack(spacing: 12) {
            SignInWithAppleButton(.continue) { request in
                request.requestedScopes = [.fullName, .email]
            } onCompletion: { result in
                Task { await apple(result) }
            }
            .signInWithAppleButtonStyle(.white)
            .frame(height: 52)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .disabled(busy)

            Button {
                error = nil; note = nil; step = .email; focused = true
            } label: {
                Label("Continue with email", systemImage: "envelope")
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.bordered)
            .tint(.white)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }

    private var emailForm: some View {
        VStack(spacing: 12) {
            TextField("you@example.com", text: $email)
                .textContentType(.emailAddress)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .focused($focused)
                .submitLabel(.send)
                .onSubmit { Task { await sendCode() } }
                .modifier(FieldStyle())
            Button { Task { await sendCode() } } label: {
                HStack { if busy { ProgressView().tint(.white) }; Text("Email me a sign-in code") }
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .disabled(busy)
            Button("Back") { step = .choose; error = nil; note = nil }
                .foregroundStyle(Theme.mist)
        }
    }

    private var codeForm: some View {
        VStack(spacing: 12) {
            TextField("6-digit code", text: $code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .focused($focused)
                .font(.title2.monospacedDigit())
                .multilineTextAlignment(.center)
                .modifier(FieldStyle())
                .onChange(of: code) { _, value in
                    let digits = String(value.filter(\.isNumber).prefix(6))
                    if digits != value { code = digits }
                    if digits.count == 6 { Task { await verifyCode() } }
                }
            Button { Task { await verifyCode() } } label: {
                HStack { if busy { ProgressView().tint(.white) }; Text("Sign in") }
                    .frame(maxWidth: .infinity, minHeight: 52)
            }
            .buttonStyle(.borderedProminent)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .disabled(busy || code.count != 6)
            Button("Use a different email") { step = .email; code = ""; error = nil; note = nil }
                .foregroundStyle(Theme.mist)
        }
    }

    private var legal: some View {
        Text("By continuing you agree to the [Terms](https://boplo.app/terms.html) and [Privacy policy](https://boplo.app/privacy.html).")
            .font(.caption)
            .foregroundStyle(Theme.mist)
            .tint(Theme.ice)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 32)
    }

    // MARK: - Actions

    private func apple(_ result: Result<ASAuthorization, Error>) async {
        error = nil
        switch result {
        case .failure(let failure):
            if (failure as? ASAuthorizationError)?.code == .canceled { return }
            error = "Apple sign-in didn’t work. Try again, or use email."
        case .success(let auth):
            guard let credential = auth.credential as? ASAuthorizationAppleIDCredential,
                  let tokenData = credential.identityToken,
                  let token = String(data: tokenData, encoding: .utf8) else {
                error = "Apple sign-in didn’t return a token. Try again."
                return
            }
            let name = [credential.fullName?.givenName, credential.fullName?.familyName].compactMap { $0 }.joined(separator: " ")
            busy = true
            defer { busy = false }
            do {
                try await API.shared.send("auth/auth/apple", method: "POST", body: ["identityToken": token, "name": name])
                await model.refresh()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func sendCode() async {
        let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard address.contains("@"), address.contains(".") else { error = "Enter a valid email address."; return }
        busy = true; error = nil
        defer { busy = false }
        do {
            try await API.shared.send("auth/auth/email", method: "POST", body: ["email": address])
            email = address
            note = "We sent a 6-digit code to \(address). It expires in 15 minutes."
            step = .code
            focused = true
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func verifyCode() async {
        guard code.count == 6, !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        do {
            try await API.shared.send("auth/auth/code", method: "POST", body: ["email": email, "code": code])
            await model.refresh()
        } catch {
            self.error = error.localizedDescription
            code = ""
        }
    }
}

struct FieldStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 16)
            .frame(minHeight: 52)
            .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.18)))
            .foregroundStyle(.white)
    }
}
