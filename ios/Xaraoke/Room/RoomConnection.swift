// La conexión en tiempo real con una sala: el mismo protocolo que public/remote.js, sobre el
// WebSocket de URLSession. Vive fuera de la pantalla (la tiene AppController) para que siga
// conectada con el teléfono bloqueado y pueda avisar cuando te toca.
// Equivalente a android/.../room/RoomConnection.kt

import Foundation

// Avisos sueltos de la sala que la pantalla muestra como un mensaje breve.
enum RoomEvent {
    case addRejected(personalLimit: Bool, limit: Int)
    case hostBack
    case downloadsChanged
}

final class RoomConnection: NSObject {
    private let session: URLSession
    private let webSocketUrl: String
    private let queue = DispatchQueue(label: "xyz.xalcker.xaraoke.room")

    // Callbacks (se invocan en `callbackQueue`, por defecto main).
    private let onState: (RoomState) -> Void
    private let onTurn: (TurnTracker.Alert, RoomState) -> Void
    private let onEvent: (RoomEvent) -> Void
    private let onExit: (RoomExit) -> Void
    private let callbackQueue: DispatchQueue

    private var state: RoomState {
        didSet { let s = state; callbackQueue.async { self.onState(s) } }
    }

    private let turns = TurnTracker()
    private var socket: URLSessionWebSocketTask?
    // Cada socket nuevo tiene su número: los avisos que lleguen tarde de uno viejo se ignoran.
    private var generation = 0
    private var attempt = 0
    private var retryItem: DispatchWorkItem?
    private var skipPendingItem: DispatchWorkItem?
    private var bannerItem: DispatchWorkItem?
    private var closed = false

    init(
        session: URLSession,
        webSocketUrl: String,
        roomCode: String,
        myName: String,
        callbackQueue: DispatchQueue = .main,
        onState: @escaping (RoomState) -> Void,
        onTurn: @escaping (TurnTracker.Alert, RoomState) -> Void,
        onEvent: @escaping (RoomEvent) -> Void,
        onExit: @escaping (RoomExit) -> Void
    ) {
        self.session = session
        self.webSocketUrl = webSocketUrl
        self.state = RoomState(roomCode: roomCode, myName: myName)
        self.callbackQueue = callbackQueue
        self.onState = onState
        self.onTurn = onTurn
        self.onEvent = onEvent
        self.onExit = onExit
        super.init()
    }

    func start() {
        queue.async { self._start() }
    }

    private func _start() {
        if closed { return }
        retryItem?.cancel()
        socket?.cancel()
        generation += 1
        let myGeneration = generation
        state.connection = attempt == 0 ? .connecting : .retrying
        guard let url = URL(string: "\(webSocketUrl)/?sala=\(state.roomCode)") else { return }
        let task = session.webSocketTask(with: url)
        socket = task
        task.resume()
        receive(task, generation: myGeneration)
        // URLSession no avisa "onOpen" salvo por el delegate; se marca abierta al recibir el primer
        // dato o vía delegate (ver URLSessionWebSocketDelegate más abajo). Como respaldo, un sondeo:
        sendPing(task, generation: myGeneration)
    }

    // Reintenta ya, sin esperar el siguiente intento (volvió la red, se abrió la app).
    func reconnectNow() {
        queue.async {
            if self.closed || self.state.connection != .retrying { return }
            self.attempt = 0
            self._start()
        }
    }

    func close() {
        queue.async {
            self.closed = true
            self.retryItem?.cancel()
            self.skipPendingItem?.cancel()
            self.bannerItem?.cancel()
            self.socket?.cancel(with: .goingAway, reason: "Salió de la sala".data(using: .utf8))
            self.socket = nil
        }
    }

    // Devuelve false si no hay conexión en este momento: la pantalla avisa en vez de hacer como
    // que se hizo.
    @discardableResult
    func send(_ type: String, payload: [String: Any] = [:]) -> Bool {
        queue.sync {
            guard state.connection == .open, let socket = socket else { return false }
            let message: [String: Any] = ["type": type, "payload": payload]
            guard let data = try? JSONSerialization.data(withJSONObject: message),
                  let text = String(data: data, encoding: .utf8) else { return false }
            socket.send(.string(text)) { _ in }
            return true
        }
    }

    // --- acciones del remoto ---

    // Se pide la acción explícita según lo que se ve, no "alternar": si dos personas tocan a la
    // vez, las dos piden lo mismo y no se cancelan entre sí.
    @discardableResult
    func playPause() -> Bool {
        send("controlAction", payload: ["action": state.paused ? "play" : "pause"])
    }

