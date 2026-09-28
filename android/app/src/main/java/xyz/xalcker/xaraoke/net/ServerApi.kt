package xyz.xalcker.xaraoke.net

import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import xyz.xalcker.xaraoke.core.AuthConfig
import xyz.xalcker.xaraoke.core.Download
import xyz.xalcker.xaraoke.core.RatingTotals
import xyz.xalcker.xaraoke.core.SongLibrary
import xyz.xalcker.xaraoke.core.YoutubeVideo

// Error de la API. `serverMessage` es el `error` que manda el servidor, ya en el idioma del
// teléfono (lo elige con Accept-Language); si la petición ni llegó, es null y quien lo muestra usa
// un texto propio.
class ApiException(val status: Int, val serverMessage: String?) : IOException(serverMessage ?: "HTTP $status")

// Lo que responde /api/me: quién eres para el servidor. `name` es null en modo nombre si todavía
// no elegiste uno.
data class Me(val nameMode: Boolean, val name: String?)

data class YoutubeSearch(val results: List<YoutubeVideo>, val suffix: String?)

// Las rutas HTTP del servidor que usa el remoto (ver src/routes/api.js y src/auth.js).
class ServerApi(val baseUrl: String, private val client: OkHttpClient) {
    val httpUrl: HttpUrl = baseUrl.toHttpUrl()

    val webSocketUrl: String
        get() = baseUrl.replaceFirst(Regex("^http"), "ws")

    // null si el servidor es anterior a la app (no tiene la ruta): quien llama lo deduce de /api/me.
    suspend fun authConfig(): AuthConfig? {
        val json = try {
            getJson("/api/auth/config")
        } catch (e: ApiException) {
            if (e.status == 404) return null
            throw e
        }
        val google = json.optString("mode") == "google"
        return AuthConfig(
            google = google,
            googleClientId = json.optStringOrNull("googleClientId"),
            allowedDomain = json.optStringOrNull("allowedDomain"),
        )
    }

    // null si no hay sesión (el servidor manda a /login).
    suspend fun me(): Me? = withContext(Dispatchers.IO) {
        client.newCall(request("/api/me").build()).execute().use { res ->
            if (res.isRedirect || res.code == 401) return@use null
            val json = res.jsonObject()
            Me(nameMode = json.optBoolean("devMode"), name = json.optStringOrNull("name"))
        }
    }

    suspend fun setName(name: String, room: String?): String {
        val body = JSONObject().put("name", name)
        if (room != null) body.put("room", room)
        return postJson("/api/dev-name", body).getString("name")
    }

    suspend fun signInWithGoogle(idToken: String): String =
        postJson("/api/auth/google-token", JSONObject().put("idToken", idToken)).getString("name")

    suspend fun roomExists(code: String): Boolean = getJson("/api/rooms/$code").optBoolean("exists")

    suspend fun songs(): SongLibrary {
        val json = getJson("/api/songs")
        val library = linkedMapOf<String, Map<String, List<String>>>()
        for (letter in json.keys()) {
            val artists = json.getJSONObject(letter)
            val byArtist = linkedMapOf<String, List<String>>()
            for (artist in artists.keys()) byArtist[artist] = artists.getJSONArray(artist).strings()
            library[letter] = byArtist
        }
        return library
    }

    suspend fun downloads(): List<Download> {
        val array = getJsonArray("/api/downloads")
        return (0 until array.length()).map { i ->
            val d = array.getJSONObject(i)
            Download(
                filename = d.getString("filename"),
                title = d.optString("title"),
                channel = d.optStringOrNull("channel"),
                query = d.optStringOrNull("query"),
            )
        }
    }

    suspend fun ratings(): Map<String, RatingTotals> {
        val json = getJson("/api/ratings")
        return json.keys().asSequence().associateWith { key ->
            val t = json.getJSONObject(key)
            RatingTotals(t.optInt("up"), t.optInt("down"))
        }
    }

    suspend fun searchYoutube(query: String): YoutubeSearch {
        val url = httpUrl.newBuilder().addPathSegments("api/youtube/search").addQueryParameter("q", query).build()
        val json = execute(Request.Builder().url(url)).jsonObject()
        val array = json.optJSONArray("results") ?: JSONArray()
        val results = (0 until array.length()).map { i ->
            val v = array.getJSONObject(i)
            YoutubeVideo(
                id = v.getString("id"),
                title = v.optString("title"),
                channel = v.optStringOrNull("channel"),
                durationSeconds = if (v.has("duration") && !v.isNull("duration")) v.optDouble("duration") else null,
                thumbnail = v.optStringOrNull("thumbnail"),
            )
        }
        return YoutubeSearch(results, json.optStringOrNull("suffix"))
    }

    // Devuelve el nombre de archivo con el que se agrega a la cola.
    suspend fun downloadYoutube(videoId: String, query: String?, suffix: String?): String {
        val body = JSONObject().put("videoId", videoId)
        if (query != null) body.put("query", query)
        if (suffix != null) body.put("suffix", suffix)
        return postJson("/api/youtube/download", body).getString("filename")
    }

    // --- detalles ---

    private fun request(path: String) = Request.Builder().url(httpUrl.resolve(path)!!)

    private suspend fun getJson(path: String): JSONObject = execute(request(path)).jsonObject()

    // Leer el cuerpo también es red: fuera del hilo principal, o Android lo bloquea.
    private suspend fun getJsonArray(path: String): JSONArray {
        val res = execute(request(path))
        return withContext(Dispatchers.IO) { res.use { JSONArray(it.body.string()) } }
    }

    private suspend fun postJson(path: String, body: JSONObject): JSONObject =
        execute(request(path).post(body.toString().toRequestBody(JSON))).jsonObject()

    // Lanza ApiException si la respuesta no es 2xx. Un 3xx a /login también es un error: la sesión venció.
    private suspend fun execute(builder: Request.Builder): Response = withContext(Dispatchers.IO) {
        val res = client.newCall(builder.build()).execute()
        if (!res.isSuccessful) {
            val message = res.use { r ->
                runCatching { JSONObject(r.body.string()).optStringOrNull("error") }.getOrNull()
            }
            throw ApiException(res.code, message)
        }
        res
    }

    private suspend fun Response.jsonObject(): JSONObject = withContext(Dispatchers.IO) {
        use { JSONObject(it.body.string()) }
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}

private fun JSONObject.optStringOrNull(key: String): String? =
    if (has(key) && !isNull(key)) optString(key).takeIf { it.isNotEmpty() } else null

private fun JSONArray.strings(): List<String> = (0 until length()).map { getString(it) }
