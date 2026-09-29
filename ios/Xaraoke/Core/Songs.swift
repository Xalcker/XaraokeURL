// Lo mismo que public/js/shared.js del remoto web: cómo se muestra una canción y cómo se busca.
// Equivalente a android/app/src/main/java/xyz/xalcker/xaraoke/core/Songs.kt

import Foundation

struct SongDisplay: Equatable {
    let artist: String
    let title: String
}

// Un nombre de archivo tiene forma "Artista - Titulo.mp4". El título puede contener " - "
// (remasters, versiones), así que solo el primer segmento es el artista.
func parseSongFilename(_ filename: String, unknownArtist: String) -> SongDisplay {
    let base = filename.hasSuffix(".mp4") ? String(filename.dropLast(4)) : filename
    let parts = base.components(separatedBy: " - ")
    if parts.count >= 2 {
        let artist = parts[0].trimmingCharacters(in: .whitespaces)
        let title = parts.dropFirst().joined(separator: " - ").trimmingCharacters(in: .whitespaces)
        return SongDisplay(artist: artist, title: title)
    }
    return SongDisplay(artist: unknownArtist, title: base)
}

// Las descargas de YouTube traen un título aparte, porque su nombre de archivo es un UUID.
func songDisplay(_ song: String, title: String?, unknownArtist: String) -> SongDisplay {
    if let title = title, !title.trimmingCharacters(in: .whitespaces).isEmpty {
        return SongDisplay(artist: "YouTube", title: title.trimmingCharacters(in: .whitespaces))
    }
    return parseSongFilename(song, unknownArtist: unknownArtist)
}

// Búsqueda insensible a acentos y mayúsculas ("musica" encuentra "Música").
// NFD descompone la letra de su acento; se quitan las marcas combinantes y se pasa a minúsculas.
func normalizeForSearch(_ text: String) -> String {
    let decomposed = text.decomposedStringWithCanonicalMapping
    let withoutMarks = decomposed.unicodeScalars.filter { scalar in
        // Categoría Mn: marcas combinantes sin ancho (los acentos descompuestos).
        !CharacterSet.nonBaseCharacters.contains(scalar)
    }
    return String(String.UnicodeScalarView(withoutMarks)).lowercased()
}

func formatTime(_ seconds: Double) -> String {
    if seconds.isNaN || seconds < 0 { return "0:00" }
    let mins = Int((seconds / 60).rounded(.down))
    let secs = Int(seconds.truncatingRemainder(dividingBy: 60).rounded(.down))
    return "\(mins):\(String(format: "%02d", secs))"
}

// Letras del explorador, en el mismo orden que el web ("#" agrupa a los artistas que empiezan con número).
let ALPHABET = "#ABCDEFGHIJKLMNOPQRSTUVWXYZ"
