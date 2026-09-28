package xyz.xalcker.xaraoke.ui

import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.first
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.ui.unit.Dp
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.VerticalDivider
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.activity.compose.LocalActivity
import android.content.Intent
import android.provider.Settings
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.ThumbDown
import androidx.compose.material.icons.filled.ThumbUp
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Badge
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Tab
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import xyz.xalcker.xaraoke.AppController
import xyz.xalcker.xaraoke.R
import xyz.xalcker.xaraoke.core.RatingTotals
import xyz.xalcker.xaraoke.core.formatTime
import xyz.xalcker.xaraoke.core.songDisplay
import xyz.xalcker.xaraoke.room.Connection
import xyz.xalcker.xaraoke.room.Notifications
import xyz.xalcker.xaraoke.room.RoomState

@Composable
// `contentPadding`: el espacio de las barras del sistema. El contenido lo respeta; el tutorial no,
// para oscurecer la pantalla completa.
fun RoomScreen(controller: AppController, state: RoomState, contentPadding: PaddingValues) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val tour = remember { TourState() }
    // El tutorial explica el buscador: se abre en esa pestaña.
    val startTour = {
        tab = 0
        tour.start()
    }
    LaunchedEffect(Unit) {
        if (controller.takeFirstTour()) {
            tab = 0
            // Se espera a la biblioteca: sin ella no están las letras y se saltaría ese paso. Si tarda
            // demasiado, se abre igual (sin ese paso).
            withTimeoutOrNull(5_000) { controller.library.first { it.loaded } }
            delay(500)
            tour.start()
        }
    }
    CompositionLocalProvider(LocalTour provides tour) {
        Box(Modifier.fillMaxSize()) {
            BoxWithConstraints(Modifier.fillMaxSize().padding(contentPadding)) {
                val mineCount = state.queue.count(state::isMine)
                val wide = maxWidth >= 600.dp
                Column(Modifier.fillMaxSize()) {
                    Header(controller, state, onTutorial = startTour)
                    // Desde 600 dp de ancho (teléfono acostado, plegable abierto, tablet) caben la lista y
                    // el buscador juntos: dos columnas, sin pestañas. Más angosto, una sola con pestañas.
                    if (wide) {
                        Row(Modifier.weight(1f)) {
                            QueuePanel(
                                controller,
                                state,
                                modifier = Modifier.weight(0.42f),
                                leading = {
                                    item { MiniPlayer(controller, state, edge = 0.dp) }
                                    item { Banners(controller, state, edge = 0.dp) }
                                    item { QueueTitle(mineCount, Modifier.padding(top = 8.dp).tourTarget(TourStep.QUEUE), heading = true) }
                                },
                            )
                            VerticalDivider(color = Color(0x33FFFFFF))
                            Box(Modifier.weight(0.58f)) { SearchPanel(controller) }
                        }
                    } else {
                        MiniPlayer(controller, state)
                        Banners(controller, state)
                        PrimaryTabRow(selectedTabIndex = tab, containerColor = Color.Transparent) {
                            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text(stringResource(R.string.tab_search)) })
                            Tab(
                                selected = tab == 1,
                                onClick = { tab = 1 },
                                text = { QueueTitle(mineCount) },
                                modifier = Modifier.tourTarget(TourStep.QUEUE),
                            )
                        }
                        Box(Modifier.weight(1f)) {
                            if (tab == 0) SearchPanel(controller) else QueuePanel(controller, state)
                        }
                    }
                }
                state.ratingRequests.firstOrNull()?.let { request ->
                    RatingCard(
                        title = songDisplay(request.song, request.title, stringResource(R.string.unknown_artist)).let {
                            stringResource(R.string.now_playing, it.artist, it.title)
                        },
                        onRate = { controller.rate(request.id, it) },
                        // En una tablet no se estira de orilla a orilla.
                        modifier = Modifier.align(Alignment.BottomCenter).widthIn(max = 560.dp),
                    )
                }
            }
            TourOverlay(tour)
        }
    }
}

