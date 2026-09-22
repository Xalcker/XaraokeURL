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

// Nombres que cuentan como presentes en la sala: los que tienen algún control remoto conectado (`connected`,
// un Set) y los que se fueron hace poco. `leftAt` es un Map nombre -> cuándo se cayó su última conexión.
// A quien se fue se le da `graceMs` para volver, contado desde lo más reciente entre que se fue y
// `headSince` (cuándo empezó a sonar la canción de arriba de la cola): quien bloqueó el celular mientras
// esperaba su turno no pierde su canción en cuanto le toca, sino que tiene ese tiempo desde que empieza.
function presentNames(connected, leftAt, headSince, now, graceMs) {
  const present = new Set(connected);
  for (const [name, left] of leftAt) {
    if (now - Math.max(left, headSince) < graceMs) present.add(name);
  }
  return present;
}

// Devuelve un `leftAt` nuevo sin las entradas que ya no hacen falta: las de quien no tiene ninguna
// canción en la cola. `leftAt` solo se consulta para decidir si quien canta sigue presente (ver
// presentNames), y ahí únicamente importa el dueño de la canción que suena, así que sin nada en la
// cola la entrada no se volverá a mirar nunca.
//
// Ojo: NO sirve purgar por tiempo vencido. El tiempo de gracia se recuenta cuando la canción de esa
// persona llega a sonar (headSince), así que una entrada de hace una hora vuelve a contar como
// presente en cuanto le toca el turno; borrarla le quitaría esa gracia. Mientras tenga algo en la
// cola, su entrada se conserva por vieja que sea. No modifica el Map que recibe.
function pruneLeftAt(leftAt, queue) {
  const owners = new Set((Array.isArray(queue) ? queue : []).map((item) => item.name));
  return new Map([...leftAt].filter(([name]) => owners.has(name)));
}

// ¿Puede esta persona pausar, reanudar o saltar? Solo quien canta la canción que suena (la primera de
// la cola). Si esa persona ya no está presente en la sala (`onlineNames` es el Set de nombres presentes;
// ver presentNames), cualquiera puede: si no, la canción de alguien que se fue no la podría quitar nadie.
function canControlPlayback(queue, userName, onlineNames) {
  const head = Array.isArray(queue) ? queue[0] : undefined;
  if (!head) return false;
  if (typeof userName === "string" && userName !== "" && head.name === userName) return true;
  return !onlineNames.has(head.name);
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

// Cuántos votos hacen falta para saltar la canción que suena sin pasar por quien la canta: pensado
// para cuando esa persona sigue "presente" (no venció su tiempo de gracia) pero en realidad no está
// cantando, y el resto de la sala se queda esperando sin que nadie pueda hacer nada.
const SKIP_VOTE_THRESHOLD = 3;

// Voto para saltar la canción que suena: { id }, con el id de la canción que la persona vio al
// votar (igual que en sanitizeControlAction), o null si no es válido.
function sanitizeVoteSkip(payload) {
  if (!payload || typeof payload !== "object") return null;
  const { id } = payload;
  return isValidId(id) ? { id } : null;
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
  SKIP_VOTE_THRESHOLD,
  isAllowed,
  presentNames,
  pruneLeftAt,
  canControlPlayback,
  sanitizeControlAction,
  sanitizePlaybackState,
  sanitizePlayNext,
  sanitizeMoveSong,
  sanitizeRating,
  sanitizeVoteSkip,
};
