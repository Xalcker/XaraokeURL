// Todo lo que no es pantalla: el servidor, la sesión, la biblioteca y la sala. Vive lo que vive la
// app (no la pantalla), así que la sala sigue conectada con la app cerrada.
// Equivalente a android/.../AppController.kt
//
// Los avisos de notificación (turno, notificación fija, sesión vencida) se delegan en RoomNotifying,
// que en Fase 4 implementará UNUserNotificationCenter / Live Activities. Por ahora hay una
// implementación vacía por defecto, para que la lógica de sala funcione y se pueda probar.

import Foundation
import Network

protocol RoomNotifying: AnyObject {
    func alertTurn(_ alert: TurnTracker.Alert, state: RoomState)
    func cancelTurn()
    func sessionExpired()
    func roomStarted()
    func roomStopped()
    func roomStateChanged(_ state: RoomState)
}

// Implementación vacía para las fases anteriores a la 4.
final class NoopNotifying: RoomNotifying {
    func alertTurn(_ alert: TurnTracker.Alert, state: RoomState) {}
    func cancelTurn() {}
    func sessionExpired() {}
    func roomStarted() {}
    func roomStopped() {}
    func roomStateChanged(_ state: RoomState) {}
}

// El servidor al que se conecta la app y quién eres en él.
struct SessionState: Equatable {
    var serverUrl: String? = nil
    var auth: AuthConfig? = nil
    var loadingServer: Bool = false
    var serverError: String? = nil
    // Con Google: tu nombre si hay sesión. Sin Google: el nombre que elegiste (nil si aún no).
    var myName: String? = nil
    var signingIn: Bool = false
    var roomCode: String = ""
    var nameInput: String = ""
    var joining: Bool = false
    var joinError: String? = nil
    // Sube cada vez que hace falta iniciar sesión con Google: la pantalla lo ve y abre el flujo.
    var googleSignInRequest: Int = 0
}

struct LibraryState: Equatable {
    var songs: SongLibrary = []
    var loaded: Bool = false
    var loadFailed: Bool = false
    var downloads: [Download] = []
    var ratings: [String: RatingTotals] = [:]

    var flatSongs: [String] {
        songs.flatMap { $0.artists.flatMap { $0.songs } }
    }

    static func == (lhs: LibraryState, rhs: LibraryState) -> Bool {
        lhs.loaded == rhs.loaded && lhs.loadFailed == rhs.loadFailed &&
            lhs.downloads == rhs.downloads && lhs.ratings == rhs.ratings &&
            lhs.flatSongs == rhs.flatSongs
    }
}

@MainActor
final class AppController: ObservableObject {
    @Published private(set) var session = SessionState()
    @Published private(set) var room: RoomState?
    @Published private(set) var library = LibraryState()
    @Published private(set) var pendingShare: String?
    // Mensajes breves (toasts). La UI observa este contador + el último mensaje.
    @Published private(set) var toast: String?

    private let http = HttpClient()
    private let defaults = UserDefaults.standard
    private let notifier: RoomNotifying
    private let monitor = NWPathMonitor()

    private var api: ServerApi?
    private var connection: RoomConnection?
    // Entrar sola a la sala en cuanto haya sesión (venía en un enlace o era la última).
    private var autoJoin = false

    private enum Key {
        static let server = "server"
        static let room = "room"
        static let lastName = "lastName"
        static let tourSeen = "tourSeen"
    }

