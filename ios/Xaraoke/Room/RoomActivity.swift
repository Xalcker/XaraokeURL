// Atributos de la Live Activity de la sala: la "notificación fija" de Android en iOS.
// Fase 5. La Live Activity vive en la pantalla de bloqueo / Isla Dinámica y muestra lo que suena y
// cuánto falta para tu turno, actualizándose desde la app (en primer plano) o por push del servidor
// (en segundo plano). Equivalente a la notificación "ongoing" de room/Notifications.kt.
//
// Este archivo se comparte entre la app y el widget de la Live Activity (mismo módulo de atributos).
// Requiere iOS 16.1+ y la capacidad de Live Activities; el widget va en un target aparte
// (XaraokeWidget) que también incluye este archivo y RoomActivityView.swift.

import Foundation
#if canImport(ActivityKit)
import ActivityKit

@available(iOS 16.1, *)
struct RoomActivityAttributes: ActivityAttributes {
    // Lo fijo de la actividad: el código de la sala.
    let roomCode: String

    // Lo que cambia: lo que suena y cuántas canciones faltan para tu turno.
    struct ContentState: Codable, Hashable {
        let nowPlaying: String     // "Artista - Título" o vacío
        let paused: Bool
        let songsAhead: Int?       // nil = no tienes canciones; 0 = suena la tuya; 1 = eres la siguiente
        let hostConnected: Bool
    }
}
#endif
