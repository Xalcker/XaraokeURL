// Decide cuándo avisar "te toca cantar", una sola vez por canción.
// Equivalente a android/app/src/main/java/xyz/xalcker/xaraoke/core/TurnTracker.kt
//
//   upNext:   tu canción es la siguiente y a la que suena le quedan 10 segundos o menos (lo mismo
//             que el remoto web).
//   starting: tu canción pasó a ser la de arriba sin que hubiera aviso previo (por ejemplo,
//             porque saltaron la anterior). El web no avisa en este caso: con el teléfono en el
//             bolsillo, es justo cuando más falta hace.
//
// La primera cola después de conectar no avisa starting: quien abre la app con su canción ya
// sonando no necesita que el teléfono le grite.

import Foundation

final class TurnTracker {
    enum Kind { case upNext, starting }

    struct Alert: Equatable {
        let kind: Kind
        let songId: String
    }

    // Orden de inserción preservado para poder olvidar los más viejos.
    private var alerted: [String] = []
    private var alertedSet = Set<String>()
    private var primed = false

    // Se llama al abrir cada conexión nueva con la sala.
    func onConnected() {
        primed = false
    }

    func onQueue(_ queue: [QueueItem], me: String) -> Alert? {
        let first = !primed
        primed = true
        guard let head = queue.first else { return nil }
        if me.isEmpty || head.name != me || alertedSet.contains(head.id) { return nil }
        remember(head.id)
        return first ? nil : Alert(kind: .starting, songId: head.id)
    }

    func onTime(remainingSeconds: Double, queue: [QueueItem], me: String) -> Alert? {
        if remainingSeconds <= 0 || remainingSeconds > 10 { return nil }
        guard queue.count > 1 else { return nil }
        let next = queue[1]
        if me.isEmpty || next.name != me || alertedSet.contains(next.id) { return nil }
        remember(next.id)
        return Alert(kind: .upNext, songId: next.id)
    }

    private func remember(_ id: String) {
        alerted.append(id)
        alertedSet.insert(id)
        // Solo importan las últimas: los ids no se repiten.
        while alerted.count > 50 {
            let oldest = alerted.removeFirst()
            alertedSet.remove(oldest)
        }
    }
}

// ¿Cuántas canciones faltan antes de la primera tuya? nil si no tienes ninguna.
func songsBeforeMyTurn(_ queue: [QueueItem], me: String) -> Int? {
    if me.isEmpty { return nil }
    if let index = queue.firstIndex(where: { $0.name == me }) { return index }
    return nil
}
