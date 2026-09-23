// Registro de salas en memoria y su ciclo de vida.
//
// Una sala es efímera: vive mientras alguien esté conectado, más un tiempo de gracia por si el
// host cerró el reproductor sin querer. No se persiste en ninguna base a propósito: el karaoke
// de ayer no le interesa a nadie.
const crypto = require("crypto");

const { generateRoomId } = require("../lib/roomId");
const { roomSweepIntervalMs, isRoomExpired } = require("../lib/roomPolicy");

function createRooms({ config }) {
  const rooms = {};

  function create() {
    const roomId = generateRoomId(rooms);
    const hostToken = crypto.randomUUID();
    rooms[roomId] = {
      songQueue: [],
      pendingRatings: [],
      clients: new Set(),
      hostToken,
      hostWs: null,
      // Quién se desconectó y cuándo (nombre -> momento), y cuándo empezó a sonar la canción de
      // arriba de la cola: con eso se da un tiempo de gracia a quien canta si pierde la
      // conexión (SINGER_GRACE_SECONDS).
      leftAt: new Map(),
      headId: null,
      headSince: 0,
      // Votos para saltar la canción que suena sin pasar por quien la canta: { id, voters }, con
      // el id de esa canción y el Set de nombres que ya votaron. null si nadie ha votado todavía.
      // Se reinicia cada vez que cambia la canción de arriba (ver broadcastQueue).
      skipVotes: null,
      // Sin login: qué sesión tiene cada nombre (ver lib/nameClaims.js).
      nameOwners: new Map(),
      // Desde cuándo no hay nadie conectado (null mientras haya alguien): una sala recién
      // creada empieza vacía. Al pasar el tiempo de gracia así, el barrido la borra.
      emptySince: Date.now(),
    };
    console.log(`Sala creada: ${roomId}`);
    return { roomId, hostToken };
  }

  // Los códigos son siempre mayúsculas; se normaliza aquí para que nadie tenga que acordarse.
  const get = (roomId) => (typeof roomId === "string" ? rooms[roomId.toUpperCase()] : undefined);
  const exists = (roomId) => !!get(roomId);
  const remove = (roomId) => delete rooms[roomId];
  const all = () => Object.entries(rooms);

  // Canciones que están en la cola de alguna sala: no se pueden borrar del disco mientras
  // esperen su turno o suenen (lo usa el barrido de descargas).
  const queuedFilenames = () =>
    new Set(Object.values(rooms).flatMap((room) => room.songQueue.map((item) => item.song)));

  // Borra las salas que llevan más que el tiempo de gracia sin ninguna conexión: las que nunca
  // llegaron a tener un cliente (el host nunca abrió el WebSocket) y las que se quedaron vacías
  // (el host cerró el reproductor y no volvió). Mientras dura la gracia la sala sigue
  // existiendo con su cola, y el host la puede recuperar.
  function startSweep() {
    const timer = setInterval(() => {
      const ahora = Date.now();
      for (const [roomId, room] of all()) {
        if (isRoomExpired(room, ahora, config.roomGraceMs)) {
          remove(roomId);
          console.log(
            `Sala ${roomId} eliminada: nadie se conectó durante ${config.roomGraceMs / 60000} min.`
          );
        }
      }
    }, roomSweepIntervalMs(config.roomGraceMs));
    timer.unref();
    return timer;
  }

  return { rooms, create, get, exists, remove, all, queuedFilenames, startSweep };
}

module.exports = { createRooms };
