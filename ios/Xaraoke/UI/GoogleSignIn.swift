// Inicio de sesión con Google en iOS.
// Equivalente a signInWithGoogle de android/.../ui/PlayServices.kt (allí con Credential Manager).
//
// Usa el SDK oficial GoogleSignIn (se agrega con Swift Package Manager desde Xcode:
//   https://github.com/google/GoogleSignIn-iOS). El código está detrás de `#if canImport(GoogleSignIn)`
// para que el proyecto compile aun antes de añadir el paquete; sin el paquete, el inicio de sesión
// reporta que no está disponible.
//
// El flujo es el mismo que en Android: se pide un ID token cuya audiencia sea el client ID "Web"
// del servidor (serverClientId), y ese token se manda a POST /api/auth/google-token, que lo verifica.
//
// Configuración en Xcode (Fase 4):
//   - Añadir el paquete GoogleSignIn-iOS.
//   - En Info.plist, CFBundleURLTypes con el REVERSED_CLIENT_ID del client OAuth iOS.
//   - Registrar en Google Cloud un OAuth Client ID de tipo iOS con el Bundle ID de la app.

import Foundation
#if canImport(UIKit)
import UIKit
#endif
#if canImport(GoogleSignIn)
import GoogleSignIn
#endif

enum GoogleSignInResult {
    case token(String)
    case cancelled
    case failed(String?)
}

@MainActor
enum GoogleSignIn {
    // `serverClientId`: el client ID "Web" del servidor (la audiencia que el servidor verifica).
    // `allowedDomain`: si el servidor restringe a un dominio, se sugiere (hint) esa cuenta.
    static func signIn(serverClientId: String, allowedDomain: String?) async -> GoogleSignInResult {
        #if canImport(GoogleSignIn) && canImport(UIKit)
        guard let presenter = topViewController() else { return .failed(nil) }
        do {
            // Pide el ID token con audiencia = serverClientId (equivalente a setServerClientId).
            let config = GIDConfiguration(clientID: try clientId(), serverClientID: serverClientId)
            GIDSignIn.sharedInstance.configuration = config
            let result = try await GIDSignIn.sharedInstance.signIn(
                withPresenting: presenter,
                hint: allowedDomain.flatMap { _ in nil }  // hint es por cuenta, no por dominio
            )
            // El servidor pide el idToken; GoogleSignIn lo entrega en el usuario resultante.
            guard let idToken = result.user.idToken?.tokenString else { return .failed(nil) }
            return .token(idToken)
        } catch let error as NSError where error.code == GIDSignInError.canceled.rawValue {
            return .cancelled
        } catch {
            return .failed(error.localizedDescription)
        }
        #else
        // Sin el paquete GoogleSignIn: el servidor con Google no se puede usar todavía desde iOS.
        return .failed(nil)
        #endif
    }

    // Olvida la cuenta elegida, para que al volver a iniciar sesión se pueda escoger otra.
    static func signOut() {
        #if canImport(GoogleSignIn)
        GIDSignIn.sharedInstance.signOut()
        #endif
    }

    // Maneja la vuelta del navegador de Google (se llama desde onOpenURL).
    static func handle(_ url: URL) -> Bool {
        #if canImport(GoogleSignIn)
        return GIDSignIn.sharedInstance.handle(url)
        #else
        return false
        #endif
    }

    #if canImport(GoogleSignIn) && canImport(UIKit)
    // El client ID iOS de la app (del GoogleService-Info o Info.plist). Lo necesita GIDConfiguration.
    private static func clientId() throws -> String {
        if let id = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String { return id }
        throw NSError(domain: "Xaraoke", code: -1, userInfo: [NSLocalizedDescriptionKey: "Falta GIDClientID en Info.plist"])
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let root = scenes.flatMap { $0.windows }.first { $0.isKeyWindow }?.rootViewController
        var top = root
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
    #endif
}
