// Lo que manda el servidor (ver src/realtime.js y src/routes/api.js).
// Equivalente a android/app/src/main/java/xyz/xalcker/xaraoke/core/Models.kt

import Foundation

struct QueueItem: Equatable {
    let id: String
    let song: String
    let name: String
    let title: String?
}

struct NowPlaying: Equatable {
    let song: String
    let title: String?
    let currentTime: Double
    let duration: Double
}

struct Download: Equatable {
    let filename: String
    let title: String
    let channel: String?
    let query: String?
}

struct YoutubeVideo: Equatable {
    let id: String
    let title: String
    let channel: String?
    let durationSeconds: Double?
    let thumbnail: String?
}

struct RatingRequest: Equatable {
    let id: String
    let song: String
    let title: String?
}

struct RatingTotals: Equatable {
    let up: Int
    let down: Int
}

// Cómo se entra a este servidor: con Google (y con qué client ID) o escribiendo un nombre.
struct AuthConfig: Equatable {
    let google: Bool
    let googleClientId: String?
    let allowedDomain: String?
}

// Biblioteca por inicial y artista, en el orden en que la manda el servidor.
// (En Kotlin es un Map ordenado; en Swift se preserva el orden con arreglos de pares
//  al construirlo desde ServerApi. Aquí solo se define el alias del contenido.)
typealias SongLibrary = [(letter: String, artists: [(artist: String, songs: [String])])]