    init(notifier: RoomNotifying = NoopNotifying()) {
        self.notifier = notifier
        if let server = defaults.string(forKey: Key.server) {
            let savedRoom = defaults.string(forKey: Key.room)
            session.serverUrl = server
            session.roomCode = savedRoom ?? ""
            autoJoin = savedRoom != nil
            loadServer()
        }
        // Volvió la red: no hace falta esperar al siguiente reintento.
        monitor.pathUpdateHandler = { [weak self] path in
            if path.status == .satisfied {
                Task { @MainActor in self?.connection?.reconnectNow() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "xyz.xalcker.xaraoke.net.monitor"))
    }

    // --- servidor y sesión ---

    func setServer(_ input: String, room: String? = nil) {
        guard let server = normalizeServerUrl(input) else {
            session.serverError = L("server_invalid")
            return
        }
        leaveRoom(forget: false)
        defaults.set(server, forKey: Key.server)
        library = LibraryState()
        session = SessionState(serverUrl: server, roomCode: room ?? "")
        autoJoin = room != nil
        loadServer()
    }

    // Olvida el servidor para escribir o escanear otro.
    func changeServer() {
        leaveRoom()
        defaults.removeObject(forKey: Key.server)
        api = nil
        library = LibraryState()
        session = SessionState()
    }

    func retryServer() { loadServer() }

    private func loadServer() {
        guard let server = session.serverUrl else { return }
        let api = ServerApi(baseUrl: server, session: http.session, onCookies: { [weak self] in self?.http.cookies.persist() })
        self.api = api
        session.loadingServer = true
        session.serverError = nil
        Task {
            do {
                let me = try await api.me()
                // Un servidor anterior a la app no dice cómo se entra. Si deja entrar sin sesión es
                // que no usa Google (modo nombre) y funciona igual; con Google, la app no puede
                // iniciar sesión hasta que se actualice (le falta /api/auth/google-token).
                let auth: AuthConfig
                if let config = try await api.authConfig() {
                    auth = config
                } else if me?.nameMode == true {
                    auth = AuthConfig(google: false, googleClientId: nil, allowedDomain: nil)
                } else {
                    session.loadingServer = false
                    session.serverError = L("server_outdated", server)
                    return
                }
                session.auth = auth
                session.loadingServer = false
                session.myName = me?.name
                session.nameInput = me?.name ?? defaults.string(forKey: Key.lastName) ?? ""
                continueAutoJoin()
            } catch {
                session.loadingServer = false
                session.serverError = L("server_unreachable", server)
            }
        }
    }

    private func continueAutoJoin() {
        guard autoJoin, normalizeRoomCode(session.roomCode) != nil else { return }
        if session.auth?.google == true && session.myName == nil {
            requestGoogleSignIn()
        } else if session.myName != nil {
            join(session.roomCode, name: session.myName)
        } else {
            // Sin Google y sin nombre elegido: se deja el código puesto y se espera el nombre.
            autoJoin = false
        }
    }

    func requestGoogleSignIn() { session.googleSignInRequest += 1 }

    func onGoogleIdToken(_ idToken: String) {
        guard let api = api else { return }
        session.signingIn = true
        session.joinError = nil
        Task {
            do {
                let name = try await api.signInWithGoogle(idToken: idToken)
                session.signingIn = false
                session.myName = name
                continueAutoJoin()
            } catch {
                autoJoin = false
                session.signingIn = false
                session.joinError = errorText(error, fallback: "login_failed")
            }
        }
    }

    func onGoogleSignInFailed(_ message: String?) {
        autoJoin = false
        session.signingIn = false
        session.joinError = message
    }

    func signOut() {
        leaveRoom()
        if let api = api { http.cookies.clearFor(api.url) }
        GoogleSignIn.signOut()
        session.myName = nil
        session.joinError = nil
    }

    func setRoomCodeInput(_ value: String) {
        session.roomCode = String(value.uppercased().prefix(4))
        session.joinError = nil
    }

    func setNameInput(_ value: String) {
        session.nameInput = value
        session.joinError = nil
    }

    // Un QR o un enlace: puede traer otro servidor, una sala, o ambos.
    func openJoinLink(_ link: JoinLink) {
        let current = session.serverUrl
        if let server = link.serverUrl, server != current {
            setServer(server, room: link.roomCode)
            return
        }
        guard let room = link.roomCode else { return }
        if self.room?.roomCode == room { return }
        leaveRoom(forget: false)
        session.roomCode = room
        session.joinError = nil
        autoJoin = true
        if session.auth != nil { continueAutoJoin() }
    }

    // --- sala ---

    func join(_ codeInput: String, name nameInput: String?) {
        guard let api = api else { return }
        autoJoin = false
        guard let code = normalizeRoomCode(codeInput) else {
            session.joinError = L("join_code_length")
            return
        }
        let nameMode = session.auth?.google == false
        let name = nameInput?.trimmingCharacters(in: .whitespaces) ?? ""
        if nameMode && name.isEmpty {
            session.joinError = L("join_name_required")
            return
        }
        session.joining = true
        session.joinError = nil
        session.roomCode = code
        Task {
            do {
                let myName: String
                if nameMode {
                    myName = try await api.setName(name, room: code)
                    defaults.set(myName, forKey: Key.lastName)
                } else {
                    var existing = session.myName
                    if existing == nil { existing = try await api.me()?.name }
                    guard let resolved = existing else {
                        session.joining = false
                        session.myName = nil
                        autoJoin = true
                        requestGoogleSignIn()
                        return
                    }
                    myName = resolved
                }
                if !(try await api.roomExists(code)) {
                    let saved = defaults.string(forKey: Key.room) == code
                    if saved { defaults.removeObject(forKey: Key.room) }
                    session.joining = false
                    session.roomCode = saved ? "" : code
                    session.joinError = saved ? L("join_saved_room_gone", code) : L("join_room_missing", code)
                    return
                }
                session.joining = false
                session.myName = myName
                session.nameInput = myName
                enterRoom(api, code: code, myName: myName)
            } catch {
                session.joining = false
                session.joinError = errorText(error, fallback: "join_verify_failed")
            }
        }
    }

    private func enterRoom(_ api: ServerApi, code: String, myName: String) {
        defaults.set(code, forKey: Key.room)
        var bannerWasShown = false
        let conn = RoomConnection(
            session: http.session,
            webSocketUrl: api.webSocketUrl,
            roomCode: code,
            myName: myName,
            onState: { [weak self] state in
                guard let self = self else { return }
                if self.connection == nil { return }
                self.room = state
                self.notifier.roomStateChanged(state)
                // Al quitarse "¡Prepárate!" (empezó tu canción) se quita también su notificación.
                if bannerWasShown && !state.turnBanner { self.notifier.cancelTurn() }
                bannerWasShown = state.turnBanner
            },
            onTurn: { [weak self] alert, state in self?.notifier.alertTurn(alert, state: state) },
            onEvent: { [weak self] event in self?.onRoomEvent(event) },
            onExit: { [weak self] exit in self?.onRoomExit(exit) }
        )
        connection = conn
        conn.start()
        notifier.roomStarted()
        // Push (Fase 5): recibir el aviso de turno con la app cerrada.
        PushRegistration.shared.enable(api: api, room: code)
        loadLibrary()
    }

    // forget: olvidar la sala recordada (salir a propósito).
    func leaveRoom(forget: Bool = true) {
        connection?.close()
        connection = nil
        room = nil
        notifier.cancelTurn()
        notifier.roomStopped()
        PushRegistration.shared.disable()
        if forget {
            defaults.removeObject(forKey: Key.room)
            autoJoin = false
        }
    }

    private func onRoomEvent(_ event: RoomEvent) {
        switch event {
        case .addRejected(let personalLimit, let limit):
            toast = LPlural(personalLimit ? "toast_personal_limit" : "toast_queue_full", limit)
        case .hostBack:
            toast = L("toast_host_back")
        case .downloadsChanged:
            Task { await refreshDownloadsAndRatings() }
        }
    }

    private func onRoomExit(_ exit: RoomExit) {
        let code = room?.roomCode ?? ""
        switch exit {
        case .roomGone:
            leaveRoom()
            session.roomCode = ""
            session.joinError = L("conn_room_gone")
        case .sessionExpired:
            leaveRoom(forget: false)
            autoJoin = true
            session.myName = nil
            session.roomCode = code
            session.joinError = L("conn_session_expired")
            notifier.sessionExpired()
            if session.auth?.google == true { requestGoogleSignIn() }
        case .nameTaken:
            leaveRoom(forget: false)
            session.myName = nil
            session.roomCode = code
            session.joinError = L("api_name_taken")
        case .rejected:
            leaveRoom(forget: false)
            session.roomCode = code
            session.joinError = L("conn_rejected")
        }
    }

    // Al volver a la app: reconecta ya si estaba reintentando y trae lo nuevo de la biblioteca.
    func onAppForeground() {
        connection?.reconnectNow()
        if room != nil { Task { await refreshDownloadsAndRatings() } }
    }

    // Las acciones devuelven lo mismo que en el web: si no hay conexión, se avisa.
    private func act(_ action: (RoomConnection) -> Bool) {
        guard let conn = connection, action(conn) else {
            toast = L("toast_offline")
            return
        }
    }

    func playPause() { act { $0.playPause() } }
    func skip(_ songId: String) { act { $0.skip(songId) } }
    func voteSkip(_ songId: String) { act { $0.voteSkip(songId) } }
    func removeSong(_ songId: String) { act { $0.removeSong(songId) } }
    func moveSong(_ songId: String, up: Bool) { act { $0.moveSong(songId, up: up) } }
    func dismissTurnBanner() { connection?.dismissTurnBanner() }

    func addSong(_ filename: String) {
        act { conn in
            let sent = conn.addSong(filename)
            if sent { self.toast = L("toast_added") }
            return sent
        }
    }

    func rate(_ ratingId: String, value: Int) {
        guard let conn = connection, conn.rate(ratingId, value: value) else {
            toast = L("toast_offline")
            return
        }
        if value != 0 { toast = L("toast_rated") }
    }

    // --- biblioteca ---

    func loadLibrary() {
        guard let api = api else { return }
        Task {
            await refreshDownloadsAndRatings()
            do {
                let songs = try await api.songs()
                library.songs = songs
                library.loaded = true
                library.loadFailed = false
            } catch {
                library.loaded = true
                library.loadFailed = true
            }
        }
    }

    // Si falla se conserva lo último que se sabía. Devuelve true si cambió algo.
    @discardableResult
    func refreshDownloadsAndRatings() async -> Bool {
        guard let api = api else { return false }
        let before = library
        async let downloadsTask = try? await api.downloads()
        async let ratingsTask = try? await api.ratings()
        let d = (await downloadsTask) ?? before.downloads
        let r = (await ratingsTask) ?? before.ratings
        library.downloads = d
        library.ratings = r
        return d != before.downloads || r != before.ratings
    }

    func searchYoutube(_ query: String) async -> Result<YoutubeSearch, Error> {
        guard let api = api else { return .failure(ApiException(status: 0, serverMessage: nil)) }
        do { return .success(try await api.searchYoutube(query)) }
        catch { return .failure(error) }
    }

    // Descarga el video en el servidor (o reutiliza el que ya estaba) y lo agrega a la cola.
    func downloadAndQueue(videoId: String, query: String?, suffix: String?) async -> Result<Void, Error> {
        guard let api = api else { return .failure(ApiException(status: 0, serverMessage: nil)) }
        do {
            let filename = try await api.downloadYoutube(videoId: videoId, query: query, suffix: suffix)
            addSong(filename)
            Task { await refreshDownloadsAndRatings() }
            return .success(())
        } catch {
            return .failure(error)
        }
    }

    // --- compartir desde YouTube ---

    func shareVideo(_ videoId: String) {
        pendingShare = videoId
        if room == nil { toast = L("share_join_first") }
    }

    func clearPendingShare() { pendingShare = nil }

    // La UI lo consume y lo limpia tras mostrarlo.
    func clearToast() { toast = nil }

    // Un QR/entrada que no se pudo interpretar, o el lector no disponible: la UI avisa.
    func showToast(_ message: String) { toast = message }

    // El tutorial se abre solo la primera vez que se entra a una sala. Se marca como visto al abrirlo.
    func takeFirstTour() -> Bool {
        if defaults.bool(forKey: Key.tourSeen) { return false }
        defaults.set(true, forKey: Key.tourSeen)
        return true
    }

    // El mensaje del servidor ya viene traducido; si no lo hay, se usa la clave de respaldo.
    func errorText(_ error: Error, fallback: String) -> String {
        if let api = error as? ApiException, let message = api.serverMessage { return message }
        return L(fallback)
    }
}
