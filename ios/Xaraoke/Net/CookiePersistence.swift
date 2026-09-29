// Guarda la cookie de sesión del servidor (connect.sid) entre aperturas de la app: es lo que dice
// quién eres, igual que en el navegador.
// Equivalente a android/.../net/PersistentCookieJar.kt
//
// En iOS, URLSession usa HTTPCookieStorage. Las cookies persistentes (con fecha de vencimiento) se
// guardan solas en el almacén compartido; este tipo añade la persistencia a disco entre lanzamientos
// y el "olvidar la sesión de un servidor" (cerrar sesión), que es lo que hacía clearFor en Android.

import Foundation

final class CookiePersistence {
    private let storage: HTTPCookieStorage
    private let defaults: UserDefaults
    private let key = "cookies"

    init(storage: HTTPCookieStorage = .shared, defaults: UserDefaults = .standard) {
        self.storage = storage
        self.defaults = defaults
        restore()
    }

    // Vuelca las cookies persistentes a UserDefaults. Se llama tras cada petición que pudo traer
    // Set-Cookie (URLSession ya las metió en el storage; aquí solo se serializan a disco).
    func persist() {
        let cookies = storage.cookies ?? []
        let items: [[HTTPCookiePropertyKey: Any]] = cookies.compactMap { cookie in
            // Sin fecha de vencimiento, la cookie es de sesión y no se guarda (igual que un navegador).
            guard cookie.expiresDate != nil, let props = cookie.properties else { return nil }
            return props
        }
        let encodable = items.map { dict in
            dict.reduce(into: [String: String]()) { acc, pair in
                acc[pair.key.rawValue] = "\(pair.value)"
            }
        }
        defaults.set(encodable, forKey: key)
    }

    private func restore() {
        guard let saved = defaults.array(forKey: key) as? [[String: String]] else { return }
        let now = Date()
        for dict in saved {
            var props: [HTTPCookiePropertyKey: Any] = [:]
            for (k, v) in dict { props[HTTPCookiePropertyKey(k)] = v }
            guard let cookie = HTTPCookie(properties: props) else { continue }
            if let expires = cookie.expiresDate, expires <= now { continue }
            storage.setCookie(cookie)
        }
    }

    // Olvida la sesión de un servidor (cerrar sesión).
    func clearFor(_ url: URL) {
        guard let host = url.host else { return }
        for cookie in storage.cookies(for: url) ?? [] {
            storage.deleteCookie(cookie)
        }
        // Por si el dominio de la cookie difiere del host exacto (subdominios).
        for cookie in storage.cookies ?? [] where cookie.domain.contains(host) || host.contains(cookie.domain.drop(while: { $0 == "." })) {
            storage.deleteCookie(cookie)
        }
        persist()
    }
}
