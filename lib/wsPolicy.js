// Qué mensajes del WebSocket acepta el servidor y de quién, y cómo se limpian antes de reenviarlos.

// Solo los manda el host (quien creó la sala y tiene su hostToken): controla la cola y dice cómo va la
// reproducción. Un control remoto que los enviara podría saltar canciones sin pasar por la confirmación
// de su pantalla, o mostrar un tiempo y un estado falsos a los demás.
const HOST_ONLY_TYPES = new Set(["playNext", "timeUpdate", "playbackState"]);

function isAllowed(type, isHost) {
  return isHost || !HOST_ONLY_TYPES.has(type);
}

// Órdenes que un control remoto le puede pedir al host. "playPause" (alternar) se conserva por
// compatibilidad; los remotos nuevos piden "play" o "pause" explícitamente, que no dependen de
// quién llegó primero si dos personas pulsan a la vez.
const CONTROL_ACTIONS = new Set(["play", "pause", "playPause", "skip"]);
const MAX_ID_LENGTH = 64;

// Devuelve { action, id? } con solo lo que el host necesita, o null si la orden no es válida.
// `id` (solo en "skip") es el de la canción que la persona vio al confirmar: el host no salta si
// ya cambió, para que no se salte otra distinta por una confirmación tardía o repetida.
function sanitizeControlAction(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { action, id } = payload;
  if (typeof action !== "string" || !CONTROL_ACTIONS.has(action)) return null;
  const clean = { action };
  if (action === "skip" && typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH) {
    clean.id = id;
  }
  return clean;
}

// Estado que el host informa: solo importa si está en pausa.
function sanitizePlaybackState(payload) {
  return { paused: !!payload && typeof payload === "object" && payload.paused === true };
}

const isValidId = (id) => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_LENGTH;

// Cómo terminó la canción que el host da por acabada: `ended` es true solo si llegó al final por sí sola
// (no si se saltó), e `id` es la canción que el host tenía cargada. Solo con las dos cosas el servidor
// pide calificarla; si falta alguna, se pasa a la siguiente sin más, como antes.
function sanitizePlayNext(payload) {
  const ended = !!payload && typeof payload === "object" && payload.ended === true;
  return { ended, id: ended && isValidId(payload.id) ? payload.id : null };
}

// Orden de mover una de mis canciones un lugar: { id, direction: "up" | "down" }, o null si no es válida.
function sanitizeMoveSong(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { id, direction } = payload;
  if (!isValidId(id) || (direction !== "up" && direction !== "down")) return null;
  return { id, direction };
}

// Calificación del karaoke de una canción: 1 (bien), -1 (mal) o 0 (no calificar: se descarta la petición).
// Devuelve { id, value } o null si no es válida.
function sanitizeRating(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { id, value } = payload;
  if (!isValidId(id) || (value !== 1 && value !== -1 && value !== 0)) return null;
  return { id, value };
}

module.exports = {
  HOST_ONLY_TYPES,
  CONTROL_ACTIONS,
  isAllowed,
  sanitizeControlAction,
  sanitizePlaybackState,
  sanitizePlayNext,
  sanitizeMoveSong,
  sanitizeRating,
};
