// Qué trae lo que se escaneó o se abrió: la dirección del servidor, el código de la sala, o ambos.
// Equivalente a android/app/src/main/java/xyz/xalcker/xaraoke/core/JoinLink.kt

import Foundation

struct JoinLink: Equatable {
    let serverUrl: String?
    let roomCode: String?
}

private let roomCodeRegex = try! NSRegularExpression(pattern: "^[A-Z]{4}$")
private let schemeRegex = try! NSRegularExpression(pattern: "^[a-zA-Z][a-zA-Z0-9+.-]*://")

private func matches(_ regex: NSRegularExpression, _ value: String) -> Bool {
    let range = NSRange(value.startIndex..., in: value)
    return regex.firstMatch(in: value, range: range) != nil
}

func normalizeRoomCode(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespaces).uppercased(), !trimmed.isEmpty else {
        return nil
    }
    return matches(roomCodeRegex, trimmed) ? trimmed : nil
}

// Deja la dirección del servidor como "http://host:puerto", sin ruta ni barra final. Si la persona
// la escribe sin "http://" se asume HTTP, que es como corre el servidor en la red de la casa.
// Devuelve nil si no es una dirección utilizable.
func normalizeServerUrl(_ input: String?) -> String? {
    let text = input?.trimmingCharacters(in: .whitespaces) ?? ""
    if text.isEmpty { return nil }
    let hasScheme: Bool = {
        let range = NSRange(text.startIndex..., in: text)
        return schemeRegex.firstMatch(in: text, range: range) != nil
    }()
    let withScheme = hasScheme ? text : "http://\(text)"
    guard let uri = URLComponents(string: withScheme) else { return nil }
    guard let scheme = uri.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return nil }
    guard let host = uri.host, !host.isEmpty else { return nil }
    let port = uri.port.map { ":\($0)" } ?? ""
    return "\(scheme)://\(host)\(port)"
}

// Entiende tres formas:
//   - el QR de la pantalla principal: http(s)://servidor/remote.html?sala=ABCD
//   - el enlace propio de la app:     xaraoke://unirse?servidor=http://...&sala=ABCD
//   - solo el código de la sala:       ABCD
// Devuelve nil si no hay ni servidor ni sala.
func parseJoinText(_ text: String?) -> JoinLink? {
    let trimmed = text?.trimmingCharacters(in: .whitespaces) ?? ""
    if trimmed.isEmpty { return nil }
    if let code = normalizeRoomCode(trimmed) { return JoinLink(serverUrl: nil, roomCode: code) }
    guard let uri = URLComponents(string: trimmed) else { return nil }
    let params = queryParams(uri)
    let room = normalizeRoomCode(params["sala"])
    switch uri.scheme?.lowercased() {
    case "http", "https":
        guard let server = normalizeServerUrl(trimmed) else { return nil }
        return JoinLink(serverUrl: server, roomCode: room)
    case "xaraoke":
        let server = normalizeServerUrl(params["servidor"])
        if server == nil && room == nil { return nil }
        return JoinLink(serverUrl: server, roomCode: room)
    default:
        return nil
    }
}

private func queryParams(_ components: URLComponents) -> [String: String] {
    var result: [String: String] = [:]
    for item in components.queryItems ?? [] {
        if let value = item.value { result[item.name] = value }
    }
    return result
}

private let youtubeIdRegex = try! NSRegularExpression(pattern: "^[A-Za-z0-9_-]{11}$")

// El id del video de un enlace de YouTube compartido desde su app o el navegador
// (youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, music.youtube.com...). El texto compartido
// puede traer el título antes del enlace, así que se busca el primer enlace que aparezca.
func youtubeVideoId(_ sharedText: String?) -> String? {
    let source = sharedText ?? ""
    guard let urlRegex = try? NSRegularExpression(pattern: "https?://\\S+") else { return nil }
    let range = NSRange(source.startIndex..., in: source)
    guard let match = urlRegex.firstMatch(in: source, range: range),
          let matchRange = Range(match.range, in: source) else { return nil }
    let url = String(source[matchRange])
    guard let uri = URLComponents(string: url) else { return nil }
    guard var host = uri.host?.lowercased() else { return nil }
    if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
    if host.hasPrefix("m.") { host = String(host.dropFirst(2)) }
    let segments = uri.path.split(separator: "/").map(String.init).filter { !$0.isEmpty }
    var candidate: String?
    switch host {
    case "youtu.be":
        candidate = segments.first
    case "youtube.com", "music.youtube.com":
        switch segments.first {
        case "watch": candidate = queryParams(uri)["v"]
        case "shorts", "live", "embed": candidate = segments.count > 1 ? segments[1] : nil
        default: candidate = nil
        }
    default:
        candidate = nil
    }
    guard let id = candidate, matches(youtubeIdRegex, id) else { return nil }
    return id
}