    // Se salta esa canción concreta: si mientras se confirmaba ya cambió, no se salta la siguiente.
    @discardableResult
    func skip(_ songId: String) -> Bool {
        let stillHead = queue.sync { state.head?.id == songId }
        if !stillHead { return true }
        if !send("controlAction", payload: ["action": "skip", "id": songId]) { return false }
        queue.async { [weak self] in
            guard let self = self else { return }
            self.state.skipPendingId = songId
            self.skipPendingItem?.cancel()
            let item = DispatchWorkItem { [weak self] in self?.state.skipPendingId = nil }
            self.skipPendingItem = item
            self.queue.asyncAfter(deadline: .now() + 4, execute: item)
        }
        return true
    }

    @discardableResult
    func voteSkip(_ songId: String) -> Bool { send("voteSkip", payload: ["id": songId]) }

    @discardableResult
    func addSong(_ filename: String) -> Bool { send("addSong", payload: ["song": filename]) }

    @discardableResult
    func removeSong(_ songId: String) -> Bool { send("removeSong", payload: ["id": songId]) }

    @discardableResult
    func moveSong(_ songId: String, up: Bool) -> Bool {
        send("moveSong", payload: ["id": songId, "direction": up ? "up" : "down"])
    }

    // value: 1 (bien), -1 (mal) o 0 ("ahora no").
    @discardableResult
    func rate(_ ratingId: String, value: Int) -> Bool {
        if !send("rateSong", payload: ["id": ratingId, "value": value]) { return false }
        queue.async { self.resolveRating(ratingId) }
        return true
    }

    func dismissTurnBanner() {
        queue.async {
            self.bannerItem?.cancel()
            self.state.turnBanner = false
        }
    }

    // "¡Prepárate!": se quita cuando tu canción empieza (ver onQueue) y, por si ese cambio no llega
    // (se cortó la conexión justo después), a los 15 segundos, igual que en el web.
    private func showTurnBanner() {
        state.turnBanner = true
        bannerItem?.cancel()
        let item = DispatchWorkItem { [weak self] in self?.state.turnBanner = false }
        bannerItem = item
        queue.asyncAfter(deadline: .now() + 15, execute: item)
    }

    // --- recepción ---

    private func receive(_ task: URLSessionWebSocketTask, generation myGeneration: Int) {
        task.receive { [weak self] result in
            guard let self = self else { return }
            self.queue.async {
                guard myGeneration == self.generation, !self.closed else { return }
                switch result {
                case .success(let message):
                    // El primer mensaje confirma que está abierta.
                    if self.state.connection != .open { self.onOpen() }
                    switch message {
                    case .string(let text): self.handle(text)
                    case .data(let data): if let text = String(data: data, encoding: .utf8) { self.handle(text) }
                    @unknown default: break
                    }
                    self.receive(task, generation: myGeneration)
                case .failure:
                    // Un cierre del servidor (4001/4004/4009…) llega como fallo de receive; el código
                    // real queda en task.closeCode. 0/-1 = no fue un close frame (se cayó la red): reintentar.
                    let raw = task.closeCode.rawValue
                    self.onSocketGone(myGeneration, code: raw > 0 ? raw : nil)
                }
            }
        }
    }

    private func sendPing(_ task: URLSessionWebSocketTask, generation myGeneration: Int) {
        task.sendPing { [weak self] error in
            guard let self = self else { return }
            self.queue.async {
                guard myGeneration == self.generation, !self.closed else { return }
                if error != nil {
                    self.onSocketGone(myGeneration, code: nil)
                    return
                }
                // El ping funcionó: la conexión está viva. Se marca abierta si aún no.
                if self.state.connection != .open { self.onOpen() }
                // Latido periódico para detectar una conexión muerta (equiv. pingInterval de OkHttp).
                self.queue.asyncAfter(deadline: .now() + 20) {
                    guard myGeneration == self.generation, !self.closed else { return }
                    self.sendPing(task, generation: myGeneration)
                }
            }
        }
    }

    private func onOpen() {
        attempt = 0
        turns.onConnected()
        state.connection = .open
    }

