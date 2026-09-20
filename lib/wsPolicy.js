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

module.exports = { HOST_ONLY_TYPES, CONTROL_ACTIONS, isAllowed, sanitizeControlAction, sanitizePlaybackState };
