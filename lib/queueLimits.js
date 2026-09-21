// Topes de la cola de una sala.
//
// Sin esto, enqueueSong hacía push sin comprobar nada: un control remoto —con un bug o a
// propósito— podía encolar miles de canciones en un bucle, y cada una difundía la cola entera a
// todos los clientes de la sala, así que el coste crecía de forma cuadrática.
//
// El tope por persona no es solo protección: es una regla de karaoke sensata, para que nadie
// acapare la cola.

const DEFAULT_MAX_QUEUE = 100;
const DEFAULT_MAX_PER_PERSON = 5;

// Valores que significan "sin tope".
const SIN_TOPE = new Set(["0", "off", "no", "false", "ninguno", "sin limite", "sin límite"]);

// Interpreta una variable de entorno con un tope. Devuelve { limit, warning }, con limit null
// cuando no hay tope. Misma forma que los demás parsers de .env (parseRoomGrace, etc.).
function parseLimit(value, { name, byDefault }) {
  const porDefecto = { limit: byDefault, warning: null };
  if (value === undefined || value === null) return porDefecto;
  const raw = String(value).trim().toLowerCase();
  if (raw === "") return porDefecto;
  if (SIN_TOPE.has(raw)) return { limit: null, warning: null };

  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return {
      limit: byDefault,
      warning: `${name}="${value}" no es válido (usa un entero, o 0 para no poner tope): se usa ${byDefault}.`,
    };
  }
  return { limit: n === 0 ? null : n, warning: null };
}

const parseQueueLimit = (value) =>
  parseLimit(value, { name: "MAX_QUEUE_LENGTH", byDefault: DEFAULT_MAX_QUEUE });

const parsePerPersonLimit = (value) =>
  parseLimit(value, { name: "MAX_SONGS_PER_PERSON", byDefault: DEFAULT_MAX_PER_PERSON });

// Cuántas canciones de esa persona están EN ESPERA: las suyas que no son la que suena. La de la
// posición 0 no cuenta, igual que en moveOwnSong, que tampoco la considera reordenable.
function waitingCountFor(queue, name) {
  if (!Array.isArray(queue) || typeof name !== "string" || !name) return 0;
  return queue.filter((item, index) => index > 0 && item.name === name).length;
}

// ¿Cabe otra canción de esta persona? Devuelve { ok: true } o { ok: false, reason, limit }, con
// reason "queueFull" (la sala está llena) o "personalLimit" (ya tiene demasiadas esperando).
function checkCanEnqueue(queue, name, { maxQueue, maxPerPerson } = {}) {
  const cola = Array.isArray(queue) ? queue : [];
  if (maxQueue !== null && maxQueue !== undefined && cola.length >= maxQueue) {
    return { ok: false, reason: "queueFull", limit: maxQueue };
  }
  if (maxPerPerson !== null && maxPerPerson !== undefined && waitingCountFor(cola, name) >= maxPerPerson) {
    return { ok: false, reason: "personalLimit", limit: maxPerPerson };
  }
  return { ok: true };
}

module.exports = {
  DEFAULT_MAX_QUEUE,
  DEFAULT_MAX_PER_PERSON,
  parseQueueLimit,
  parsePerPersonLimit,
  waitingCountFor,
  checkCanEnqueue,
};
