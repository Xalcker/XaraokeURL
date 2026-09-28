package xyz.xalcker.xaraoke.core

// Lo que manda el servidor (ver src/realtime.js y src/routes/api.js).

data class QueueItem(val id: String, val song: String, val name: String, val title: String?)

data class NowPlaying(val song: String, val title: String?, val currentTime: Double, val duration: Double)

data class Download(val filename: String, val title: String, val channel: String?, val query: String?)

data class YoutubeVideo(
    val id: String,
    val title: String,
    val channel: String?,
    val durationSeconds: Double?,
    val thumbnail: String?,
)

data class RatingRequest(val id: String, val song: String, val title: String?)

data class RatingTotals(val up: Int, val down: Int)

// Cómo se entra a este servidor: con Google (y con qué client ID) o escribiendo un nombre.
data class AuthConfig(val google: Boolean, val googleClientId: String?, val allowedDomain: String?)

// Biblioteca por inicial y artista, en el orden en que la manda el servidor.
typealias SongLibrary = Map<String, Map<String, List<String>>>
