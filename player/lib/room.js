// La sala de esta pantalla: se recupera la que quedó guardada (si el servidor la sigue conservando) o
// se crea una nueva. Es lo mismo que hace karaoke.js con ?autostart=1, pero guardando la sala en un
// archivo en vez de en localStorage.
const fs = require("node:fs");
const path = require("node:path");

function createRoomStore(filePath) {
  return {
    load() {
      try {
        const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
        if (saved && typeof saved.roomId === "string" && typeof saved.hostToken === "string") return saved;
      } catch {
        /* sin archivo o dañado: es como si no hubiera nada guardado */
      }
      return null;
    },
    save(room) {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, JSON.stringify({ roomId: room.roomId, hostToken: room.hostToken }));
      } catch (error) {
        // La sala funciona igual; solo no se podrá recuperar tras un reinicio.
        console.warn("No se pudo guardar la sala:", error.message);
      }
    },
    forget() {
      fs.rmSync(filePath, { force: true });
    },
  };
}

function createServerApi(serverUrl, { fetchImpl = fetch } = {}) {
  const url = (p) => new URL(p, serverUrl).href;
  const json = async (res) => {
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return res.json();
  };
  return {
    serverUrl,
    createRoom: () => fetchImpl(url("/api/rooms"), { method: "POST" }).then(json),
    // true si la sala sigue existiendo y el token es el suyo; false si ya no. Lanza si no hay red.
    async canResume({ roomId, hostToken }) {
      const res = await fetchImpl(url(`/api/rooms/${encodeURIComponent(roomId)}/resume`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostToken }),
      });
      if (res.status === 404) return false;
      await json(res);
      return true;
    },
    qr: (roomId) => fetchImpl(url(`/api/qr?sala=${encodeURIComponent(roomId)}`)).then(json),
    // Las descargas de YouTube vienen con una ruta relativa (/downloads/...): se completa con el servidor.
    async songUrl(song) {
      const data = await fetchImpl(url(`/api/song-url?song=${encodeURIComponent(song)}`)).then(json);
      return new URL(data.url, serverUrl).href;
    },
    webSocketUrl({ roomId, hostToken }) {
      const ws = new URL(serverUrl);
      ws.protocol = ws.protocol === "https:" ? "wss:" : "ws:";
      ws.pathname = "/";
      ws.search = `?sala=${encodeURIComponent(roomId)}&hostToken=${encodeURIComponent(hostToken)}`;
      return ws.href;
    },
  };
}

// Recupera la sala guardada o crea una. Si no se pudo consultar la guardada (sin red), lanza en vez
// de crear otra: así un corte de red al arrancar no hace perder la cola.
async function obtainRoom(api, store) {
  const saved = store.load();
  if (saved) {
    if (await api.canResume(saved)) return saved;
    store.forget();
  }
  const room = await api.createRoom();
  const fresh = { roomId: room.roomId, hostToken: room.hostToken };
  store.save(fresh);
  return fresh;
}

module.exports = { createRoomStore, createServerApi, obtainRoom };
