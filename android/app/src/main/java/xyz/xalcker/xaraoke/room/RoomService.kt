package xyz.xalcker.xaraoke.room

import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import xyz.xalcker.xaraoke.XaraokeApp

// Servicio en primer plano mientras estás en una sala. No hace nada por sí mismo: la conexión la
// tiene AppController. Su trabajo es que Android no mate la app con el teléfono bloqueado (así
// llega el aviso de tu turno) y mostrar la notificación fija con lo que suena.
class RoomService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var watching: Job? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val controller = (application as XaraokeApp).controller
        ServiceCompat.startForeground(
            this,
            Notifications.ID_ROOM,
            Notifications.roomNotification(this, controller.room.value),
            // El tipo "specialUse" existe desde Android 14; antes no hace falta declarar ninguno.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
        )
        when (intent?.action) {
            ACTION_PLAY_PAUSE -> controller.playPause()
            ACTION_LEAVE -> controller.leaveRoom()
        }
        if (watching == null) {
            watching = scope.launch {
                val manager = getSystemService(NotificationManager::class.java)
                controller.room
                    // La notificación solo cambia lo que se ve: el segundo exacto no hace falta.
                    .map { it?.let(::visibleParts) to it }
                    .distinctUntilChanged { a, b -> a.first == b.first }
                    .collectLatest { (_, state) ->
                        if (state == null) {
                            stopSelf()
                        } else {
                            manager.notify(Notifications.ID_ROOM, Notifications.roomNotification(this@RoomService, state))
                        }
                    }
            }
        }
        // Si Android lo mata por falta de memoria, no se revive solo: la sala se retoma al abrir la app.
        return START_NOT_STICKY
    }

    // Lo que se ve en la notificación, con el tiempo restante redondeado a 5 s para no redibujarla
    // cada segundo.
    private fun visibleParts(s: RoomState): List<Any?> = listOf(
        s.roomCode, s.connection, s.hostConnected, s.queue, s.paused, s.canPlayPause,
        s.headProgress?.let { ((it.duration - it.currentTime) / 5).toInt() },
    )

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        const val ACTION_PLAY_PAUSE = "xyz.xalcker.xaraoke.PLAY_PAUSE"
        const val ACTION_LEAVE = "xyz.xalcker.xaraoke.LEAVE"

        fun start(context: Context) {
            ContextCompat.startForegroundService(context, Intent(context, RoomService::class.java))
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, RoomService::class.java))
        }
    }
}
