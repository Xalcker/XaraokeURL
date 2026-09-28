package xyz.xalcker.xaraoke

import androidx.core.content.edit
import android.app.Application
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import java.util.Locale
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import xyz.xalcker.xaraoke.core.AuthConfig
import xyz.xalcker.xaraoke.core.Download
import xyz.xalcker.xaraoke.core.JoinLink
import xyz.xalcker.xaraoke.core.RatingTotals
import xyz.xalcker.xaraoke.core.SongLibrary
import xyz.xalcker.xaraoke.core.normalizeRoomCode
import xyz.xalcker.xaraoke.core.normalizeServerUrl
import xyz.xalcker.xaraoke.net.ApiException
import xyz.xalcker.xaraoke.net.PersistentCookieJar
import xyz.xalcker.xaraoke.net.ServerApi
import xyz.xalcker.xaraoke.net.YoutubeSearch
import xyz.xalcker.xaraoke.room.Notifications
import xyz.xalcker.xaraoke.room.RoomConnection
import xyz.xalcker.xaraoke.room.RoomEvent
import xyz.xalcker.xaraoke.room.RoomExit
import xyz.xalcker.xaraoke.room.RoomService
import xyz.xalcker.xaraoke.room.RoomState

// El servidor al que se conecta la app y quién eres en él.
data class SessionState(
    val serverUrl: String? = null,
    val auth: AuthConfig? = null,
    val loadingServer: Boolean = false,
    val serverError: UiText? = null,
    // Con Google: tu nombre si hay sesión. Sin Google: el nombre que elegiste (null si aún no).
    val myName: String? = null,
    val signingIn: Boolean = false,
    val roomCode: String = "",
    val nameInput: String = "",
    val joining: Boolean = false,
    val joinError: UiText? = null,
    // Sube cada vez que hace falta iniciar sesión con Google: la pantalla lo ve y abre Credential Manager.
    val googleSignInRequest: Int = 0,
)

data class LibraryState(
    val songs: SongLibrary = emptyMap(),
    val loaded: Boolean = false,
    val loadFailed: Boolean = false,
    val downloads: List<Download> = emptyList(),
    val ratings: Map<String, RatingTotals> = emptyMap(),
) {
    val flatSongs: List<String> by lazy { songs.values.flatMap { it.values }.flatten() }
}

