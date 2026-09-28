package xyz.xalcker.xaraoke.ui

import kotlinx.coroutines.Job
import androidx.compose.foundation.layout.isImeVisible
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import xyz.xalcker.xaraoke.AppController
import xyz.xalcker.xaraoke.LibraryState
import xyz.xalcker.xaraoke.R
import xyz.xalcker.xaraoke.core.ALPHABET
import xyz.xalcker.xaraoke.core.Download
import xyz.xalcker.xaraoke.core.YoutubeVideo
import xyz.xalcker.xaraoke.core.formatTime
import xyz.xalcker.xaraoke.core.normalizeForSearch
import xyz.xalcker.xaraoke.core.parseSongFilename

// Lo que muestra el explorador cuando no hay búsqueda escrita.
private sealed interface Browse {
    data object Letters : Browse
    data class Artists(val letter: String) : Browse
    data class Songs(val letter: String, val artist: String) : Browse
}

// La búsqueda en YouTube: cargando, con resultados o con error.
private data class YoutubeView(
    val query: String,
    val loading: Boolean = true,
    val results: List<YoutubeVideo> = emptyList(),
    val suffix: String? = null,
    val error: String? = null,
)

@Composable
@OptIn(ExperimentalLayoutApi::class)
fun SearchPanel(controller: AppController) {
    val library by controller.library.collectAsStateWithLifecycle()
    val confirm = LocalConfirm.current
    val busy = LocalBusy.current
    val resources = LocalResources.current
    val focus = LocalFocusManager.current
    val scope = rememberCoroutineScope()

    var query by rememberSaveable { mutableStateOf("") }
    var browse by remember { mutableStateOf<Browse>(Browse.Letters) }
    var youtube by remember { mutableStateOf<YoutubeView?>(null) }
    // La búsqueda en YouTube en curso: al salir de sus resultados se cancela, para que no vuelvan
    // a aparecer solos cuando llegue la respuesta.
    val youtubeJob = remember { arrayOfNulls<Job>(1) }

    val closeYoutube = {
        youtubeJob[0]?.cancel()
        youtube = null
    }

    val reset = {
        query = ""
        browse = Browse.Letters
        closeYoutube()
    }

    fun searchYoutube(q: String) {
        // Se cierra el teclado de una vez: ocultarlo después (con "Atrás") se confundía con salir.
        focus.clearFocus()
        youtubeJob[0]?.cancel()
        youtube = YoutubeView(q)
        youtubeJob[0] = scope.launch {
            val result = controller.searchYoutube(q)
            if (youtube?.query != q) return@launch
            result
                .onSuccess { youtube = YoutubeView(q, loading = false, results = it.results, suffix = it.suffix) }
                .onFailure {
                    youtube = YoutubeView(
                        q,
                        loading = false,
                        error = controller.errorText(it, R.string.yt_search_failed).resolve(resources),
                    )
                }
        }
    }

    val queueSong: (String, String) -> Unit = { filename, title ->
        confirm(
            ConfirmRequest(
                message = resources.getString(R.string.confirm_add_song, title),
                confirmLabel = resources.getString(R.string.confirm_add),
            ) {
                controller.addSong(filename)
                reset()
            }
        )
    }

    val downloadVideo: (YoutubeVideo) -> Unit = { video ->
        val view = youtube
        confirm(
            ConfirmRequest(
                message = resources.getString(R.string.confirm_download, video.title),
                confirmLabel = resources.getString(R.string.confirm_add),
            ) {
                busy {
                    controller.downloadAndQueue(video.id, view?.query, view?.suffix)
                        .onSuccess { reset() }
                        .onFailure {
                            youtube = view?.copy(error = controller.errorText(it, R.string.yt_download_failed).resolve(resources))
                        }
                }
            }
        )
    }

    // Atrás del teléfono: deshace la navegación del explorador y sale de los resultados de YouTube.
    // Nunca borra lo escrito (para eso está la ✕). Con el teclado abierto no hace nada aquí: el
    // botón de ocultar el teclado de Samsung es un "Atrás", y a veces también llegaba a la app.
    val browsing = query.isEmpty() && browse != Browse.Letters
    val keyboardOpen = WindowInsets.isImeVisible
    BackHandler(enabled = !keyboardOpen && (youtube != null || browsing)) {
        when {
            youtube != null -> closeYoutube()
            browse is Browse.Songs -> browse = Browse.Artists((browse as Browse.Songs).letter)
            else -> browse = Browse.Letters
        }
    }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = {
                query = it
                closeYoutube()
            },
            placeholder = { Text(stringResource(R.string.search_placeholder)) },
            leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
            trailingIcon = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = reset) { Icon(Icons.Filled.Clear, contentDescription = stringResource(R.string.back)) }
                }
            },
            singleLine = true,
            shape = RoundedCornerShape(28.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            // Buscar en el teclado va directo a YouTube si no hay nada en la biblioteca (ni entre
            // lo ya descargado); antes se actualizan las descargas, por si alguien ya lo bajó.
            keyboardActions = KeyboardActions(onSearch = {
                focus.clearFocus()
                val q = query.trim()
                if (q.isEmpty()) return@KeyboardActions
                scope.launch {
                    controller.refreshDownloadsAndRatings()
                    if (findLocalMatches(controller.library.value, q).isEmpty) searchYoutube(q)
                }
            }),
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 8.dp)
                .tourTarget(TourStep.SEARCH)
                .onFocusChanged { if (it.isFocused) scope.launch { controller.refreshDownloadsAndRatings() } },
        )

        val yt = youtube
        val q = query.trim()
        LazyColumn(
            contentPadding = PaddingValues(start = 12.dp, end = 12.dp, bottom = 160.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.weight(1f),
        ) {
            when {
                yt != null -> youtubeItems(yt, onBack = closeYoutube, onRetry = { searchYoutube(yt.query) }, onPick = downloadVideo)
                q.isNotEmpty() -> localSearchItems(library, q, queueSong, onYoutube = { searchYoutube(q) })
                else -> browseItems(library, browse, onBrowse = { browse = it }, onSong = queueSong, onRetry = controller::loadLibrary)
            }
        }
    }
}

