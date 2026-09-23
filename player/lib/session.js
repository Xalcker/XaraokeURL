// La sesión de la pantalla: consigue la sala, se conecta al WebSocket como host y reconecta cuando
// hace falta. Todo lo de afuera (servidor, reproductor, WebSocket) entra por parámetro, así las
// pruebas la corren contra un servidor de verdad con un reproductor de mentira.
const { createHostLogic } = require("./hostLogic");
const { obtainRoom } = require("./room");

const OPEN = 1;
const ROOM_GONE = 4004; // la sala ya no existe (venció o el servidor se reinició)
const REPLACED = 4006; // otra pantalla recuperó la sala con el mismo token

//   api, store: ver room.js
//   WebSocketImpl: el WebSocket de Node (o el paquete ws), con la API del navegador
//   player: ver hostLogic.js
//   onScreenChange(): hay que volver a dibujar la pantalla (ver `state` y `logic`)
function createSession({
  api,
  store,
  WebSocketImpl,
  player,
  onScreenChange = () => {},
  log = console,
  retryMs = 5000,
  reconnectMs = 3000,
}) {
  // status: "connecting" (sin sala todavía), "room" o "replaced" (otra pantalla tomó la sala).
  const state = { status: "connecting", roomId: null, remoteUrl: null, qrDataUrl: null };
  let room = null;
  let ws = null;
  let stopped = false;
  let timer = null;

  const later = (fn, ms) => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };

  const send = (message) => {
    if (ws?.readyState === OPEN) ws.send(JSON.stringify(message));
  };

  const logic = createHostLogic({
    player,
    send,
    resolveSongUrl: (song) => api.songUrl(song),
    onChange: onScreenChange,
    log,
  });

  async function loadQr() {
    const roomId = room.roomId;
    try {
      const data = await api.qr(roomId);
      if (room?.roomId !== roomId) return;
      state.qrDataUrl = data.qrUrl;
      state.remoteUrl = data.remoteUrl;
    } catch (error) {
      log.warn("No se pudo obtener el QR:", error.message);
      state.qrDataUrl = null;
      state.remoteUrl = new URL("/remote.html", api.serverUrl).href;
    }
    onScreenChange();
  }

  async function joinRoom() {
    if (stopped) return;
    try {
      room = await obtainRoom(api, store);
    } catch (error) {
      log.warn(`Sin conexión con el servidor, reintento en ${retryMs / 1000} s:`, error.message);
      state.status = "connecting";
      onScreenChange();
      later(joinRoom, retryMs);
      return;
    }
    state.status = "room";
    state.roomId = room.roomId;
    state.qrDataUrl = null;
    state.remoteUrl = null;
    log.info?.(`Sala ${room.roomId}`);
    onScreenChange();
    loadQr();
    connect();
  }

  function connect() {
    if (stopped) return;
    const socket = new WebSocketImpl(api.webSocketUrl(room));
    ws = socket;
    socket.onopen = () => logic.onConnected();
    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      logic.handleMessage(message);
    };
    socket.onerror = () => {}; // el cierre de abajo ya cuenta la historia
    socket.onclose = (event) => {
      if (ws !== socket) return;
      ws = null;
      if (stopped) return;
      if (event.code === ROOM_GONE) {
        // Reintentar no serviría de nada: se crea otra sala, como la pantalla del navegador.
        store.forget();
        logic.handleMessage({ type: "queueUpdate", payload: [] });
        state.status = "connecting";
        onScreenChange();
        joinRoom();
        return;
      }
      if (event.code === REPLACED) {
        // Si esta reconectara, las dos pantallas se estarían quitando el control una a la otra.
        player.stop();
        state.status = "replaced";
        onScreenChange();
        return;
      }
      later(connect, reconnectMs);
    };
  }

  return {
    state,
    logic,
    get connected() {
      return ws?.readyState === OPEN;
    },
    start() {
      stopped = false;
      onScreenChange();
      return joinRoom();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
      ws = null;
    },
  };
}

module.exports = { createSession };