// Todo lo que no es pantalla: el servidor, la sesión, la biblioteca y la sala. Vive lo que vive la
// app (no la pantalla), así que la sala sigue conectada con la app cerrada.
class AppController(private val app: Application) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val prefs = app.getSharedPreferences("xaraoke", Context.MODE_PRIVATE)
    private val cookies = PersistentCookieJar(app)

    private val client = OkHttpClient.Builder()
        .cookieJar(cookies)
        // /api/me manda a /login cuando no hay sesión: eso se detecta, no se sigue.
        .followRedirects(false)
        .connectTimeout(10, TimeUnit.SECONDS)
        // Descargar de YouTube puede tardar: el servidor responde cuando termina.
        .readTimeout(3, TimeUnit.MINUTES)
        // Detecta una conexión muerta (se cortó el WiFi) sin esperar a que el sistema se entere.
        .pingInterval(20, TimeUnit.SECONDS)
        // Los mensajes de error del servidor, en el idioma del teléfono.
        .addInterceptor { chain ->
            chain.proceed(
                chain.request().newBuilder().header("Accept-Language", Locale.getDefault().toLanguageTag()).build()
            )
        }
        .build()

    private var api: ServerApi? = null
    private var connection: RoomConnection? = null
    // Entrar sola a la sala en cuanto haya sesión (venía en un enlace o era la última).
    private var autoJoin = false

    private val _session = MutableStateFlow(SessionState())
    val session: StateFlow<SessionState> = _session

    private val _room = MutableStateFlow<RoomState?>(null)
    val room: StateFlow<RoomState?> = _room

    private val _library = MutableStateFlow(LibraryState())
    val library: StateFlow<LibraryState> = _library

    private val _toasts = MutableSharedFlow<UiText>(extraBufferCapacity = 8)
    val toasts: SharedFlow<UiText> = _toasts

    // Video de YouTube compartido a la app, esperando confirmación para agregarlo.
    private val _pendingShare = MutableStateFlow<String?>(null)
    val pendingShare: StateFlow<String?> = _pendingShare

    init {
        prefs.getString(KEY_SERVER, null)?.let { server ->
            _session.update { it.copy(serverUrl = server, roomCode = prefs.getString(KEY_ROOM, null).orEmpty()) }
            autoJoin = prefs.getString(KEY_ROOM, null) != null
            loadServer()
        }
        // Volvió la red: no hace falta esperar al siguiente reintento.
        app.getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    scope.launch { connection?.reconnectNow() }
                }
            }
        )
    }

    // --- servidor y sesión ---

    fun setServer(input: String, room: String? = null) {
        val server = normalizeServerUrl(input)
        if (server == null) {
            _session.update { it.copy(serverError = text(R.string.server_invalid)) }
            return
        }
        leaveRoom(forget = false)
        prefs.edit { putString(KEY_SERVER, server) }
        _library.value = LibraryState()
        _session.value = SessionState(serverUrl = server, roomCode = room.orEmpty())
        autoJoin = room != null
        loadServer()
    }

    // Olvida el servidor para escribir o escanear otro.
    fun changeServer() {
        leaveRoom()
        prefs.edit { remove(KEY_SERVER) }
        api = null
        _library.value = LibraryState()
        _session.value = SessionState()
    }

    fun retryServer() = loadServer()

    private fun loadServer() {
        val server = _session.value.serverUrl ?: return
        val api = ServerApi(server, client).also { api = it }
        _session.update { it.copy(loadingServer = true, serverError = null) }
        scope.launch {
            try {
                val me = api.me()
                // Un servidor anterior a la app no dice cómo se entra. Si deja entrar sin sesión es
                // que no usa Google (modo nombre) y funciona igual; con Google, la app no puede
                // iniciar sesión hasta que se actualice (le falta /api/auth/google-token).
                val auth = api.authConfig() ?: when {
                    me?.nameMode == true -> AuthConfig(google = false, googleClientId = null, allowedDomain = null)
                    else -> {
                        _session.update {
                            it.copy(loadingServer = false, serverError = UiText.Res(R.string.server_outdated, listOf(server)))
                        }
                        return@launch
                    }
                }
                _session.update { s ->
                    s.copy(
                        auth = auth,
                        loadingServer = false,
                        myName = me?.name,
                        nameInput = me?.name ?: prefs.getString(KEY_LAST_NAME, null).orEmpty(),
                    )
                }
                continueAutoJoin()
            } catch (e: Exception) {
                _session.update {
                    it.copy(loadingServer = false, serverError = UiText.Res(R.string.server_unreachable, listOf(server)))
                }
            }
        }
    }

    private fun continueAutoJoin() {
        val s = _session.value
        if (!autoJoin || normalizeRoomCode(s.roomCode) == null) return
        when {
            s.auth?.google == true && s.myName == null -> requestGoogleSignIn()
            s.myName != null -> join(s.roomCode, s.myName)
            // Sin Google y sin nombre elegido: se deja el código puesto y se espera el nombre.
            else -> autoJoin = false
        }
    }

    fun requestGoogleSignIn() = _session.update { it.copy(googleSignInRequest = it.googleSignInRequest + 1) }

    fun onGoogleIdToken(idToken: String) {
        val api = api ?: return
        _session.update { it.copy(signingIn = true, joinError = null) }
        scope.launch {
            try {
                val name = api.signInWithGoogle(idToken)
                _session.update { it.copy(signingIn = false, myName = name) }
                continueAutoJoin()
            } catch (e: Exception) {
                autoJoin = false
                _session.update { it.copy(signingIn = false, joinError = errorText(e, R.string.login_failed)) }
            }
        }
    }

    fun onGoogleSignInFailed(message: UiText?) {
        autoJoin = false
        _session.update { it.copy(signingIn = false, joinError = message) }
    }

    fun signOut() {
        leaveRoom()
        api?.let { cookies.clearFor(it.httpUrl) }
        _session.update { it.copy(myName = null, joinError = null) }
    }

    fun setRoomCodeInput(value: String) = _session.update { it.copy(roomCode = value.uppercase().take(4), joinError = null) }

    fun setNameInput(value: String) = _session.update { it.copy(nameInput = value, joinError = null) }

    // Un QR o un enlace: puede traer otro servidor, una sala, o ambos.
    fun openJoinLink(link: JoinLink) {
        val current = _session.value.serverUrl
        if (link.serverUrl != null && link.serverUrl != current) {
            setServer(link.serverUrl, link.roomCode)
            return
        }
        val room = link.roomCode ?: return
        if (_room.value?.roomCode == room) return
        leaveRoom(forget = false)
        _session.update { it.copy(roomCode = room, joinError = null) }
        autoJoin = true
        if (_session.value.auth != null) continueAutoJoin()
    }

    // --- sala ---

    fun join(codeInput: String, nameInput: String?) {
        val api = api ?: return
        val s = _session.value
        autoJoin = false
        val code = normalizeRoomCode(codeInput)
        if (code == null) {
            _session.update { it.copy(joinError = text(R.string.join_code_length)) }
            return
        }
        val nameMode = s.auth?.google == false
        val name = nameInput?.trim().orEmpty()
        if (nameMode && name.isEmpty()) {
            _session.update { it.copy(joinError = text(R.string.join_name_required)) }
            return
        }
        _session.update { it.copy(joining = true, joinError = null, roomCode = code) }
        scope.launch {
            try {
                val myName = if (nameMode) {
                    api.setName(name, code).also { prefs.edit { putString(KEY_LAST_NAME, it) } }
                } else {
                    s.myName ?: api.me()?.name ?: run {
                        _session.update { it.copy(joining = false, myName = null) }
                        autoJoin = true
                        requestGoogleSignIn()
                        return@launch
                    }
                }
                if (!api.roomExists(code)) {
                    val saved = prefs.getString(KEY_ROOM, null) == code
                    if (saved) prefs.edit { remove(KEY_ROOM) }
                    _session.update {
                        it.copy(
                            joining = false,
                            roomCode = if (saved) "" else code,
                            joinError = text(if (saved) R.string.join_saved_room_gone else R.string.join_room_missing, code),
                        )
                    }
                    return@launch
                }
                _session.update { it.copy(joining = false, myName = myName, nameInput = myName) }
                enterRoom(api, code, myName)
            } catch (e: Exception) {
                _session.update { it.copy(joining = false, joinError = errorText(e, R.string.join_verify_failed)) }
            }
        }
    }

    private fun enterRoom(api: ServerApi, code: String, myName: String) {
        prefs.edit { putString(KEY_ROOM, code) }
        val conn = RoomConnection(
            client = client,
            webSocketUrl = api.webSocketUrl,
            roomCode = code,
            myName = myName,
            scope = scope,
            onTurn = { alert, state -> scope.launch { Notifications.alertTurn(app, alert, state) } },
            onEvent = { event -> scope.launch { onRoomEvent(event) } },
            onExit = { exit -> scope.launch { onRoomExit(exit) } },
        )
        connection = conn
        scope.launch {
            var bannerWasShown = false
            conn.state.collect { state ->
                if (connection !== conn) return@collect
                _room.value = state
                // Al quitarse "¡Prepárate!" (empezó tu canción) se quita también su notificación. La de
                // "tu canción está empezando" no tiene aviso en pantalla: se va sola o al tocarla.
                if (bannerWasShown && !state.turnBanner) Notifications.cancelTurn(app)
                bannerWasShown = state.turnBanner
            }
        }
        conn.start()
        RoomService.start(app)
        loadLibrary()
    }

    // forget: olvidar la sala recordada (salir a propósito). Al cambiar de servidor o de sala por
    // un enlace se reemplaza igual.
    fun leaveRoom(forget: Boolean = true) {
        connection?.close()
        connection = null
        _room.value = null
        Notifications.cancelTurn(app)
        RoomService.stop(app)
        if (forget) {
            prefs.edit { remove(KEY_ROOM) }
            autoJoin = false
        }
    }

    private fun onRoomEvent(event: RoomEvent) {
        when (event) {
            is RoomEvent.AddRejected -> toast(
                UiText.Plural(if (event.personalLimit) R.plurals.toast_personal_limit else R.plurals.toast_queue_full, event.limit)
            )
            RoomEvent.HostBack -> toast(text(R.string.toast_host_back))
            RoomEvent.DownloadsChanged -> scope.launch { refreshDownloadsAndRatings() }
        }
    }

    private fun onRoomExit(exit: RoomExit) {
        val code = _room.value?.roomCode.orEmpty()
        when (exit) {
            RoomExit.ROOM_GONE -> {
                leaveRoom()
                _session.update { it.copy(roomCode = "", joinError = text(R.string.conn_room_gone)) }
            }
            RoomExit.SESSION_EXPIRED -> {
                // Se vuelve a entrar sola en cuanto haya sesión otra vez.
                leaveRoom(forget = false)
                autoJoin = true
                _session.update { it.copy(myName = null, roomCode = code, joinError = text(R.string.conn_session_expired_native)) }
                Notifications.sessionExpired(app)
                if (_session.value.auth?.google == true) requestGoogleSignIn()
            }
            RoomExit.NAME_TAKEN -> {
                leaveRoom(forget = false)
                _session.update { it.copy(myName = null, roomCode = code, joinError = text(R.string.api_name_taken)) }
            }
            RoomExit.REJECTED -> {
                leaveRoom(forget = false)
                _session.update { it.copy(roomCode = code, joinError = text(R.string.conn_rejected_native)) }
            }
        }
    }

    // Al volver a la app: reconecta ya si estaba reintentando y trae lo nuevo de la biblioteca.
    fun onAppForeground() {
        connection?.reconnectNow()
        if (_room.value != null) scope.launch { refreshDownloadsAndRatings() }
    }

    // Las acciones devuelven lo mismo que en el web: si no hay conexión, se avisa.
    private fun act(action: RoomConnection.() -> Boolean) {
        val conn = connection
        if (conn == null || !conn.action()) toast(text(R.string.toast_offline))
    }

    fun playPause() = act { playPause() }
    fun skip(songId: String) = act { skip(songId) }
    fun voteSkip(songId: String) = act { voteSkip(songId) }
    fun removeSong(songId: String) = act { removeSong(songId) }
    fun moveSong(songId: String, up: Boolean) = act { moveSong(songId, up) }
    fun dismissTurnBanner() = connection?.dismissTurnBanner()

    fun addSong(filename: String) {
        act {
            addSong(filename).also { sent -> if (sent) toast(text(R.string.toast_added)) }
        }
    }

    fun rate(ratingId: String, value: Int) {
        val conn = connection
        if (conn == null || !conn.rate(ratingId, value)) {
            toast(text(R.string.toast_offline))
            return
        }
        if (value != 0) toast(text(R.string.toast_rated))
    }

    // --- biblioteca ---

    fun loadLibrary() {
        val api = api ?: return
        scope.launch {
            refreshDownloadsAndRatings()
            try {
                val songs = api.songs()
                _library.update { it.copy(songs = songs, loaded = true, loadFailed = false) }
            } catch (_: Exception) {
                _library.update { it.copy(loaded = true, loadFailed = true) }
            }
        }
    }

    // Si falla se conserva lo último que se sabía: son un extra de la búsqueda. Devuelve true si
    // cambió algo.
    suspend fun refreshDownloadsAndRatings(): Boolean {
        val api = api ?: return false
        val before = _library.value
        val downloads = scope.async { runCatching { api.downloads() }.getOrNull() }
        val ratings = scope.async { runCatching { api.ratings() }.getOrNull() }
        val d = downloads.await() ?: before.downloads
        val r = ratings.await() ?: before.ratings
        _library.update { it.copy(downloads = d, ratings = r) }
        return d != before.downloads || r != before.ratings
    }

    suspend fun searchYoutube(query: String): Result<YoutubeSearch> {
        val api = api ?: return Result.failure(IllegalStateException())
        return runCatching { api.searchYoutube(query) }
    }

    // Descarga el video en el servidor (o reutiliza el que ya estaba) y lo agrega a la cola.
    suspend fun downloadAndQueue(videoId: String, query: String?, suffix: String?): Result<Unit> {
        val api = api ?: return Result.failure(IllegalStateException())
        return runCatching {
            val filename = api.downloadYoutube(videoId, query, suffix)
            addSong(filename)
            scope.launch { refreshDownloadsAndRatings() }
        }.map { }
    }

    // --- compartir desde YouTube ---

    fun shareVideo(videoId: String) {
        _pendingShare.value = videoId
        if (_room.value == null) toast(text(R.string.share_join_first))
    }

    fun clearPendingShare() {
        _pendingShare.value = null
    }

    // El tutorial se abre solo la primera vez que se entra a una sala. Se marca como visto al
    // abrirlo, no al terminarlo (igual que el web): quien lo cierra a la mitad no lo vuelve a ver
    // solo, pero puede abrirlo desde el menú.
    fun takeFirstTour(): Boolean {
        if (prefs.getBoolean(KEY_TOUR_SEEN, false)) return false
        prefs.edit { putBoolean(KEY_TOUR_SEEN, true) }
        return true
    }

    fun toast(message: UiText) {
        _toasts.tryEmit(message)
    }

    fun errorText(e: Throwable, fallback: Int): UiText =
        (e as? ApiException)?.serverMessage?.let { UiText.Raw(it) } ?: text(fallback)

    private companion object {
        const val KEY_SERVER = "server"
        const val KEY_ROOM = "room"
        const val KEY_LAST_NAME = "lastName"
        const val KEY_TOUR_SEEN = "tourSeen"
    }
}
