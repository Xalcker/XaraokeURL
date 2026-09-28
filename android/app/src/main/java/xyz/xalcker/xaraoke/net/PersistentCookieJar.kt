package xyz.xalcker.xaraoke.net

import androidx.core.content.edit
import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import org.json.JSONArray
import org.json.JSONObject

// Guarda la cookie de sesión del servidor (connect.sid) entre aperturas de la app: es lo que dice
// quién eres, igual que en el navegador. Se guarda cada cookie junto a la dirección que la puso,
// que es lo que OkHttp necesita para volver a leerla.
class PersistentCookieJar(context: Context) : CookieJar {
    private val prefs = context.getSharedPreferences("cookies", Context.MODE_PRIVATE)
    private val cookies = mutableListOf<Pair<HttpUrl, Cookie>>()

    init {
        val saved = prefs.getString(KEY, null)
        if (saved != null) {
            runCatching {
                val array = JSONArray(saved)
                for (i in 0 until array.length()) {
                    val entry = array.getJSONObject(i)
                    val url = entry.getString("url").toHttpUrlOrNull() ?: continue
                    val cookie = Cookie.parse(url, entry.getString("cookie")) ?: continue
                    cookies += url to cookie
                }
            }
        }
    }

    @Synchronized
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        for (cookie in cookies) {
            this.cookies.removeAll { (_, old) ->
                old.name == cookie.name && old.domain == cookie.domain && old.path == cookie.path
            }
            if (cookie.expiresAt > System.currentTimeMillis()) this.cookies += url to cookie
        }
        persist()
    }

    @Synchronized
    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val now = System.currentTimeMillis()
        if (cookies.removeAll { (_, cookie) -> cookie.expiresAt <= now }) persist()
        return cookies.map { it.second }.filter { it.matches(url) }
    }

    // Olvida la sesión de un servidor (cerrar sesión).
    @Synchronized
    fun clearFor(url: HttpUrl) {
        if (cookies.removeAll { (_, cookie) -> cookie.matches(url) }) persist()
    }

    private fun persist() {
        val array = JSONArray()
        for ((url, cookie) in cookies) {
            // Sin fecha de vencimiento, la cookie es de sesión y no se guarda (igual que un navegador).
            if (!cookie.persistent) continue
            array.put(JSONObject().put("url", url.toString()).put("cookie", cookie.toString()))
        }
        prefs.edit { putString(KEY, array.toString()) }
    }

    private companion object {
        const val KEY = "cookies"
    }
}