private data class LocalMatches(val songs: List<String>, val downloads: List<Download>) {
    val isEmpty get() = songs.isEmpty() && downloads.isEmpty()
}

// Canciones del catálogo y videos ya descargados (estos también por su canal y por la búsqueda
// con la que se encontraron), sin importar acentos ni mayúsculas.
private fun findLocalMatches(library: LibraryState, query: String): LocalMatches {
    val q = normalizeForSearch(query)
    val songs = library.flatSongs.filter { filename ->
        val d = parseSongFilename(filename, "")
        normalizeForSearch(d.artist).contains(q) || normalizeForSearch(d.title).contains(q)
    }
    val downloads = library.downloads.filter { d ->
        listOfNotNull(d.title, d.channel, d.query).any { normalizeForSearch(it).contains(q) }
    }
    return LocalMatches(songs, downloads)
}

private fun LazyListScope.localSearchItems(
    library: LibraryState,
    query: String,
    onSong: (String, String) -> Unit,
    onYoutube: () -> Unit,
) {
    val matches = findLocalMatches(library, query)
    if (matches.isEmpty) {
        item {
            val empty = library.flatSongs.isEmpty() && library.downloads.isEmpty()
            Hint(stringResource(if (empty) R.string.yt_press_enter else R.string.yt_no_local_matches))
        }
    }
    // Arriba de la lista: aunque haya coincidencias, puede que la que se busca no esté.
    item { NavButton(Icons.Filled.Search, stringResource(R.string.yt_search_button), onYoutube) }
    items(matches.songs.take(50), key = { "s:$it" }) { filename -> SongRow(filename, library, onSong) }
    items(matches.downloads.take(20), key = { "d:${it.filename}" }) { download -> DownloadRow(download, library, onSong) }
}

private fun LazyListScope.browseItems(
    library: LibraryState,
    browse: Browse,
    onBrowse: (Browse) -> Unit,
    onSong: (String, String) -> Unit,
    onRetry: () -> Unit,
) {
    when {
        !library.loaded -> item { Loading(stringResource(R.string.loading)) }
        library.loadFailed -> {
            item { Hint(stringResource(R.string.library_load_failed)) }
            item { NavButton(Icons.Filled.Refresh, stringResource(R.string.retry), onRetry) }
        }
        library.flatSongs.isEmpty() -> {
            item { Hint(stringResource(R.string.library_empty)) }
            if (library.downloads.isNotEmpty()) {
                item {
                    val n = library.downloads.size
                    Hint(pluralStringResource(R.plurals.library_downloads, n, n))
                }
            }
        }
        browse is Browse.Letters -> item {
            val letters = ALPHABET.map { it.toString() }.filter { library.songs.containsKey(it) }
            LetterGrid(letters) { onBrowse(Browse.Artists(it)) }
        }
        browse is Browse.Artists -> {
            item { NavButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) { onBrowse(Browse.Letters) } }
            val artists = library.songs[browse.letter]?.keys?.sorted().orEmpty()
            items(artists, key = { "a:$it" }) { artist ->
                BrowserRow(Icons.Filled.Mic, artist, onClick = { onBrowse(Browse.Songs(browse.letter, artist)) })
            }
        }
        browse is Browse.Songs -> {
            item {
                NavButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) {
                    onBrowse(Browse.Artists(browse.letter))
                }
            }
            val songs = library.songs[browse.letter]?.get(browse.artist).orEmpty()
            items(songs, key = { "s:$it" }) { filename -> SongRow(filename, library, onSong) }
        }
    }
}

