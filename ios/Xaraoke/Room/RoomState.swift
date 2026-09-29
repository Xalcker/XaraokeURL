// Todo lo que el remoto sabe de la sala en la que está. Lo mantiene RoomConnection a partir de los
// mensajes del servidor, y lo dibujan la pantalla y la notificación.
// Equivalente a android/.../room/RoomState.kt

import Foundation

enum Connection { case connecting, open, retrying }

struct SkipVotes: Equatable {
    let songId: String?
    let count: Int
    let threshold: Int
    let voted: Bool
}

struct RoomState: Equatable {
    let roomCode: String
    let myName: String
    var connection: Connection = .connecting
    var queue: [QueueItem] = []
    // Lo último que informó el host de la canción que suena (nil hasta que informa).
    var nowPlaying: NowPlaying? = nil
    var paused: Bool = false
    var hostConnected: Bool = true
    // Lo decide el servidor: pausar, reanudar y saltar son de quien canta.
    var controlAllowed: Bool = false
    var skipVotes: SkipVotes = SkipVotes(songId: nil, count: 0, threshold: 3, voted: false)
    // Canción cuyo salto ya se pidió y aún no se ve en la cola (evita el doble toque).
    var skipPendingId: String? = nil
    var ratingRequests: [RatingRequest] = []
    // "¡Prepárate!": se muestra cuando toca y se quita cuando la siguiente deja de ser tuya.
    var turnBanner: Bool = false

    var head: QueueItem? { queue.first }

    func isMine(_ item: QueueItem) -> Bool { !myName.isEmpty && item.name == myName }

    // Hay algo que controlar: una canción sonando y el host conectado.
    var active: Bool { hostConnected && !queue.isEmpty }

    // Con la canción de otra persona, el botón de saltar vota en vez de saltar.
    var skipVoteMode: Bool {
        guard active, !controlAllowed, let head = head else { return false }
        return !isMine(head)
    }

    var canPlayPause: Bool { active && controlAllowed }

    var canSkip: Bool { skipVoteMode || (active && controlAllowed && skipPendingId == nil) }

    // Solo cuenta el tiempo que informó el host si es de la canción que está arriba de la cola.
    var headProgress: NowPlaying? {
        guard let np = nowPlaying, head?.song == np.song else { return nil }
        return np
    }
}

// Por qué se salió de la sala sin que la persona lo pidiera.
enum RoomExit { case roomGone, sessionExpired, nameTaken, rejected }

extension Connection: Equatable {}
