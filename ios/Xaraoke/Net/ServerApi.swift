// Las rutas HTTP del servidor que usa el remoto (ver src/routes/api.js y src/auth.js).
// Equivalente a android/.../net/ServerApi.kt

import Foundation

// Error de la API. `serverMessage` es el `error` que manda el servidor, ya en el idioma del
// dispositivo (lo elige con Accept-Language); si la petición ni llegó, es nil y quien lo muestra
// usa un texto propio.
struct ApiException: Error {
    let status: Int
    let serverMessage: String?
}

// Lo que responde /api/me: quién eres para el servidor. `name` es nil en modo nombre si todavía
// no elegiste uno.
struct Me: Equatable {
    let nameMode: Bool
    let name: String?
}

struct YoutubeSearch: Equatable {
    let results: [YoutubeVideo]
    let suffix: String?
}

final class ServerApi {
    let baseUrl: String
    private let session: URLSession
    private let onCookies: () -> Void

    var url: URL { URL(string: baseUrl)! }

    var webSocketUrl: String {
        // http -> ws, https -> wss
        if baseUrl.hasPrefix("https") { return "wss" + baseUrl.dropFirst("https".count) }
        if baseUrl.hasPrefix("http") { return "ws" + baseUrl.dropFirst("http".count) }
        return baseUrl
    }

    // `onCookies` se llama tras cada respuesta para volcar cookies nuevas a disco.
    init(baseUrl: String, session: URLSession, onCookies: @escaping () -> Void) {
        self.baseUrl = baseUrl
        self.session = session
        self.onCookies = onCookies
    }

    // nil si el servidor es anterior a la app (no tiene la ruta): quien llama lo deduce de /api/me.
    func authConfig() async throws -> AuthConfig? {
        let json: [String: Any]
        do {
            json = try await getJson("/api/auth/config")
        } catch let e as ApiException where e.status == 404 {
            return nil
        }
        let google = (json["mode"] as? String) == "google"
        return AuthConfig(
            google: google,
            googleClientId: json.stringOrNil("googleClientId"),
            allowedDomain: json.stringOrNil("allowedDomain")
        )
    }

    // nil si no hay sesión (el servidor manda a /login: 3xx o 401).
    func me() async throws -> Me? {
        let (data, response) = try await send(request("/api/me"))
        onCookies()
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if (300..<400).contains(code) || code == 401 { return nil }
        guard let json = try jsonObject(data) else { return nil }
        return Me(nameMode: json["devMode"] as? Bool ?? false, name: json.stringOrNil("name"))
    }

    func setName(_ name: String, room: String?) async throws -> String {
        var body: [String: Any] = ["name": name]
        if let room = room { body["room"] = room }
        return try await postJson("/api/dev-name", body).string("name")
    }

    func signInWithGoogle(idToken: String) async throws -> String {
        try await postJson("/api/auth/google-token", ["idToken": idToken]).string("name")
    }

    func roomExists(_ code: String) async throws -> Bool {
        (try await getJson("/api/rooms/\(code)"))["exists"] as? Bool ?? false
    }

    func songs() async throws -> SongLibrary {
        let json = try await getJson("/api/songs")
        var library: SongLibrary = []
        // El servidor manda un objeto { letra: { artista: [archivos] } }; el orden de JSONSerialization
        // no está garantizado, así que se ordena igual que el web: letras por ALPHABET, artistas alfabético.
        let letters = json.keys.sorted { lhsRank($0) < lhsRank($1) }
        for letter in letters {
            guard let artistsObj = json[letter] as? [String: Any] else { continue }
            var byArtist: [(artist: String, songs: [String])] = []
            for artist in artistsObj.keys.sorted(by: { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }) {
                let songs = (artistsObj[artist] as? [Any])?.compactMap { $0 as? String } ?? []
                byArtist.append((artist: artist, songs: songs))
            }
            library.append((letter: letter, artists: byArtist))
        }
        return library
    }

    private func lhsRank(_ letter: String) -> Int {
        guard let first = letter.uppercased().first,
              let idx = ALPHABET.firstIndex(of: first) else { return ALPHABET.count }
        return ALPHABET.distance(from: ALPHABET.startIndex, to: idx)
    }

