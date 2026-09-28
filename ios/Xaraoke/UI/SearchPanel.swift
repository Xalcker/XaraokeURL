// Buscador: explorador por letra/artista, búsqueda local sin acentos y búsqueda en YouTube.
// Equivalente a android/.../ui/SearchPanel.kt

import SwiftUI

private enum Browse: Equatable {
    case letters
    case artists(String)
    case songs(letter: String, artist: String)
}

private struct YoutubeView {
    let query: String
    var loading = true
    var results: [YoutubeVideo] = []
    var suffix: String? = nil
    var error: String? = nil
}

struct SearchPanel: View {
    @ObservedObject var controller: AppController
    @EnvironmentObject private var ui: UIState

    @State private var query = ""
    @State private var browse: Browse = .letters
    @State private var youtube: YoutubeView?
    @State private var searchTask: Task<Void, Never>?

    private var library: LibraryState { controller.library }

    var body: some View {
        VStack(spacing: 0) {
            searchField
            content
        }
    }

    private var searchField: some View {
        HStack {
            Image(systemName: "magnifyingglass").foregroundStyle(Brand.muted)
            TextField(L("search_placeholder"), text: $query)
                .textInputAutocapitalization(.never)
                .foregroundStyle(.white)
                .submitLabel(.search)
                .onSubmit(onSubmitSearch)
                .onChange(of: query) { _ in closeYoutube() }
            if !query.isEmpty {
                Button(action: reset) {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Brand.muted)
                }
                .accessibilityLabel(L("back"))
            }
        }
        .padding(12)
        .background(Brand.surface, in: Capsule())
        .padding(.horizontal, 12).padding(.vertical, 8)
    }

    @ViewBuilder
    private var content: some View {
        let q = query.trimmingCharacters(in: .whitespaces)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if let yt = youtube {
                    youtubeItems(yt)
                } else if !q.isEmpty {
                    localSearchItems(q)
                } else {
                    browseItems()
                }
            }
            .padding(.horizontal, 12).padding(.bottom, 160)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // --- explorador ---

    @ViewBuilder
    private func browseItems() -> some View {
        if !library.loaded {
            Loading(L("loading"))
        } else if library.loadFailed {
            Hint(L("library_load_failed"))
            NavButton(icon: "arrow.clockwise", label: L("retry")) { controller.loadLibrary() }
        } else if library.flatSongs.isEmpty {
            Hint(L("library_empty"))
            if !library.downloads.isEmpty {
                Hint(LPlural("library_downloads", library.downloads.count))
            }
        } else {
            switch browse {
            case .letters:
                LetterGrid(letters: availableLetters) { browse = .artists($0) }
            case .artists(let letter):
                NavButton(icon: "chevron.backward", label: L("back")) { browse = .letters }
                ForEach(artists(for: letter), id: \.self) { artist in
                    BrowserRow(icon: "mic.fill", title: artist) { browse = .songs(letter: letter, artist: artist) }
                }
            case .songs(let letter, let artist):
                NavButton(icon: "chevron.backward", label: L("back")) { browse = .artists(letter) }
                ForEach(songs(letter: letter, artist: artist), id: \.self) { filename in
                    songRow(filename)
                }
            }
        }
    }

    private var availableLetters: [String] {
        ALPHABET.map(String.init).filter { letter in library.songs.contains { $0.letter == letter } }
    }
    private func artists(for letter: String) -> [String] {
        library.songs.first { $0.letter == letter }?.artists.map { $0.artist } ?? []
    }
    private func songs(letter: String, artist: String) -> [String] {
        library.songs.first { $0.letter == letter }?.artists.first { $0.artist == artist }?.songs ?? []
    }

    // --- búsqueda local ---

    @ViewBuilder
    private func localSearchItems(_ q: String) -> some View {
        let matches = findLocalMatches(library, query: q)
        if matches.isEmpty {
            let empty = library.flatSongs.isEmpty && library.downloads.isEmpty
            Hint(L(empty ? "yt_press_enter" : "yt_no_local_matches"))
        }
        NavButton(icon: "magnifyingglass", label: L("yt_search_button")) { searchYoutube(q) }
        ForEach(Array(matches.songs.prefix(50)), id: \.self) { songRow($0) }
        ForEach(Array(matches.downloads.prefix(20)), id: \.filename) { downloadRow($0) }
    }

    // --- YouTube ---

    @ViewBuilder
    private func youtubeItems(_ view: YoutubeView) -> some View {
        NavButton(icon: "chevron.backward", label: L("back")) { closeYoutube() }
        if view.loading {
            Loading(L("yt_searching"))
        } else if let error = view.error, view.results.isEmpty {
            Text(error).foregroundStyle(Brand.danger)
            NavButton(icon: "arrow.clockwise", label: L("retry")) { searchYoutube(view.query) }
        } else if view.results.isEmpty {
            Hint(L("yt_no_results"))
        } else {
            if let error = view.error { Text(error).foregroundStyle(Brand.danger) }
            if view.suffix == "instrumental" { Hint(L("yt_fallback_instrumental"), warning: true) }
            if view.suffix == "none" { Hint(L("yt_fallback_none"), warning: true) }
            ForEach(view.results, id: \.id) { video in
                youtubeRow(video)
            }
        }
    }

    // --- filas ---

    private func songRow(_ filename: String) -> some View {
        let title = parseSongFilename(filename, unknownArtist: L("unknown_artist")).title
        return BrowserRow(icon: "music.note", title: title, trailing: AnyView(RatingBadge(library.ratings[filename]))) {
            queueSong(filename, title: title)
        }
    }

    private func downloadRow(_ download: Download) -> some View {
        let meta = [L("library_already_downloaded"), download.channel].compactMap { $0 }.joined(separator: " · ")
        return BrowserRow(icon: "arrow.down.circle", title: download.title, subtitle: meta,
                          trailing: AnyView(RatingBadge(library.ratings[download.filename]))) {
            queueSong(download.filename, title: download.title)
        }
    }

    private func youtubeRow(_ video: YoutubeVideo) -> some View {
        Button { downloadVideo(video) } label: {
            HStack {
                RemoteThumbnail(url: video.thumbnail)
                    .frame(width: 112, height: 63)
                    .background(Color.white.opacity(0.13), in: RoundedRectangle(cornerRadius: 8))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                VStack(alignment: .leading) {
                    Text(video.title).fontWeight(.semibold).lineLimit(2).foregroundStyle(.white)
                    let meta = [video.channel, video.durationSeconds.map(formatTime)].compactMap { $0 }.joined(separator: " · ")
                    if !meta.isEmpty { Text(meta).font(.footnote).foregroundStyle(Brand.muted) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(8)
            .background(Brand.surface, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }

    // --- acciones ---

    private func reset() {
        query = ""
        browse = .letters
        closeYoutube()
    }

    private func closeYoutube() {
        searchTask?.cancel()
        youtube = nil
    }

    private func onSubmitSearch() {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return }
        Task {
            await controller.refreshDownloadsAndRatings()
            if findLocalMatches(controller.library, query: q).isEmpty { searchYoutube(q) }
        }
    }

    private func searchYoutube(_ q: String) {
        searchTask?.cancel()
        youtube = YoutubeView(query: q)
        searchTask = Task {
            let result = await controller.searchYoutube(q)
            if youtube?.query != q || Task.isCancelled { return }
            switch result {
            case .success(let search):
                youtube = YoutubeView(query: q, loading: false, results: search.results, suffix: search.suffix)
            case .failure(let error):
                youtube = YoutubeView(query: q, loading: false, error: controller.errorText(error, fallback: "yt_search_failed"))
            }
        }
    }

    private func queueSong(_ filename: String, title: String) {
        ui.requestConfirm(ConfirmRequest(
            message: L("confirm_add_song", title),
            confirmLabel: L("confirm_add"),
            onConfirm: {
                controller.addSong(filename)
                reset()
            }
        ))
    }

    private func downloadVideo(_ video: YoutubeVideo) {
        let view = youtube
        ui.requestConfirm(ConfirmRequest(
            message: L("confirm_download", video.title),
            confirmLabel: L("confirm_add"),
            onConfirm: {
                ui.runBusy {
                    let result = await controller.downloadAndQueue(videoId: video.id, query: view?.query, suffix: view?.suffix)
                    switch result {
                    case .success: reset()
                    case .failure(let error):
                        youtube = view.map { var v = $0; v.error = controller.errorText(error, fallback: "yt_download_failed"); return v }
                    }
                }
            }
        ))
    }
}

// Canciones del catálogo y videos ya descargados, sin importar acentos ni mayúsculas.
private struct LocalMatches { let songs: [String]; let downloads: [Download]; var isEmpty: Bool { songs.isEmpty && downloads.isEmpty } }

private func findLocalMatches(_ library: LibraryState, query: String) -> LocalMatches {
    let q = normalizeForSearch(query)
    let songs = library.flatSongs.filter { filename in
        let d = parseSongFilename(filename, unknownArtist: "")
        return normalizeForSearch(d.artist).contains(q) || normalizeForSearch(d.title).contains(q)
    }
    let downloads = library.downloads.filter { d in
        [d.title, d.channel, d.query].compactMap { $0 }.contains { normalizeForSearch($0).contains(q) }
    }
    return LocalMatches(songs: songs, downloads: downloads)
}

private struct LetterGrid: View {
    let letters: [String]
    let onLetter: (String) -> Void
    private let columns = [GridItem(.adaptive(minimum: 52), spacing: 8)]
    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(letters, id: \.self) { letter in
                Button { onLetter(letter) } label: {
                    Text(letter).font(.title2.weight(.bold)).foregroundStyle(.white)
                        .frame(width: 52, height: 52)
                        .background(Brand.surface, in: RoundedRectangle(cornerRadius: 12))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.top, 4)
    }
}

struct BrowserRow: View {
    let icon: String
    let title: String
    var subtitle: String? = nil
    var trailing: AnyView? = nil
    let onClick: () -> Void

    var body: some View {
        Button(action: onClick) {
            HStack {
                Image(systemName: icon).foregroundStyle(Brand.accent).frame(width: 20)
                VStack(alignment: .leading) {
                    Text(title).lineLimit(2).foregroundStyle(.white)
                    if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(Brand.muted) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                if let trailing { trailing }
            }
            .padding(.horizontal, 14).padding(.vertical, 12)
            .background(Brand.surface, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
    }
}

private struct NavButton: View {
    let icon: String
    let label: String
    let onClick: () -> Void
    var body: some View {
        Button(action: onClick) {
            Label(label, systemImage: icon)
        }
        .buttonStyle(.bordered)
    }
}

private struct Loading: View {
    let message: String
    init(_ message: String) { self.message = message }
    var body: some View {
        HStack(spacing: 12) { ProgressView(); Text(message) }.padding(.vertical, 16)
    }
}

// Miniatura remota simple (AsyncImage). Reemplazable por caché en fases posteriores.
private struct RemoteThumbnail: View {
    let url: String?
    var body: some View {
        if let url, let parsed = URL(string: url) {
            AsyncImage(url: parsed) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                Color.clear
            }
        } else {
            Color.clear
        }
    }
}
