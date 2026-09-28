package xyz.xalcker.xaraoke.room

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import xyz.xalcker.xaraoke.core.CloseAction
import xyz.xalcker.xaraoke.core.NowPlaying
import xyz.xalcker.xaraoke.core.QueueItem
import xyz.xalcker.xaraoke.core.RatingRequest
import xyz.xalcker.xaraoke.core.TurnTracker
import xyz.xalcker.xaraoke.core.closeAction
import xyz.xalcker.xaraoke.core.nextRetryDelayMs

// Avisos sueltos de la sala que la pantalla muestra como un mensaje breve.
sealed interface RoomEvent {
    data class AddRejected(val personalLimit: Boolean, val limit: Int) : RoomEvent
    data object HostBack : RoomEvent
    data object DownloadsChanged : RoomEvent
}

// La conexión en tiempo real con una sala: el mismo protocolo que public/remote.js, sobre el
// WebSocket de OkHttp. Vive fuera de la pantalla (la tiene AppController) para que siga conectada
// con el teléfono bloqueado y pueda avisar cuando te toca.
class RoomConnection(
    private val client: OkHttpClient,
    private val webSocketUrl: String,
    roomCode: String,
    myName: String,
    private val scope: CoroutineScope,
    private val onTurn: (TurnTracker.Alert, RoomState) -> Unit,
    private val onEvent: (RoomEvent) -> Unit,
    private val onExit: (RoomExit) -> Unit,
) {
    private val _state = MutableStateFlow(RoomState(roomCode = roomCode, myName = myName))
    val state: StateFlow<RoomState> = _state

    private val turns = TurnTracker()
    private var socket: WebSocket? = null
    // Cada socket nuevo tiene su número: los avisos que lleguen tarde de uno viejo se ignoran.
    private var generation = 0
    private var attempt = 0
    private var retryJob: Job? = null
    private var skipPendingJob: Job? = null
    private var bannerJob: Job? = null
    private var closed = false

    @Synchronized
    fun start() {
        if (closed) return
        retryJob?.cancel()
        socket?.cancel()
        val myGeneration = ++generation
        _state.update { it.copy(connection = if (attempt == 0) Connection.CONNECTING else Connection.RETRYING) }
        val request = Request.Builder().url("$webSocketUrl/?sala=${_state.value.roomCode}").build()
        socket = client.newWebSocket(request, Listener(myGeneration))
    }

    // Reintenta ya, sin esperar el siguiente intento (volvió la red, se abrió la app).
    @Synchronized
    fun reconnectNow() {
        if (closed || _state.value.connection != Connection.RETRYING) return
        attempt = 0
        start()
    }

    @Synchronized
    fun close() {
        closed = true
        retryJob?.cancel()
        skipPendingJob?.cancel()
        bannerJob?.cancel()
        socket?.close(1000, "Salió de la sala")
        socket = null
    }

    // Devuelve false si no hay conexión en este momento: la pantalla avisa en vez de hacer como
    // que se hizo.
    fun send(type: String, payload: JSONObject = JSONObject()): Boolean {
        if (_state.value.connection != Connection.OPEN) return false
        return socket?.send(JSONObject().put("type", type).put("payload", payload).toString()) == true
    }

    // --- acciones del remoto ---

    // Se pide la acción explícita según lo que se ve, no "alternar": si dos personas tocan a la
    // vez, las dos piden lo mismo y no se cancelan entre sí.
    fun playPause(): Boolean =
        send("controlAction", JSONObject().put("action", if (_state.value.paused) "play" else "pause"))

    // Se salta esa canción concreta: si mientras se confirmaba ya cambió, no se salta la siguiente.
    fun skip(songId: String): Boolean {
        if (_state.value.head?.id != songId) return true
        if (!send("controlAction", JSONObject().put("action", "skip").put("id", songId))) return false
        _state.update { it.copy(skipPendingId = songId) }
        skipPendingJob?.cancel()
        skipPendingJob = scope.launch {
            delay(4_000)
            _state.update { it.copy(skipPendingId = null) }
        }
        return true
    }

    fun voteSkip(songId: String): Boolean = send("voteSkip", JSONObject().put("id", songId))

    fun addSong(filename: String): Boolean = send("addSong", JSONObject().put("song", filename))

    fun removeSong(songId: String): Boolean = send("removeSong", JSONObject().put("id", songId))

    fun moveSong(songId: String, up: Boolean): Boolean =
        send("moveSong", JSONObject().put("id", songId).put("direction", if (up) "up" else "down"))

    // value: 1 (bien), -1 (mal) o 0 ("ahora no").
    fun rate(ratingId: String, value: Int): Boolean {
        if (!send("rateSong", JSONObject().put("id", ratingId).put("value", value))) return false
        resolveRating(ratingId)
        return true
    }

    fun dismissTurnBanner() {
        bannerJob?.cancel()
        _state.update { it.copy(turnBanner = false) }
    }

    // "¡Prepárate!": se quita cuando tu canción empieza (ver onQueue) y, por si ese cambio no llega
    // (se cortó la conexión justo después), a los 15 segundos, igual que en el web.
    private fun showTurnBanner() {
        _state.update { it.copy(turnBanner = true) }
        bannerJob?.cancel()
        bannerJob = scope.launch {
            delay(15_000)
            _state.update { it.copy(turnBanner = false) }
        }
    }

    // --- mensajes del servidor ---

    private fun handle(text: String) {
        val message = runCatching { JSONObject(text) }.getOrNull() ?: return
        val payload = message.optJSONObject("payload")
        when (message.optString("type")) {
            "queueUpdate" -> onQueue(message.optJSONArray("payload") ?: JSONArray())
            "timeUpdate" -> onTime(payload)
            "hostStatus" -> {
                val connected = payload?.optBoolean("connected", true) != false
                val returned = connected && !_state.value.hostConnected
                _state.update { it.copy(hostConnected = connected) }
                if (returned) onEvent(RoomEvent.HostBack)
            }
            "addSongRejected" -> onEvent(
                RoomEvent.AddRejected(
                    personalLimit = payload?.optString("reason") == "personalLimit",
                    limit = payload?.optInt("limit") ?: 0,
                )
            )
            "downloadsChanged" -> onEvent(RoomEvent.DownloadsChanged)
            "playbackState" -> _state.update { it.copy(paused = payload?.optBoolean("paused") == true) }
            "controlAccess" -> _state.update { it.copy(controlAllowed = payload?.optBoolean("allowed") == true) }
            "skipVotes" -> _state.update {
                it.copy(
                    skipVotes = SkipVotes(
                        songId = payload?.optString("id")?.takeIf { id -> id.isNotEmpty() },
                        count = payload?.optInt("count") ?: 0,
                        threshold = payload?.optInt("threshold", it.skipVotes.threshold) ?: it.skipVotes.threshold,
                        voted = payload?.optBoolean("voted") == true,
                    )
                )
            }
            "ratingRequest" -> {
                val id = payload?.optString("id").orEmpty()
                val song = payload?.optString("song").orEmpty()
                if (id.isEmpty() || song.isEmpty()) return
                val title = payload?.optString("title")?.takeIf { it.isNotEmpty() }
                _state.update { s ->
                    // El servidor la reenvía al reconectar.
                    if (s.ratingRequests.any { it.id == id }) s
                    else s.copy(ratingRequests = s.ratingRequests + RatingRequest(id, song, title))
                }
            }
            "ratingResolved" -> payload?.optString("id")?.let(::resolveRating)
        }
    }

    private fun onQueue(array: JSONArray) {
        val queue = (0 until array.length()).mapNotNull { i ->
            val item = array.optJSONObject(i) ?: return@mapNotNull null
            QueueItem(
                id = item.optString("id"),
                song = item.optString("song"),
                name = item.optString("name"),
                title = item.optString("title").takeIf { it.isNotEmpty() },
            )
        }
        _state.update { s ->
            val nextIsMine = queue.getOrNull(1)?.let { s.myName.isNotEmpty() && it.name == s.myName } == true
            s.copy(
                queue = queue,
                nowPlaying = if (queue.isEmpty()) null else s.nowPlaying,
                // Si arriba ya no está la canción cuyo salto se pidió, el salto ya ocurrió.
                skipPendingId = s.skipPendingId?.takeIf { queue.firstOrNull()?.id == it },
                turnBanner = s.turnBanner && nextIsMine,
            )
        }
        val current = _state.value
        // Tu canción empezó sin el aviso previo: suena y vibra, pero sin "¡Prepárate!" en pantalla
        // (ya no está "por empezar", y nada lo quitaría hasta el siguiente cambio de la cola).
        turns.onQueue(queue, current.myName)?.let { alert -> onTurn(alert, current) }
    }

    private fun onTime(payload: JSONObject?) {
        val song = payload?.optString("song").orEmpty()
        if (payload == null || song.isEmpty()) {
            _state.update { it.copy(nowPlaying = null) }
            return
        }
        val np = NowPlaying(
            song = song,
            title = payload.optString("title").takeIf { it.isNotEmpty() },
            currentTime = payload.optDouble("currentTime", 0.0).takeUnless { it.isNaN() } ?: 0.0,
            duration = payload.optDouble("duration", 0.0).takeUnless { it.isNaN() } ?: 0.0,
        )
        _state.update { it.copy(nowPlaying = np) }
        if (np.duration <= 0) return
        val current = _state.value
        turns.onTime(np.duration - np.currentTime, current.queue, current.myName)?.let { alert ->
            showTurnBanner()
            onTurn(alert, _state.value)
        }
    }

    private fun resolveRating(id: String) =
        _state.update { s -> s.copy(ratingRequests = s.ratingRequests.filterNot { it.id == id }) }

    // --- cierre y reconexión ---

    @Synchronized
    private fun onSocketGone(myGeneration: Int, code: Int?) {
        if (closed || myGeneration != generation) return
        socket = null
        val action = if (code == null) CloseAction.RETRY else closeAction(code)
        if (action == CloseAction.RETRY) {
            _state.update { it.copy(connection = Connection.RETRYING) }
            val wait = nextRetryDelayMs(attempt++)
            retryJob = scope.launch {
                delay(wait)
                start()
            }
            return
        }
        closed = true
        onExit(
            when (action) {
                CloseAction.ROOM_GONE -> RoomExit.ROOM_GONE
                CloseAction.LOGIN -> RoomExit.SESSION_EXPIRED
                CloseAction.NAME_TAKEN -> RoomExit.NAME_TAKEN
                else -> RoomExit.REJECTED
            }
        )
    }

    private inner class Listener(private val myGeneration: Int) : WebSocketListener() {
        private fun current() = myGeneration == generation && !closed

        override fun onOpen(webSocket: WebSocket, response: Response) {
            if (!current()) return
            attempt = 0
            turns.onConnected()
            _state.update { it.copy(connection = Connection.OPEN) }
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (current()) handle(text)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, null)
            onSocketGone(myGeneration, code)
        }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            onSocketGone(myGeneration, null)
        }
    }
}