    func downloads() async throws -> [Download] {
        let array = try await getJsonArray("/api/downloads")
        return array.compactMap { any in
            guard let d = any as? [String: Any] else { return nil }
            return Download(
                filename: d["filename"] as? String ?? "",
                title: d["title"] as? String ?? "",
                channel: d.stringOrNil("channel"),
                query: d.stringOrNil("query")
            )
        }
    }

    func ratings() async throws -> [String: RatingTotals] {
        let json = try await getJson("/api/ratings")
        var result: [String: RatingTotals] = [:]
        for (key, value) in json {
            guard let t = value as? [String: Any] else { continue }
            result[key] = RatingTotals(up: t["up"] as? Int ?? 0, down: t["down"] as? Int ?? 0)
        }
        return result
    }

    func searchYoutube(_ query: String) async throws -> YoutubeSearch {
        var components = URLComponents(url: url.appendingPathComponent("api/youtube/search"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "q", value: query)]
        let json = try await execute(URLRequest(url: components.url!))
        let array = json["results"] as? [Any] ?? []
        let results: [YoutubeVideo] = array.compactMap { any in
            guard let v = any as? [String: Any] else { return nil }
            let duration: Double? = {
                if let d = v["duration"] as? Double { return d }
                if let i = v["duration"] as? Int { return Double(i) }
                return nil
            }()
            return YoutubeVideo(
                id: v["id"] as? String ?? "",
                title: v["title"] as? String ?? "",
                channel: v.stringOrNil("channel"),
                durationSeconds: duration,
                thumbnail: v.stringOrNil("thumbnail")
            )
        }
        return YoutubeSearch(results: results, suffix: json.stringOrNil("suffix"))
    }

    // --- push (Fase 5) ---

    // Registra el device token de APNs para recibir el aviso de turno con la app cerrada. Silencioso:
    // si el servidor no tiene la ruta (anterior a la Fase 5), se ignora el error.
    func registerPush(token: String, room: String) async {
        _ = try? await postJson("/api/push/register", ["token": token, "platform": "ios", "room": room])
    }

    func unregisterPush(token: String) async {
        _ = try? await postJson("/api/push/unregister", ["token": token])
    }

    // Token de push de la Live Activity: el servidor actualiza la actividad de la sala en segundo plano.
    func registerActivityPush(token: String, room: String) async {
        _ = try? await postJson("/api/push/activity", ["token": token, "room": room])
    }

    // Devuelve el nombre de archivo con el que se agrega a la cola.
    func downloadYoutube(videoId: String, query: String?, suffix: String?) async throws -> String {
        var body: [String: Any] = ["videoId": videoId]
        if let query = query { body["query"] = query }
        if let suffix = suffix { body["suffix"] = suffix }
        return try await postJson("/api/youtube/download", body).string("filename")
    }

    // --- detalles ---

    private func request(_ path: String) -> URLRequest {
        URLRequest(url: url.appendingPathComponent(String(path.drop(while: { $0 == "/" }))))
    }

    private func getJson(_ path: String) async throws -> [String: Any] {
        try await execute(request(path))
    }

    private func getJsonArray(_ path: String) async throws -> [Any] {
        let (data, response) = try await send(request(path))
        onCookies()
        try throwIfNotOk(data, response)
        return (try JSONSerialization.jsonObject(with: data)) as? [Any] ?? []
    }

    private func postJson(_ path: String, _ body: [String: Any]) async throws -> [String: Any] {
        var req = request(path)
        req.httpMethod = "POST"
        req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await execute(req)
    }

    // Lanza ApiException si la respuesta no es 2xx. Un 3xx a /login también es un error: la sesión venció.
    private func execute(_ request: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await send(request)
        onCookies()
        try throwIfNotOk(data, response)
        return (try jsonObject(data)) ?? [:]
    }

    private func throwIfNotOk(_ data: Data, _ response: URLResponse) throws {
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if (200..<300).contains(code) { return }
        let message = (try? jsonObject(data))?.stringOrNil("error")
        throw ApiException(status: code, serverMessage: message)
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        try await session.data(for: request)
    }

    private func jsonObject(_ data: Data) throws -> [String: Any]? {
        (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}

private extension Dictionary where Key == String, Value == Any {
    func stringOrNil(_ key: String) -> String? {
        guard let s = self[key] as? String, !s.isEmpty else { return nil }
        return s
    }
    func string(_ key: String) -> String { self[key] as? String ?? "" }
}
