import Foundation

/// A readable error from the Boplo server (`{"error": "..."}`), or a network failure.
struct APIError: LocalizedError {
    let message: String
    let status: Int
    var errorDescription: String? { message }
}

extension Notification.Name {
    /// Posted when the server says the session has gone (401), so the app returns to sign-in.
    static let boploSignedOut = Notification.Name("boploSignedOut")
}

/// Talks to the same Cloudflare API the website uses. The session is the `boplo_session`
/// cookie, kept in the shared cookie store so the embedded simulator web view is signed in too.
final class API {
    static let shared = API()
    static let origin = URL(string: "https://boplo.app")!

    private let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)
    }

    /// True when a session cookie for boplo.app is stored.
    var hasSessionCookie: Bool {
        (HTTPCookieStorage.shared.cookies(for: API.origin) ?? []).contains { $0.name == "boplo_session" && !$0.value.isEmpty }
    }

    func clearCookies() {
        for cookie in HTTPCookieStorage.shared.cookies(for: API.origin) ?? [] {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    /// Sends a request and returns the raw JSON body. `path` is relative to https://boplo.app, e.g. "flight/workspace".
    @discardableResult
    func send(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        var request = URLRequest(url: URL(string: path, relativeTo: API.origin)!)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("BoploFlight-iOS", forHTTPHeaderField: "X-Boplo-Client")
        if method != "GET" {
            // The server refuses writes whose Origin isn't boplo.app (cross-site protection).
            request.setValue(API.origin.absoluteString, forHTTPHeaderField: "Origin")
        }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw APIError(message: "Can’t reach Boplo. Check your connection and try again.", status: 0)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            if status == 401 { NotificationCenter.default.post(name: .boploSignedOut, object: nil) }
            throw APIError(message: message ?? "Something went wrong (\(status)). Try again.", status: status)
        }
        return data
    }

    func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await send(path))
    }

    func post<T: Decodable>(_ path: String, method: String = "POST", body: [String: Any], as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: try await send(path, method: method, body: body))
    }

    /// The raw JSON object for a response, for records the app edits and sends back whole (the profile).
    func object(_ path: String) async throws -> [String: Any] {
        (try JSONSerialization.jsonObject(with: try await send(path)) as? [String: Any]) ?? [:]
    }

    /// Streams Ask Boplo's answer (server-sent events of {"t": text} chunks), calling `onText` with the text so far.
    func stream(_ path: String, body: [String: Any], onText: @escaping @MainActor (String) -> Void) async throws -> String {
        var request = URLRequest(url: URL(string: path, relativeTo: API.origin)!)
        request.httpMethod = "POST"
        request.timeoutInterval = 120
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("BoploFlight-iOS", forHTTPHeaderField: "X-Boplo-Client")
        request.setValue(API.origin.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let bytes: URLSession.AsyncBytes, response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch {
            throw APIError(message: "Can’t reach Boplo. Check your connection and try again.", status: 0)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let type = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type") ?? ""
        if !(200..<300).contains(status) || !type.contains("event-stream") {
            var data = Data()
            for try await b in bytes { data.append(b) }
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            if status == 401 { NotificationCenter.default.post(name: .boploSignedOut, object: nil) }
            throw APIError(message: message ?? "Boplo couldn’t answer just now. Try again in a moment.", status: status)
        }
        var text = "", failure: String?
        var last = Date.distantPast
        for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let json = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            guard let obj = (try? JSONSerialization.jsonObject(with: Data(json.utf8))) as? [String: Any] else { continue }
            if let t = obj["t"] as? String { text += t }
            if let e = obj["error"] as? String { failure = e }
            if Date().timeIntervalSince(last) > 0.06 {
                last = Date()
                let snapshot = text
                await onText(snapshot)
            }
        }
        let final = text
        await onText(final)
        if text.isEmpty { throw APIError(message: failure ?? "Boplo didn’t answer. Try asking again.", status: 0) }
        return text
    }
}
