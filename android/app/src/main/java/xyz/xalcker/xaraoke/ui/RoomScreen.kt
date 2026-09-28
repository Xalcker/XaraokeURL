package xyz.xalcker.xaraoke.ui

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
fun RoomScreen(controller: AppController, state: RoomState, modifier: Modifier = Modifier) {
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
            // Se espera a que la pantalla se acomode (la biblioteca tarda un poco en llegar).
            delay(800)
            tour.start()
        }
    }
    CompositionLocalProvider(LocalTour provides tour) {
        Box(modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                Header(controller, state, onTutorial = startTour)
                MiniPlayer(controller, state)
                Banners(controller, state)
                val mineCount = state.queue.count(state::isMine)
                PrimaryTabRow(selectedTabIndex = tab, containerColor = Color.Transparent) {
                    Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text(stringResource(R.string.tab_search)) })
                    Tab(
                        selected = tab == 1,
                        onClick = { tab = 1 },
                        text = {
                            // El número va al lado del texto, no encima (un globo en la esquina lo tapaba).
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                Text(stringResource(R.string.tab_queue))
                                if (mineCount > 0) Badge(containerColor = Brand.accent, contentColor = Brand.onAccent) {
                                    Text("$mineCount")
                                }
                            }
                        },
                        modifier = Modifier.tourTarget(TourStep.QUEUE),
                    )
                }
                Box(Modifier.weight(1f)) {
                    if (tab == 0) SearchPanel(controller) else QueuePanel(controller, state)
                }
            }
            state.ratingRequests.firstOrNull()?.let { request ->
                RatingCard(
                    title = songDisplay(request.song, request.title, stringResource(R.string.unknown_artist)).let {
                        stringResource(R.string.now_playing, it.artist, it.title)
                    },
                    onRate = { controller.rate(request.id, it) },
                    modifier = Modifier.align(Alignment.BottomCenter),
                )
            }
            TourOverlay(tour)
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
private fun MiniPlayer(controller: AppController, state: RoomState) {
    val confirm = LocalConfirm.current
    val resources = LocalResources.current
    val unknown = stringResource(R.string.unknown_artist)
    val head = state.head
    val progress = state.headProgress
    Surface(
        color = Brand.surface,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f).tourTarget(TourStep.NOW_PLAYING), verticalArrangement = Arrangement.spacedBy(2.dp)) {
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
                Spacer(Modifier.width(8.dp))
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

@Composable
private fun Banners(controller: AppController, state: RoomState) {
    AnimatedVisibility(state.connection == Connection.RETRYING) {
        Banner(stringResource(R.string.conn_retrying), Brand.dangerBanner, icon = true)
    }
    AnimatedVisibility(state.connection == Connection.OPEN && !state.hostConnected) {
        Banner(stringResource(R.string.host_disconnected), Brand.dangerBanner)
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
            textColor = Brand.onAccent,
            modifier = Modifier.clickable(onClick = { controller.dismissTurnBanner() }),
        )
    }
}

@Composable
private fun Banner(
    message: String,
    color: Color,
    modifier: Modifier = Modifier,
    textColor: Color = Color.White,
    icon: Boolean = false,
) {
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 4.dp)
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