// "Mi lista" con cuántas canciones tuyas hay; el número va al lado del texto, no encima (un globo
// en la esquina lo tapaba).
@Composable
private fun QueueTitle(mineCount: Int, modifier: Modifier = Modifier, heading: Boolean = false) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(
            stringResource(R.string.tab_queue),
            color = Brand.accent,
            fontWeight = if (heading) FontWeight.Bold else null,
            style = if (heading) MaterialTheme.typography.titleMedium else LocalTextStyle.current,
        )
        if (mineCount > 0) Badge(containerColor = Brand.accent, contentColor = Brand.onAccent) {
            Text("$mineCount")
        }
    }
}

@Composable
private fun Header(controller: AppController, state: RoomState, onTutorial: () -> Unit) {
    val context = LocalContext.current
    val activity = checkNotNull(LocalActivity.current)
    val scope = rememberCoroutineScope()
    val session by controller.session.collectAsStateWithLifecycle()
    var menu by remember { mutableStateOf(false) }
    Row(
        Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            stringResource(R.string.room_code, state.roomCode),
            color = Brand.accent,
            fontWeight = FontWeight.Bold,
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.tourTarget(TourStep.ROOM),
        )
        Spacer(Modifier.width(12.dp))
        Text(
            stringResource(R.string.user, state.myName),
            color = Brand.muted,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Box {
            IconButton(onClick = { menu = true }, modifier = Modifier.tourTarget(TourStep.HELP)) {
                Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.menu))
            }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.tour_open)) },
                    onClick = {
                        menu = false
                        onTutorial()
                    },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.leave_room)) },
                    onClick = {
                        menu = false
                        controller.leaveRoom()
                    },
                )
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.notification_settings)) },
                    onClick = {
                        menu = false
                        context.startActivity(
                            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                                .putExtra(Settings.EXTRA_CHANNEL_ID, Notifications.CHANNEL_TURN)
                        )
                    },
                )
                if (session.auth?.google == true) {
                    DropdownMenuItem(
                        text = { Text(stringResource(R.string.sign_out)) },
                        onClick = {
                            menu = false
                            controller.signOut()
                            scope.launch { clearGoogleCredential(activity) }
                        },
                    )
                }
            }
        }
    }
}

