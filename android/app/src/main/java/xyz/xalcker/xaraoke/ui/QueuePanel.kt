package xyz.xalcker.xaraoke.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import xyz.xalcker.xaraoke.AppController
import xyz.xalcker.xaraoke.R
import xyz.xalcker.xaraoke.core.songDisplay
import xyz.xalcker.xaraoke.room.Notifications
import xyz.xalcker.xaraoke.room.RoomState

// La lista de todos, con tus canciones resaltadas: puedes reordenar las tuyas entre sí y quitarlas.
// `leading` va arriba de la lista y se desplaza con ella: en pantallas anchas, el mini-reproductor
// y los avisos (así, con el teléfono acostado, la lista no queda aplastada bajo ellos).
@Composable
fun QueuePanel(
    controller: AppController,
    state: RoomState,
    modifier: Modifier = Modifier,
    leading: LazyListScope.() -> Unit = {},
) {
    val library by controller.library.collectAsStateWithLifecycle()
    val confirm = LocalConfirm.current
    val context = LocalContext.current
    val resources = LocalResources.current
    val unknown = stringResource(R.string.unknown_artist)
    // La primera es la que suena: no se mueve ni se quita desde aquí.
    val waiting = state.queue.drop(1)
    val mineIds = waiting.filter(state::isMine).map { it.id }

    LazyColumn(
        contentPadding = PaddingValues(start = 12.dp, end = 12.dp, top = 8.dp, bottom = 160.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
        modifier = modifier.fillMaxSize(),
    ) {
        leading()
        item {
            Text(
                Notifications.turnSummary(context, state),
                fontWeight = FontWeight.SemiBold,
                color = Brand.accent,
                modifier = Modifier.padding(vertical = 4.dp),
            )
        }
        if (waiting.isEmpty()) {
            item { Hint(stringResource(R.string.queue_empty_list)) }
        }
        items(waiting, key = { it.id }) { item ->
            val mine = state.isMine(item)
            val title = songDisplay(item.song, item.title, unknown).title
            Surface(
                color = if (mine) Brand.mine else Brand.surface,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Row(Modifier.padding(start = 14.dp, end = 4.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                        Text(title, fontWeight = FontWeight.Bold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (mine) stringResource(R.string.queue_you) else item.name,
                                style = MaterialTheme.typography.bodySmall,
                                color = if (mine) Brand.accent else Brand.muted,
                                modifier = Modifier.padding(end = 8.dp),
                            )
                            RatingBadge(library.ratings[item.song])
                        }
                    }
                    if (mine) {
                        // Solo se ofrece mover si hay otra tuya hacia ese lado: el servidor nunca
                        // mueve las de los demás.
                        if (mineIds.size > 1) {
                            val position = mineIds.indexOf(item.id)
                            IconButton(onClick = { controller.moveSong(item.id, up = true) }, enabled = position > 0) {
                                Icon(Icons.Filled.KeyboardArrowUp, contentDescription = stringResource(R.string.move_up))
                            }
                            IconButton(onClick = { controller.moveSong(item.id, up = false) }, enabled = position < mineIds.size - 1) {
                                Icon(Icons.Filled.KeyboardArrowDown, contentDescription = stringResource(R.string.move_down))
                            }
                        }
                        TextButton(
                            onClick = {
                                confirm(
                                    ConfirmRequest(
                                        message = resources.getString(R.string.confirm_remove, title),
                                        confirmLabel = resources.getString(R.string.confirm_remove_yes),
                                        danger = true,
                                        stillValid = { s -> s?.queue?.drop(1)?.any { it.id == item.id } == true },
                                        onConfirm = { controller.removeSong(item.id) },
                                    )
                                )
                            },
                            colors = ButtonDefaults.textButtonColors(contentColor = Brand.danger),
                        ) { Text(stringResource(R.string.queue_remove)) }
                    }
                }
            }
        }
    }
}