private fun LazyListScope.youtubeItems(
    view: YoutubeView,
    onBack: () -> Unit,
    onRetry: () -> Unit,
    onPick: (YoutubeVideo) -> Unit,
) {
    item { NavButton(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back), onBack) }
    if (view.loading) {
        item { Loading(stringResource(R.string.yt_searching)) }
        return
    }
    view.error?.let { error ->
        item { ErrorText(error) }
        if (view.results.isEmpty()) {
            item { NavButton(Icons.Filled.Refresh, stringResource(R.string.retry), onRetry) }
            return
        }
    }
    if (view.results.isEmpty()) {
        item { Hint(stringResource(R.string.yt_no_results)) }
        return
    }
    // Si no hubo versiones karaoke, se avisa: lo que sigue puede traer la voz original.
    when (view.suffix) {
        "instrumental" -> item { Hint(stringResource(R.string.yt_fallback_instrumental), warning = true) }
        "none" -> item { Hint(stringResource(R.string.yt_fallback_none), warning = true) }
    }
    items(view.results, key = { "y:${it.id}" }) { video -> YoutubeRow(video) { onPick(video) } }
}

@Composable
private fun LetterGrid(letters: List<String>, onLetter: (String) -> Unit) {
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth().padding(top = 4.dp).tourTarget(TourStep.BROWSE),
    ) {
        letters.forEach { letter ->
            Surface(
                color = Brand.surface,
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.size(52.dp).clickable { onLetter(letter) },
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Text(letter, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

@Composable
private fun SongRow(filename: String, library: LibraryState, onSong: (String, String) -> Unit) {
    val title = parseSongFilename(filename, stringResource(R.string.unknown_artist)).title
    BrowserRow(Icons.Filled.MusicNote, title, trailing = { RatingBadge(library.ratings[filename]) }) {
        onSong(filename, title)
    }
}

// Video de YouTube que ya se descargó antes: se agrega directo, sin volver a bajarlo.
@Composable
private fun DownloadRow(download: Download, library: LibraryState, onSong: (String, String) -> Unit) {
    val meta = listOfNotNull(stringResource(R.string.library_already_downloaded), download.channel).joinToString(" · ")
    BrowserRow(
        Icons.Filled.Download,
        download.title,
        subtitle = meta,
        trailing = { RatingBadge(library.ratings[download.filename]) },
    ) { onSong(download.filename, download.title) }
}

@Composable
private fun YoutubeRow(video: YoutubeVideo, onClick: () -> Unit) {
    Surface(color = Brand.surface, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
            val thumb = video.thumbnail?.let { rememberRemoteImage(it) }
            Box(
                Modifier.width(112.dp).aspectRatio(16f / 9f).background(Color(0x22FFFFFF), RoundedCornerShape(8.dp)),
            ) {
                if (thumb != null) {
                    Image(thumb, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                }
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(video.title, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val meta = listOfNotNull(video.channel, video.durationSeconds?.let(::formatTime)).joinToString(" · ")
                if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodySmall, color = Brand.muted)
            }
        }
    }
}

@Composable
fun BrowserRow(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String? = null,
    trailing: @Composable () -> Unit = {},
    onClick: () -> Unit,
) {
    Surface(color = Brand.surface, shape = RoundedCornerShape(12.dp), modifier = Modifier.fillMaxWidth().clickable(onClick = onClick)) {
        Row(Modifier.padding(horizontal = 14.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = Brand.accent, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = Brand.muted)
            }
            trailing()
        }
    }
}

@Composable
private fun NavButton(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(6.dp))
        Text(label)
    }
}

@Composable
fun Hint(message: String, warning: Boolean = false) {
    Text(
        message,
        color = if (warning) Color(0xFFFFC107) else Brand.muted,
        modifier = Modifier.padding(vertical = 8.dp),
    )
}

@Composable
private fun Loading(message: String) {
    Row(Modifier.padding(vertical = 16.dp), verticalAlignment = Alignment.CenterVertically) {
        CircularProgressIndicator(Modifier.size(22.dp))
        Spacer(Modifier.width(12.dp))
        Text(message)
    }
}
