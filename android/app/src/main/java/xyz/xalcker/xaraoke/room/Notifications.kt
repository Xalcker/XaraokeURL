package xyz.xalcker.xaraoke.room

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ProcessLifecycleOwner
import xyz.xalcker.xaraoke.MainActivity
import xyz.xalcker.xaraoke.R
import xyz.xalcker.xaraoke.core.TurnTracker
import xyz.xalcker.xaraoke.core.formatTime
import xyz.xalcker.xaraoke.core.songDisplay
import xyz.xalcker.xaraoke.core.songsBeforeMyTurn

// Los dos canales de la app y las notificaciones que usan.
//   - "room": la notificación fija mientras estás en una sala (lo que suena, cuánto falta para tu
//     turno y pausar/reanudar). Silenciosa.
//   - "turn": "¡Te toca cantar!", con sonido y vibración aunque el teléfono esté bloqueado.
object Notifications {
    const val CHANNEL_ROOM = "room"
    // El sonido y la vibración de un canal no se pueden cambiar después de crearlo: si algún día
    // cambian, hay que usar otro id.
    const val CHANNEL_TURN = "turn_v1"
    const val ID_ROOM = 1
    private const val ID_TURN = 2
    private const val ID_SESSION = 3

    private val VIBRATION = longArrayOf(0, 400, 150, 400, 150, 600)

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_ROOM,
                context.getString(R.string.channel_room),
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = context.getString(R.string.channel_room_desc)
                setShowBadge(false)
            }
        )
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL_TURN,
                context.getString(R.string.channel_turn),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.channel_turn_desc)
                enableVibration(true)
                vibrationPattern = VIBRATION
                setSound(
                    turnSoundUri(context),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build(),
                )
            }
        )
    }

    private fun turnSoundUri(context: Context): Uri =
        Uri.Builder()
            .scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
            .authority(context.packageName)
            .appendPath("raw")
            .appendPath("turn_alert")
            .build()

    private fun openAppIntent(context: Context): PendingIntent =
        PendingIntent.getActivity(
            context,
            0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun serviceAction(context: Context, action: String, requestCode: Int): PendingIntent =
        PendingIntent.getService(
            context,
            requestCode,
            Intent(context, RoomService::class.java).setAction(action),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    // La notificación fija de la sala.
    fun roomNotification(context: Context, state: RoomState?): Notification {
        val builder = NotificationCompat.Builder(context, CHANNEL_ROOM)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppIntent(context))
        if (state == null) {
            return builder.setContentTitle(context.getString(R.string.app_name)).build()
        }
        builder.setContentTitle(context.getString(R.string.notif_room_title, state.roomCode))
        val head = state.head
        val unknown = context.getString(R.string.unknown_artist)
        val text = when {
            state.connection != Connection.OPEN -> context.getString(R.string.conn_retrying)
            !state.hostConnected -> context.getString(R.string.host_disconnected_short)
            head == null -> context.getString(R.string.queue_empty)
            else -> {
                val d = songDisplay(head.song, head.title, unknown)
                val song = context.getString(R.string.now_playing, d.artist, d.title)
                val progress = state.headProgress?.takeIf { it.duration > 0 }
                    ?.let { " · " + formatTime(it.duration - it.currentTime) }.orEmpty()
                val paused = if (state.paused) " · " + context.getString(R.string.paused_tag) else ""
                song + progress + paused
            }
        }
        builder.setContentText(text)
        builder.setSubText(turnSummary(context, state))
        if (state.canPlayPause) {
            builder.addAction(
                if (state.paused) R.drawable.ic_play else R.drawable.ic_pause,
                context.getString(if (state.paused) R.string.play else R.string.pause),
                serviceAction(context, RoomService.ACTION_PLAY_PAUSE, 1),
            )
        }
        builder.addAction(
            R.drawable.ic_leave,
            context.getString(R.string.notif_action_leave),
            serviceAction(context, RoomService.ACTION_LEAVE, 2),
        )
        return builder.build()
    }

    fun turnSummary(context: Context, state: RoomState): String =
        when (val ahead = songsBeforeMyTurn(state.queue, state.myName)) {
            null -> context.getString(R.string.queue_summary_none)
            0 -> context.getString(R.string.queue_summary_playing)
            1 -> context.getString(R.string.queue_summary_next)
            else -> context.resources.getQuantityString(R.plurals.queue_summary_ahead, ahead, ahead)
        }

    private fun appInForeground(): Boolean =
        ProcessLifecycleOwner.get().lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED)

    // "¡Te toca!". Con la app abierta: sonido, vibración y el aviso en pantalla (lo pone
    // RoomConnection). Con la app cerrada o el teléfono bloqueado: una notificación urgente, cuyo
    // sonido y vibración respetan lo que la persona configuró para ese canal (y el modo No molestar).
    fun alertTurn(context: Context, alert: TurnTracker.Alert, state: RoomState) {
        if (appInForeground()) {
            vibrate(context)
            playSound(context)
            return
        }
        if (!canNotify(context)) return
        val song = state.queue.firstOrNull { it.id == alert.songId }
        val unknown = context.getString(R.string.unknown_artist)
        val songText = song?.let {
            val d = songDisplay(it.song, it.title, unknown)
            context.getString(R.string.now_playing, d.artist, d.title)
        }.orEmpty()
        val title = context.getString(
            if (alert.kind == TurnTracker.Kind.UP_NEXT) R.string.notif_turn_title else R.string.notif_playing_title
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_TURN)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(ContextCompat.getColor(context, R.color.accent))
            .setContentTitle(title)
            .setContentText(songText)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setVibrate(VIBRATION)
            .setAutoCancel(true)
            .setTimeoutAfter(90_000)
            .setContentIntent(openAppIntent(context))
            .build()
        context.getSystemService(NotificationManager::class.java).notify(ID_TURN, notification)
    }

    fun cancelTurn(context: Context) {
        context.getSystemService(NotificationManager::class.java).cancel(ID_TURN)
    }

    // La sesión venció con la app en segundo plano: se pide volver a entrar.
    fun sessionExpired(context: Context) {
        if (!canNotify(context)) return
        val notification = NotificationCompat.Builder(context, CHANNEL_TURN)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.app_name))
            .setContentText(context.getString(R.string.conn_session_expired_native))
            .setAutoCancel(true)
            .setSilent(true)
            .setContentIntent(openAppIntent(context))
            .build()
        context.getSystemService(NotificationManager::class.java).notify(ID_SESSION, notification)
    }

    // Antes de Android 13 no hay permiso que pedir: basta con que no las hayan apagado.
    fun canNotify(context: Context): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            NotificationManagerCompat.from(context).areNotificationsEnabled()
        }

    private fun vibrate(context: Context) {
        val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Vibrator::class.java)
        } ?: return
        vibrator.vibrate(VibrationEffect.createWaveform(VIBRATION, -1))
    }

    private fun playSound(context: Context) {
        val player = MediaPlayer.create(
            context,
            R.raw.turn_alert,
            AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build(),
            context.getSystemService(android.media.AudioManager::class.java).generateAudioSessionId(),
        ) ?: return
        player.setOnCompletionListener { it.release() }
        player.start()
    }
}
