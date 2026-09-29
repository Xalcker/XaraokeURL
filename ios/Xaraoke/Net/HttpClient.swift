// Construye el URLSession que usan ServerApi y RoomConnection, con el mismo comportamiento que el
// OkHttpClient de android/.../AppController.kt:
//   - No seguir redirects: /api/me manda a /login cuando no hay sesión; eso se detecta, no se sigue.
//   - Accept-Language con el idioma del sistema: los errores del servidor llegan ya traducidos.
//   - Timeouts: conectar 10 s; descargar de YouTube puede tardar (el servidor responde al terminar).
//   - Cookies gestionadas por HTTPCookieStorage (ver CookiePersistence).

import Foundation

final class HttpClient: NSObject, URLSessionTaskDelegate {
    let cookies: CookiePersistence
    private(set) lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 10
        // Descargar de YouTube puede tardar: el servidor responde cuando termina.
        config.timeoutIntervalForResource = 180
        config.httpAdditionalHeaders = [
            "Accept-Language": Locale.preferredLanguages.first ?? "en"
        ]
        // `self` como delegate: es quien decide no seguir los redirects.
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    override init() {
        self.cookies = CookiePersistence()
        super.init()
    }

    // Un URLSession con este delegate no sigue los 3xx: entrega la respuesta de redirección tal cual,
    // para que ServerApi vea el 302 a /login y sepa que la sesión venció.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}