// La barra de arriba del web: lo que suena, su avance y los botones, siempre a la vista.
@Composable
private fun MiniPlayer(controller: AppController, state: RoomState, edge: Dp = 12.dp) {
    val confirm = LocalConfirm.current
    val resources = LocalResources.current
    val unknown = stringResource(R.string.unknown_artist)
    val head = state.head
    val progress = state.headProgress

    val info: @Composable (Modifier) -> Unit = { modifier ->
        Column(modifier.tourTarget(TourStep.NOW_PLAYING), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    stringResource(R.string.now_playing_label).uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = Brand.muted,
                )
                if (state.active && state.paused) {
                    Text(
                        stringResource(R.string.paused_tag),
                        style = MaterialTheme.typography.labelSmall,
                        color = Brand.onAccent,
                        modifier = Modifier
                            .background(Brand.accent, RoundedCornerShape(4.dp))
                            .padding(horizontal = 6.dp, vertical = 1.dp),
                    )
                }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Filled.MusicNote, contentDescription = null, modifier = Modifier.size(18.dp), tint = Brand.accent)
                Spacer(Modifier.width(4.dp))
                Text(
                    head?.let {
                        val d = songDisplay(it.song, it.title, unknown)
                        stringResource(R.string.now_playing, d.artist, d.title)
                    } ?: stringResource(R.string.queue_empty),
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            if (progress != null && progress.duration > 0) {
                Text(
                    stringResource(
                        R.string.time_left,
                        formatTime(progress.currentTime),
                        formatTime(progress.duration),
                        formatTime(progress.duration - progress.currentTime),
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = Brand.muted,
                )
            }
        }
    }

    val controls: @Composable () -> Unit = {
        FilledIconButton(
            onClick = controller::playPause,
            enabled = state.canPlayPause,
            modifier = Modifier.size(52.dp).tourTarget(TourStep.PLAY_PAUSE),
        ) {
            val paused = state.active && state.paused
            Icon(
                if (paused) Icons.Filled.PlayArrow else Icons.Filled.Pause,
                contentDescription = stringResource(if (paused) R.string.play else R.string.pause),
            )
        }
        Spacer(Modifier.width(8.dp))
        SkipButton(state) {
            val song = head ?: return@SkipButton
            if (state.skipVoteMode) {
                if (!state.skipVotes.voted) controller.voteSkip(song.id)
                return@SkipButton
            }
            val d = songDisplay(song.song, song.title, unknown)
            val songText = resources.getString(R.string.now_playing, d.artist, d.title)
            confirm(
                ConfirmRequest(
                    message = if (state.isMine(song)) resources.getString(R.string.confirm_skip_mine, songText)
                    else resources.getString(R.string.confirm_skip_other, songText, song.name),
                    confirmLabel = resources.getString(R.string.confirm_skip_yes),
                    danger = true,
                    stillValid = { it?.head?.id == song.id && it.controlAllowed },
                    onConfirm = { controller.skip(song.id) },
                )
            )
        }
    }

    Surface(
        color = Brand.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = edge, vertical = 6.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            // Con poco ancho (la columna izquierda de un teléfono acostado) los botones van abajo: al
            // lado le dejaban tan poco espacio al título que lo partían a media palabra.
            BoxWithConstraints(Modifier.fillMaxWidth()) {
                if (maxWidth < 300.dp) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        info(Modifier.fillMaxWidth())
                        Row(verticalAlignment = Alignment.CenterVertically) { controls() }
                    }
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        info(Modifier.weight(1f))
                        Spacer(Modifier.width(8.dp))
                        controls()
                    }
                }
            }
            val fraction = progress?.takeIf { it.duration > 0 }?.let { (it.currentTime / it.duration).toFloat() } ?: 0f
            val animated by animateFloatAsState(fraction.coerceIn(0f, 1f), label = "progress")
            LinearProgressIndicator(
                progress = { if (fraction == 0f) 0f else animated },
                modifier = Modifier.fillMaxWidth(),
                color = Brand.accent,
                trackColor = Color(0x33FFFFFF),
                drawStopIndicator = {},
            )
            if (state.active && !state.controlAllowed) {
                Text(stringResource(R.string.controls_locked), style = MaterialTheme.typography.bodySmall, color = Brand.muted)
            }
        }
    }
}

// Con la canción de otra persona, el botón vota; el anillo tiene un segmento por voto necesario.
@Composable
private fun SkipButton(state: RoomState, onClick: () -> Unit) {
    val votes = state.skipVotes
    val label = if (state.skipVoteMode) {
        stringResource(if (votes.voted) R.string.vote_skip_done else R.string.vote_skip, votes.count, votes.threshold)
    } else {
        stringResource(R.string.skip)
    }
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(56.dp).tourTarget(TourStep.SKIP).semantics { contentDescription = label }) {
        if (state.skipVoteMode) {
            val total = votes.threshold.coerceAtLeast(1)
            Canvas(Modifier.size(56.dp)) {
                val stroke = 4.dp.toPx()
                val gap = if (total > 1) 14f else 0f
                val span = 360f / total
                for (i in 0 until total) {
                    drawArc(
                        color = if (i < votes.count) Brand.accent else Color(0x44FFFFFF),
                        startAngle = -90f + i * span + gap / 2,
                        sweepAngle = span - gap,
                        useCenter = false,
                        topLeft = Offset(stroke / 2, stroke / 2),
                        size = Size(size.width - stroke, size.height - stroke),
                        style = Stroke(width = stroke, cap = StrokeCap.Round),
                    )
                }
            }
        }
        IconButton(
            onClick = onClick,
            enabled = state.canSkip,
            colors = IconButtonDefaults.iconButtonColors(
                containerColor = if (state.skipVoteMode) Color.Transparent else Color(0x22FFFFFF),
            ),
            modifier = Modifier.size(44.dp).alpha(if (state.skipVoteMode && votes.voted) 0.5f else 1f),
        ) {
            Icon(Icons.Filled.SkipNext, contentDescription = null)
        }
    }
}

