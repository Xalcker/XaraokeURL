package xyz.xalcker.xaraoke.ui

import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

// Miniaturas de los resultados de YouTube. Son pocas y chicas: no vale la pena una biblioteca de
// imágenes para esto.
private val cache = LruCache<String, ImageBitmap>(40)

@Composable
fun rememberRemoteImage(url: String): ImageBitmap? {
    val image by produceState(cache.get(url), url) {
        if (value != null) return@produceState
        value = withContext(Dispatchers.IO) {
            runCatching {
                URL(url).openStream().use { BitmapFactory.decodeStream(it) }?.asImageBitmap()
            }.getOrNull()
        }?.also { cache.put(url, it) }
    }
    return image
}