    // --- mensajes del servidor ---

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return }
        let payload = message["payload"] as? [String: Any]
        switch message["type"] as? String {
        case "queueUpdate":
            onQueue((message["payload"] as? [Any]) ?? [])
        case "timeUpdate":
            onTime(payload)
        case "hostStatus":
            let connected = (payload?["connected"] as? Bool) ?? true
            let returned = connected && !state.hostConnected
            state.hostConnected = connected
            if returned { emit(.hostBack) }
        case "addSongRejected":
            emit(.addRejected(
                personalLimit: (payload?["reason"] as? String) == "personalLimit",
                limit: payload?["limit"] as? Int ?? 0
            ))
        case "downloadsChanged":
            emit(.downloadsChanged)
        case "playbackState":
            state.paused = (payload?["paused"] as? Bool) == true
        case "controlAccess":
            state.controlAllowed = (payload?["allowed"] as? Bool) == true
        case "skipVotes":
            let id = (payload?["id"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            state.skipVotes = SkipVotes(
                songId: id,
                count: payload?["count"] as? Int ?? 0,
                threshold: payload?["threshold"] as? Int ?? state.skipVotes.threshold,
                voted: (payload?["voted"] as? Bool) == true
            )
        case "ratingRequest":
            let id = payload?["id"] as? String ?? ""
            let song = payload?["song"] as? String ?? ""
            if id.isEmpty || song.isEmpty { return }
            let title = (payload?["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            // El servidor la reenvía al reconectar.
            if !state.ratingRequests.contains(where: { $0.id == id }) {
                state.ratingRequests.append(RatingRequest(id: id, song: song, title: title))
            }
        case "ratingResolved":
            if let id = payload?["id"] as? String { resolveRating(id) }
        default:
            break
        }
    }

    private func onQueue(_ array: [Any]) {
        let queueItems: [QueueItem] = array.compactMap { any in
            guard let item = any as? [String: Any] else { return nil }
            let title = (item["title"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            return QueueItem(
                id: item["id"] as? String ?? "",
                song: item["song"] as? String ?? "",
                name: item["name"] as? String ?? "",
                title: title
            )
        }
        let nextIsMine: Bool = {
            guard queueItems.count > 1, !state.myName.isEmpty else { return false }
            return queueItems[1].name == state.myName
        }()
        state.queue = queueItems
        if queueItems.isEmpty { state.nowPlaying = nil }
        // Si arriba ya no está la canción cuyo salto se pidió, el salto ya ocurrió.
        if let pending = state.skipPendingId, queueItems.first?.id != pending {
            state.skipPendingId = nil
        }
        state.turnBanner = state.turnBanner && nextIsMine

        // Tu canción empezó sin el aviso previo: suena y vibra, pero sin "¡Prepárate!" en pantalla.
        if let alert = turns.onQueue(queueItems, me: state.myName) {
            let snapshot = state
            callbackQueue.async { self.onTurn(alert, snapshot) }
        }
    }

    private func onTime(_ payload: [String: Any]?) {
        let song = payload?["song"] as? String ?? ""
        if payload == nil || song.isEmpty {
            state.nowPlaying = nil
            return
        }
        let np = NowPlaying(
            song: song,
            title: (payload?["title"] as? String).flatMap { $0.isEmpty ? nil : $0 },
            currentTime: (payload?["currentTime"] as? Double) ?? 0,
            duration: (payload?["duration"] as? Double) ?? 0
        )
        state.nowPlaying = np
        if np.duration <= 0 { return }
        if let alert = turns.onTime(remainingSeconds: np.duration - np.currentTime, queue: state.queue, me: state.myName) {
            showTurnBanner()
            let snapshot = state
            callbackQueue.async { self.onTurn(alert, snapshot) }
        }
    }

    private func resolveRating(_ id: String) {
        state.ratingRequests.removeAll { $0.id == id }
    }

    private func emit(_ event: RoomEvent) {
        callbackQueue.async { self.onEvent(event) }
    }

    // --- cierre y reconexión ---

    private func onSocketGone(_ myGeneration: Int, code: Int?) {
        if closed || myGeneration != generation { return }
        socket = nil
        let action = code == nil ? CloseAction.retry : closeAction(code!)
        if action == .retry {
            state.connection = .retrying
            let wait = nextRetryDelayMs(attempt)
            attempt += 1
            let item = DispatchWorkItem { [weak self] in self?._start() }
            retryItem = item
            queue.asyncAfter(deadline: .now() + .milliseconds(Int(wait)), execute: item)
            return
        }
        closed = true
        let exit: RoomExit
        switch action {
        case .roomGone: exit = .roomGone
        case .login: exit = .sessionExpired
        case .nameTaken: exit = .nameTaken
        default: exit = .rejected
        }
        callbackQueue.async { self.onExit(exit) }
    }
}
