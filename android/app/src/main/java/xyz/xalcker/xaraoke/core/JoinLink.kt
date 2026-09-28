package xyz.xalcker.xaraoke.core

import java.net.URI
import java.net.URLDecoder

// Qué trae lo que se escaneó o se abrió: la dirección del servidor, el código de la sala, o ambos.
data class JoinLink(val serverUrl: String?, val roomCode: String?)

private val ROOM_CODE = Regex("^[A-Z]{4}$")

fun normalizeRoomCode(value: String?): String? =
    value?.trim()?.uppercase()?.takeIf { ROOM_CODE.matches(it) }

// Deja la dirección del servidor como "http://host:puerto", sin ruta ni barra final. Si la persona
// la escribe sin "http://" se asume HTTP, que es como corre el servidor en la red de la casa.
// Devuelve null si no es una dirección utilizable.
fun normalizeServerUrl(input: String?): String? {
    val text = input?.trim().orEmpty()
    if (text.isEmpty()) return null
    val withScheme = if (Regex("^[a-zA-Z][a-zA-Z0-9+.-]*://").containsMatchIn(text)) text else "http://$text"
    val uri = try {
        URI(withScheme)
    } catch (_: Exception) {
        return null
    }
    val scheme = uri.scheme?.lowercase()
    if (scheme != "http" && scheme != "https") return null
    val host = uri.host?.takeIf { it.isNotBlank() } ?: return null
    val port = if (uri.port == -1) "" else ":${uri.port}"
    return "$scheme://$host$port"
}

// Entiende tres formas:
//   - el QR de la pantalla principal: http(s)://servidor/remote.html?sala=ABCD
//   - el enlace propio de la app:     xaraoke://unirse?servidor=http://...&sala=ABCD
//   - solo el código de la sala:       ABCD
// Devuelve null si no hay ni servidor ni sala.
fun parseJoinText(text: String?): JoinLink? {
    val trimmed = text?.trim().orEmpty()
    if (trimmed.isEmpty()) return null
    normalizeRoomCode(trimmed)?.let { return JoinLink(null, it) }
    val uri = try {
        URI(trimmed)
    } catch (_: Exception) {
        return null
    }
    val params = queryParams(uri.rawQuery)
    val room = normalizeRoomCode(params["sala"])
    return when (uri.scheme?.lowercase()) {
        "http", "https" -> {
            val server = normalizeServerUrl(trimmed) ?: return null
            JoinLink(server, room)
        }
        "xaraoke" -> {
            val server = normalizeServerUrl(params["servidor"])
            if (server == null && room == null) null else JoinLink(server, room)
        }
        else -> null
    }
}

private fun queryParams(rawQuery: String?): Map<String, String> {
    if (rawQuery.isNullOrEmpty()) return emptyMap()
    return rawQuery.split("&").mapNotNull { pair ->
        val index = pair.indexOf('=')
        if (index <= 0) return@mapNotNull null
        val key = URLDecoder.decode(pair.substring(0, index), "UTF-8")
        val value = URLDecoder.decode(pair.substring(index + 1), "UTF-8")
        key to value
    }.toMap()
}

private val YOUTUBE_ID = Regex("^[A-Za-z0-9_-]{11}$")

// El id del video de un enlace de YouTube compartido desde su app o el navegador
// (youtu.be/ID, youtube.com/watch?v=ID, /shorts/ID, music.youtube.com...). El texto compartido
// puede traer el título antes del enlace, así que se busca el primer enlace que aparezca.
fun youtubeVideoId(sharedText: String?): String? {
    val url = Regex("https?://\\S+").find(sharedText.orEmpty())?.value ?: return null
    val uri = try {
        URI(url)
    } catch (_: Exception) {
        return null
    }
    val host = uri.host?.lowercase()?.removePrefix("www.")?.removePrefix("m.") ?: return null
    val segments = uri.path.orEmpty().split("/").filter { it.isNotEmpty() }
    val candidate = when {
        host == "youtu.be" -> segments.firstOrNull()
        host == "youtube.com" || host == "music.youtube.com" -> when (segments.firstOrNull()) {
            "watch" -> queryParams(uri.rawQuery)["v"]
            "shorts", "live", "embed" -> segments.getOrNull(1)
            else -> null
        }
        else -> null
    }
    return candidate?.takeIf { YOUTUBE_ID.matches(it) }
}
