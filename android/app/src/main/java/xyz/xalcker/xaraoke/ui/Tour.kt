package xyz.xalcker.xaraoke.ui

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.animation.core.animateRectAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.CompositingStrategy
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import xyz.xalcker.xaraoke.R
import xyz.xalcker.xaraoke.core.Area
import xyz.xalcker.xaraoke.core.tourCardPosition

// El tutorial del remoto, igual que el del web (public/js/tour.js): oscurece la pantalla, resalta
// un elemento a la vez y lo explica en una tarjeta. Un paso cuyo elemento no está en pantalla se
// omite; el de los avisos no resalta nada (va al centro).
enum class TourStep(@param:StringRes val title: Int, @param:StringRes val text: Int, val hasTarget: Boolean = true) {
    ROOM(R.string.tour_room_title, R.string.tour_room_text),
    NOW_PLAYING(R.string.tour_now_playing_title, R.string.tour_now_playing_text),
    PLAY_PAUSE(R.string.tour_play_pause_title, R.string.tour_play_pause_text),
    SKIP(R.string.tour_skip_title, R.string.tour_skip_text),
    SEARCH(R.string.tour_search_title, R.string.tour_search_text),
    BROWSE(R.string.tour_browse_title, R.string.tour_browse_text),
    QUEUE(R.string.tour_queue_title, R.string.tour_queue_text),
    ALERTS(R.string.tour_alerts_title, R.string.tour_alerts_text, hasTarget = false),
    HELP(R.string.tour_help_title, R.string.tour_help_text),
}

@Stable
class TourState {
    // Dónde está cada elemento en la ventana, según lo informa su modificador tourTarget.
    val bounds = mutableStateMapOf<TourStep, Rect>()
    // Los pasos de esta vuelta, fijados al empezar (los que tenían su elemento en pantalla).
    var steps by mutableStateOf<List<TourStep>>(emptyList())
        private set
    var index by mutableIntStateOf(-1)

    val current: TourStep? get() = steps.getOrNull(index)

    fun start() {
        steps = TourStep.entries.filter { !it.hasTarget || bounds.containsKey(it) }
        index = 0
    }

    fun close() {
        index = -1
    }
}

val LocalTour = staticCompositionLocalOf { TourState() }

// Marca un elemento como el que se resalta en ese paso.
fun Modifier.tourTarget(step: TourStep): Modifier = composed {
    val tour = LocalTour.current
    DisposableEffect(step) { onDispose { tour.bounds.remove(step) } }
    onGloballyPositioned { tour.bounds[step] = it.boundsInWindow() }
}

@Composable
fun TourOverlay(tour: TourState) {
    val step = tour.current ?: return
    val density = LocalDensity.current
    var origin by remember { mutableStateOf(Offset.Zero) }
    var viewSize by remember { mutableStateOf(IntSize.Zero) }
    var cardSize by remember { mutableStateOf(IntSize.Zero) }
    val pad = with(density) { 6.dp.toPx() }
    val last = tour.index == tour.steps.lastIndex

    BackHandler { tour.close() }

    // Sin elemento, el resaltado se encoge a un punto al centro: solo queda el fondo oscuro.
    // El margen alrededor del elemento no se sale de la pantalla (un elemento pegado a la orilla,
    // como la pestaña de Mi lista, dejaría el borde del resaltado fuera).
    val edge = with(density) { 2.dp.toPx() }
    val screen = Rect(edge, edge, viewSize.width - edge, viewSize.height - edge)
    val raw = if (step.hasTarget) tour.bounds[step]?.translate(-origin)?.inflate(pad)?.intersect(screen) else null
    val center = Offset(viewSize.width / 2f, viewSize.height / 2f)
    val spot by animateRectAsState(raw ?: Rect(center, center), label = "spot")

    Box(
        Modifier
            .fillMaxSize()
            .onGloballyPositioned {
                origin = it.positionInWindow()
                viewSize = it.size
            }
            // Mientras dura, no se puede tocar lo de abajo.
            .pointerInput(Unit) { detectTapGestures { } },
    ) {
        Canvas(Modifier.fillMaxSize().graphicsLayer(compositingStrategy = CompositingStrategy.Offscreen)) {
            drawRect(Color.Black.copy(alpha = 0.72f))
            val radius = CornerRadius(12.dp.toPx())
            drawRoundRect(Color.Transparent, spot.topLeft, spot.size, radius, blendMode = BlendMode.Clear)
            if (raw != null) drawRoundRect(Brand.accent, spot.topLeft, spot.size, radius, style = Stroke(2.dp.toPx()))
        }

        val maxCard = with(density) { 400.dp.toPx() }
        val margin = with(density) { 12.dp.toPx() }
        val cardWidth = minOf(maxCard, viewSize.width - 2 * margin).coerceAtLeast(0f)
        val position = tourCardPosition(
            target = raw?.let { Area(it.left, it.top, it.width, it.height) },
            cardWidth = cardWidth,
            cardHeight = cardSize.height.toFloat(),
            viewWidth = viewSize.width.toFloat(),
            viewHeight = viewSize.height.toFloat(),
            gap = margin,
            margin = margin,
        )
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            shape = RoundedCornerShape(16.dp),
            shadowElevation = 8.dp,
            modifier = Modifier
                .offset { IntOffset(position.left.toInt(), position.top.toInt()) }
                .width(with(density) { cardWidth.toDp() })
                .onSizeChanged { cardSize = it }
                // Hasta medirla no se sabe dónde va: se muestra ya colocada.
                .alpha(if (cardSize == IntSize.Zero || viewSize == IntSize.Zero) 0f else 1f)
                .semantics { liveRegion = LiveRegionMode.Polite },
        ) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    stringResource(R.string.tour_counter, tour.index + 1, tour.steps.size),
                    style = MaterialTheme.typography.labelSmall,
                    color = Brand.muted,
                )
                Text(stringResource(step.title), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Text(stringResource(step.text), style = MaterialTheme.typography.bodyMedium)
                Row(Modifier.padding(top = 6.dp)) {
                    if (!last) TextButton(onClick = tour::close) { Text(stringResource(R.string.tour_skip)) }
                    Spacer(Modifier.weight(1f))
                    if (tour.index > 0) TextButton(onClick = { tour.index-- }) { Text(stringResource(R.string.tour_back)) }
                    Button(onClick = { if (last) tour.close() else tour.index++ }) {
                        Text(stringResource(if (last) R.string.tour_done else R.string.tour_next))
                    }
                }
            }
        }
    }
}
