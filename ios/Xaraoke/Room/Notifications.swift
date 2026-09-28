// Avisos de la app en iOS: implementa RoomNotifying (ver AppController).
// Equivalente a android/.../room/Notifications.kt, adaptado a iOS.
//
// Diferencias con Android por diseño de la plataforma:
//   - No hay servicio en primer plano ni notificación fija "ongoing": con la app abierta se avisa
//     de tu turno (sonido + vibración); con la app cerrada, iOS suspende el WebSocket, así que el
//     aviso con pantalla bloqueada llega en la Fase 5 vía push/Live Activity.
//   - El "canal Tu turno" de Android es aquí una notificación con interruptionLevel .timeSensitive.
//
// Sonido: coloca `turn_alert.caf` (convertido de public/notification.mp3) en el bundle para el
// aviso; si no está, se usa el sonido por defecto.

import Foundation
import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

@MainActor
final class Notifications: RoomNotifying {
    static let shared = Notifications()

    private let center = UNUserNotificationCenter.current()
    private let turnId = "turn"
    private let sessionId = "session"
    private let soundName = "turn_alert.caf"

    // Se pide al entrar a una sala (lo dispara la UI). Sin permiso no hay aviso con la app cerrada.
    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .sound, .badge])) ?? false
    }

    func canNotify() async -> Bool {
        await center.notificationSettings().authorizationStatus == .authorized
    }

    // "¡Te toca!". Con la app en primer plano: sonido y vibración. En segundo plano: notificación
    // urgente (time-sensitive). Igual criterio que Android (appInForeground).
    func alertTurn(_ alert: TurnTracker.Alert, state: RoomState) {
        if appInForeground {
            playSoundAndVibrate()
            return
        }
        let song = state.queue.first { $0.id == alert.songId }
        let unknown = L("unknown_artist")
        let body = song.map {
            let d = songDisplay($0.song, title: $0.title, unknownArtist: unknown)
            return L("now_playing", d.artist, d.title)
        } ?? ""
        let content = UNMutableNotificationContent()
        content.title = L(alert.kind == .upNext ? "notif_turn_title" : "notif_playing_title")
        content.body = body
        content.sound = turnSound
        if #available(iOS 15.0, *) { content.interruptionLevel = .timeSensitive }
        let request = UNNotificationRequest(identifier: turnId, content: content, trigger: nil)
        center.add(request, withCompletionHandler: nil)
    }

    func cancelTurn() {
        center.removePendingNotificationRequests(withIdentifiers: [turnId])
        center.removeDeliveredNotifications(withIdentifiers: [turnId])
    }

    // La sesión venció con la app en segundo plano: se pide volver a entrar.
    func sessionExpired() {
        Task {
            guard await canNotify() else { return }
            let content = UNMutableNotificationContent()
            content.title = L("app_name")
            content.body = L("conn_session_expired")
            let request = UNNotificationRequest(identifier: sessionId, content: content, trigger: nil)
            center.add(request, withCompletionHandler: nil)
        }
    }

    // La "notificación fija" de Android es aquí una Live Activity (Fase 5): se arranca al entrar a
    // la sala, se actualiza con cada cambio de estado, y se termina al salir. Solo iOS 16.1+.
    func roomStarted() {}

    func roomStopped() {
        if #available(iOS 16.1, *) { RoomActivityManager.shared.end() }
    }

    func roomStateChanged(_ state: RoomState) {
        if #available(iOS 16.1, *) {
            RoomActivityManager.shared.start(state)  // arranca la primera vez; luego actualiza
        }
    }

    // --- detalles ---

    private var turnSound: UNNotificationSound {
        // Usa turn_alert.caf si está en el bundle; si no, el sonido por defecto.
        if Bundle.main.url(forResource: "turn_alert", withExtension: "caf") != nil {
            return UNNotificationSound(named: UNNotificationSoundName(soundName))
        }
        return .default
    }

    private var appInForeground: Bool {
        #if canImport(UIKit)
        UIApplication.shared.applicationState == .active
        #else
        false
        #endif
    }

    private func playSoundAndVibrate() {
        #if canImport(UIKit)
        UINotificationFeedbackGenerator().notificationOccurred(.warning)
        #endif
        // El sonido audible con la app abierta se maneja al reproducir turn_alert con AVAudioPlayer
        // en la Fase 4.1 (opcional); la vibración por haptics ya cubre el aviso principal.
    }
}
