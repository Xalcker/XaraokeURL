package xyz.xalcker.xaraoke.ui

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Dialog
import android.Manifest
import androidx.activity.compose.LocalActivity
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import xyz.xalcker.xaraoke.AppController
import xyz.xalcker.xaraoke.R
import xyz.xalcker.xaraoke.UiText
import xyz.xalcker.xaraoke.room.Notifications
import xyz.xalcker.xaraoke.room.RoomState
import xyz.xalcker.xaraoke.text

// Una pregunta de confirmación. `stillValid` la cierra sola si deja de tener sentido mientras está
// abierta (por ejemplo, la canción que se iba a saltar ya terminó), igual que en el remoto web.
class ConfirmRequest(
    val message: String,
    val confirmLabel: String,
    val danger: Boolean = false,
    val stillValid: (RoomState?) -> Boolean = { true },
    val onDismiss: () -> Unit = {},
    val onConfirm: () -> Unit,
)

val LocalConfirm = staticCompositionLocalOf<(ConfirmRequest) -> Unit> { {} }

// Muestra "Descargando desde YouTube…" mientras corre `work`.
val LocalBusy = staticCompositionLocalOf<(suspend () -> Unit) -> Unit> { {} }

@Composable
fun AppRoot(controller: AppController) {
    val session by controller.session.collectAsStateWithLifecycle()
    val room by controller.room.collectAsStateWithLifecycle()
    val pendingShare by controller.pendingShare.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val resources = LocalResources.current
    val activity = checkNotNull(LocalActivity.current)
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    var confirm by remember { mutableStateOf<ConfirmRequest?>(null) }
    var busy by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        controller.toasts.collect { message ->
            snackbar.currentSnackbarData?.dismiss()
            snackbar.showSnackbar(message.resolve(resources))
        }
    }

    // Iniciar sesión con Google cuando el controlador lo pide (una vez por pedido: al rotar la
    // pantalla no se vuelve a abrir).
    var handledSignIn by rememberSaveable { mutableIntStateOf(0) }
    LaunchedEffect(session.googleSignInRequest) {
        val request = session.googleSignInRequest
        val clientId = session.auth?.googleClientId
        if (request == 0 || request == handledSignIn) return@LaunchedEffect
        handledSignIn = request
        if (clientId == null) return@LaunchedEffect
        when (val result = signInWithGoogle(activity, clientId, session.auth?.allowedDomain)) {
            is GoogleSignInResult.Token -> controller.onGoogleIdToken(result.idToken)
            GoogleSignInResult.Cancelled -> controller.onGoogleSignInFailed(null)
            is GoogleSignInResult.Failed -> controller.onGoogleSignInFailed(text(R.string.login_failed))
        }
    }

    // Sin permiso de notificaciones no hay aviso con el teléfono bloqueado: se pide al entrar a una sala.
    val notificationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (!granted) controller.toast(text(R.string.notifications_denied))
    }
    val inRoom = room != null
    LaunchedEffect(inRoom) {
        if (inRoom && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !Notifications.canNotify(context)) {
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    // Una confirmación que ya no aplica se cierra sola.
    LaunchedEffect(room, confirm) {
        if (confirm?.stillValid?.invoke(room) == false) confirm = null
    }

    val runBusy: (suspend () -> Unit) -> Unit = { work ->
        scope.launch {
            busy = true
            try {
                work()
            } finally {
                busy = false
            }
        }
    }

    CompositionLocalProvider(LocalConfirm provides { confirm = it }, LocalBusy provides runBusy) {
        Scaffold(
            snackbarHost = { SnackbarHost(snackbar) },
            containerColor = Color.Transparent,
            // Con el fondo transparente, Material no sabe qué color de texto va encima: el del tema.
            contentColor = MaterialTheme.colorScheme.onBackground,
        ) { padding ->
            GradientBackground {
                val currentRoom = room
                if (currentRoom != null) {
                    RoomScreen(controller, currentRoom, padding)
                } else {
                    JoinScreen(controller, session, Modifier.padding(padding))
                }
            }
        }

        // Video compartido desde YouTube: se confirma cuando ya hay sala.
        LaunchedEffect(pendingShare, inRoom) {
            val share = pendingShare ?: return@LaunchedEffect
            if (!inRoom) return@LaunchedEffect
            confirm = ConfirmRequest(
                message = resources.getString(R.string.share_confirm),
                confirmLabel = resources.getString(R.string.confirm_add),
                onDismiss = controller::clearPendingShare,
                onConfirm = {
                    controller.clearPendingShare()
                    runBusy {
                        controller.downloadAndQueue(share, null, null).onFailure {
                            controller.toast(controller.errorText(it, R.string.yt_download_failed))
                        }
                    }
                },
            )
        }

        confirm?.let { request ->
            val dismiss = {
                confirm = null
                request.onDismiss()
            }
            AlertDialog(
                onDismissRequest = dismiss,
                text = { Text(request.message) },
                confirmButton = {
                    TextButton(
                        onClick = {
                            confirm = null
                            request.onConfirm()
                        },
                        colors = if (request.danger) ButtonDefaults.textButtonColors(contentColor = Brand.danger)
                        else ButtonDefaults.textButtonColors(),
                    ) { Text(request.confirmLabel) }
                },
                dismissButton = { TextButton(onClick = dismiss) { Text(stringResource(R.string.confirm_cancel)) } },
            )
        }

        // Un diálogo propio y no un AlertDialog: sin botones, el de Material deja abajo el hueco de
        // su fila de botones vacía. No se cierra tocando fuera ni con Atrás: la descarga sigue.
        if (busy) {
            Dialog(
                onDismissRequest = {},
                properties = DialogProperties(dismissOnBackPress = false, dismissOnClickOutside = false),
            ) {
                Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                    Row(
                        Modifier.padding(horizontal = 24.dp, vertical = 20.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                        Text(stringResource(R.string.yt_downloading))
                    }
                }
            }
        }
    }
}

@Composable
fun UiText.asString(): String = resolve(LocalResources.current)