// `edge`: margen a los lados (dentro de una lista que ya pone el suyo, ninguno).
@Composable
private fun Banners(controller: AppController, state: RoomState, edge: Dp = 12.dp) {
    Column {
        AnimatedVisibility(state.connection == Connection.RETRYING) {
            Banner(stringResource(R.string.conn_retrying), Brand.dangerBanner, edge, icon = true)
        }
        AnimatedVisibility(state.connection == Connection.OPEN && !state.hostConnected) {
            Banner(stringResource(R.string.host_disconnected), Brand.dangerBanner, edge)
        }
        AnimatedVisibility(state.turnBanner) {
            val pulse by rememberInfiniteTransition(label = "turn").animateFloat(
                initialValue = 1f,
                targetValue = 0.6f,
                animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
                label = "pulse",
            )
            Banner(
                stringResource(R.string.turn_banner),
                Brand.accent.copy(alpha = pulse),
                edge,
                textColor = Brand.onAccent,
                modifier = Modifier.clickable(onClick = { controller.dismissTurnBanner() }),
            )
        }
    }
}

@Composable
private fun Banner(
    message: String,
    color: Color,
    edge: Dp,
    modifier: Modifier = Modifier,
    textColor: Color = Color.White,
    icon: Boolean = false,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = edge, vertical = 4.dp)
            .background(color, RoundedCornerShape(12.dp))
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon) {
            Icon(Icons.Filled.WifiOff, contentDescription = null, tint = textColor, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(message, color = textColor, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
    }
}

// Calificar el karaoke (el video y la música, no cómo cantaste) de una canción tuya que terminó.
@Composable
private fun RatingCard(title: String, onRate: (Int) -> Unit, modifier: Modifier = Modifier) {
    Surface(
        color = MaterialTheme.colorScheme.surfaceContainerHighest,
        shape = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
        shadowElevation = 12.dp,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.rating_title, title), fontWeight = FontWeight.Bold)
            Text(stringResource(R.string.rating_hint), style = MaterialTheme.typography.bodySmall, color = Brand.muted)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { onRate(1) }) {
                    Icon(Icons.Filled.ThumbUp, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.rating_up))
                }
                OutlinedButton(onClick = { onRate(-1) }) {
                    Icon(Icons.Filled.ThumbDown, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.rating_down))
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = { onRate(0) }) { Text(stringResource(R.string.rating_skip)) }
            }
        }
    }
}

// Pulgares arriba y abajo de una canción, sumando todas las salas (nada si nadie la calificó).
@Composable
fun RatingBadge(totals: RatingTotals?) {
    if (totals == null || totals.up + totals.down == 0) return
    val label = stringResource(R.string.rating_total, totals.up, totals.down)
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        modifier = Modifier.semantics(mergeDescendants = true) { contentDescription = label },
    ) {
        Icon(Icons.Filled.ThumbUp, contentDescription = null, modifier = Modifier.size(13.dp), tint = Brand.muted)
        Text("${totals.up}", style = MaterialTheme.typography.labelSmall, color = Brand.muted)
        Spacer(Modifier.width(4.dp))
        Icon(Icons.Filled.ThumbDown, contentDescription = null, modifier = Modifier.size(13.dp), tint = Brand.muted)
        Text("${totals.down}", style = MaterialTheme.typography.labelSmall, color = Brand.muted)
    }
}
