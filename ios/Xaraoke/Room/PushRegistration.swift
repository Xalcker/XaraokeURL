// Registro de notificaciones push (APNs) y envío del device token al servidor.
// Fase 5: el aviso de turno con la app cerrada. iOS suspende el WebSocket propio en segundo plano,
// así que el servidor manda un push cuando falten ~10 s o cambie la cabecera de la cola.
//
// Contrato con el servidor (nuevo en Fase 5):
//   POST /api/push/register  { "token": "<hex>", "platform": "ios", "room": "ABCD" }
//   POST /api/push/unregister { "token": "<hex>" }
// La sesión (cookie) identifica a la persona; el servidor asocia token → nombre → sala.
//
// Configuración en Xcode: capacidad "Push Notifications" y "Background Modes → Remote notifications",
// y una key APNs en la cuenta Apple Developer (la usa el servidor, no la app).

import Foundation
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class PushRegistration {
    static let shared = PushRegistration()

    private(set) var deviceToken: String?
    // El servidor y la sala a los que registrar cuando llegue el token (o al cambiar de sala).
    private var api: ServerApi?
    private var room: String?

    // Lo llama AppController al entrar a una sala: pide el token al sistema y recuerda a dónde
    // registrarlo. El token llega de forma asíncrona en didRegisterForRemoteNotifications.
    func enable(api: ServerApi, room: String) {
        self.api = api
        self.room = room
        #if canImport(UIKit)
        UIApplication.shared.registerForRemoteNotifications()
        #endif
        // Si el token ya estaba, se registra de una vez con la sala nueva.
        if deviceToken != nil { registerIfReady() }
    }

    // Al salir de la sala: se olvida el token en el servidor para no recibir más avisos.
    func disable() {
        guard let api = api, let token = deviceToken else { room = nil; return }
        let previous = api
        room = nil
        Task { await previous.unregisterPush(token: token) }
    }

    // Lo llama el AppDelegate cuando el sistema entrega el token.
    func didReceive(tokenData: Data) {
        deviceToken = tokenData.map { String(format: "%02x", $0) }.joined()
        registerIfReady()
    }

    func didFail(_ error: Error) {
        // Sin token no hay push; el aviso en primer plano (haptics) sigue funcionando.
        deviceToken = nil
    }

    private func registerIfReady() {
        guard let api = api, let room = room, let token = deviceToken else { return }
        Task { await api.registerPush(token: token, room: room) }
    }

    // El token de push de la Live Activity (distinto del device token): el servidor lo usa para
    // actualizar la actividad en segundo plano. Lo entrega RoomActivityManager al arrancarla.
    func reportActivityToken(_ token: String, room: String) async {
        guard let api = api else { return }
        await api.registerActivityPush(token: token, room: room)
    }
}
