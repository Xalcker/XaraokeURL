package xyz.xalcker.xaraoke.core

import java.text.Normalizer
import kotlin.math.floor

// Lo mismo que public/js/shared.js del remoto web: cómo se muestra una canción y cómo se busca.

data class SongDisplay(val artist: String, val title: String)

// Un nombre de archivo tiene forma "Artista - Titulo.mp4". El título puede contener " - "
// (remasters, versiones), así que solo el primer segmento es el artista.
fun parseSongFilename(filename: String, unknownArtist: String): SongDisplay {
    val base = filename.removeSuffix(".mp4")
    val parts = base.split(" - ")
    return if (parts.size >= 2) {
        SongDisplay(parts[0].trim(), parts.drop(1).joinToString(" - ").trim())
    } else {
        SongDisplay(unknownArtist, base)
    }
}

// Las descargas de YouTube traen un título aparte, porque su nombre de archivo es un UUID.
fun songDisplay(song: String, title: String?, unknownArtist: String): SongDisplay =
    if (!title.isNullOrBlank()) SongDisplay("YouTube", title.trim())
    else parseSongFilename(song, unknownArtist)

private val MARKS = Regex("\\p{Mn}+")

// Búsqueda insensible a acentos y mayúsculas ("musica" encuentra "Música").
fun normalizeForSearch(text: String): String =
    Normalizer.normalize(text, Normalizer.Form.NFD).replace(MARKS, "").lowercase()

fun formatTime(seconds: Double): String {
    if (seconds.isNaN() || seconds < 0) return "0:00"
    val mins = floor(seconds / 60).toInt()
    val secs = floor(seconds % 60).toInt()
    return "$mins:${secs.toString().padStart(2, '0')}"
}

// Letras del explorador, en el mismo orden que el web ("#" agrupa a los artistas que empiezan con número).
const val ALPHABET = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ"
