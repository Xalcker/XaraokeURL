package xyz.xalcker.xaraoke.room

import xyz.xalcker.xaraoke.core.NowPlaying
import xyz.xalcker.xaraoke.core.QueueItem
import xyz.xalcker.xaraoke.core.RatingRequest

enum class Connection { CONNECTING, OPEN, RETRYING }

data class SkipVotes(val songId: String?, val count: Int, val threshold: Int, val voted: Boolean)

// Todo lo que el remoto sabe de la sala en la que está. Lo mantiene RoomConnection a partir de los
// mensajes del servidor, y lo dibujan la pantalla y la notificación.
data class RoomState(
    val roomCode: String,
    val myName: String,
    val connection: Connection = Connection.CONNECTING,
    val queue: List<QueueItem> = emptyList(),
    // Lo último que informó el host de la canción que suena (null hasta que informa).
    val nowPlaying: NowPlaying? = null,
    val paused: Boolean = false,
    val hostConnected: Boolean = true,
    // Lo decide el servidor: pausar, reanudar y saltar son de quien canta.
    val controlAllowed: Boolean = false,
    val skipVotes: SkipVotes = SkipVotes(null, 0, 3, false),
    // Canción cuyo salto ya se pidió y aún no se ve en la cola (evita el doble toque).
    val skipPendingId: String? = null,
    val ratingRequests: List<RatingRequest> = emptyList(),
    // "¡Prepárate!": se muestra cuando toca y se quita cuando la siguiente deja de ser tuya.
    val turnBanner: Boolean = false,
) {
    val head: QueueItem? get() = queue.firstOrNull()

    fun isMine(item: QueueItem) = myName.isNotEmpty() && item.name == myName

    // Hay algo que controlar: una canción sonando y el host conectado.
    val active: Boolean get() = hostConnected && queue.isNotEmpty()

    // Con la canción de otra persona, el botón de saltar vota en vez de saltar.
    val skipVoteMode: Boolean get() = active && !controlAllowed && head?.let { !isMine(it) } == true

    val canPlayPause: Boolean get() = active && controlAllowed

    val canSkip: Boolean get() = skipVoteMode || (active && controlAllowed && skipPendingId == null)

    // Solo cuenta el tiempo que informó el host si es de la canción que está arriba de la cola.
    val headProgress: NowPlaying?
        get() = nowPlaying?.takeIf { np -> head?.song == np.song }
}

// Por qué se salió de la sala sin que la persona lo pidiera.
enum class RoomExit { ROOM_GONE, SESSION_EXPIRED, NAME_TAKEN, REJECTED }
