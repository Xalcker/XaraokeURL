package xyz.xalcker.xaraoke

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import xyz.xalcker.xaraoke.core.parseJoinText
import xyz.xalcker.xaraoke.core.youtubeVideoId
import xyz.xalcker.xaraoke.ui.AppRoot
import xyz.xalcker.xaraoke.ui.XaraokeTheme

class MainActivity : ComponentActivity() {
    private val controller get() = (application as XaraokeApp).controller

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Solo la primera vez: al rotar la pantalla el intent es el mismo y ya se atendió.
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            XaraokeTheme {
                AppRoot(controller)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        when (intent?.action) {
            // xaraoke://unirse?servidor=...&sala=ABCD
            Intent.ACTION_VIEW -> parseJoinText(intent.dataString)?.let(controller::openJoinLink)
            // "Compartir" un video desde YouTube.
            Intent.ACTION_SEND -> {
                val videoId = youtubeVideoId(intent.getStringExtra(Intent.EXTRA_TEXT))
                if (videoId == null) controller.toast(text(R.string.share_not_youtube))
                else controller.shareVideo(videoId)
            }
        }
    }
}
