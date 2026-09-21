const MINUTE_MS = 60 * 1000;
const DEFAULT_GRACE_MINUTES = 10;

// Interpreta ROOM_GRACE_MINUTES: cuántos minutos se conserva una sala en la que ya no hay nadie
// conectado (por ejemplo, porque el host cerró el reproductor sin querer) antes de borrarla con su
// cola de canciones. Devuelve { graceMs, warning }:
// - Si la variable no está definida, se usan 10 minutos.
// - Con 0 la sala se borra en cuanto se queda vacía (sin tiempo de gracia).
// - Si el valor no es válido, se usa el valor por defecto y se devuelve un aviso.
function parseRoomGrace(value) {
  const defaultGrace = { graceMs: DEFAULT_GRACE_MINUTES * MINUTE_MS, warning: null };
  if (value === undefined || value === null) return defaultGrace;
  const raw = String(value).trim();
  if (raw === "") return defaultGrace;

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return {
      graceMs: defaultGrace.graceMs,
      warning: `ROOM_GRACE_MINUTES="${value}" no es válido (usa un número de minutos, o 0 para borrar la sala en cuanto se quede vacía): se usan ${DEFAULT_GRACE_MINUTES} minutos.`,
    };
  }
  return { graceMs: minutes * MINUTE_MS, warning: null };
}

const DEFAULT_SINGER_GRACE_SECONDS = 120;

// Interpreta SINGER_GRACE_SECONDS: cuántos segundos se le da a quien canta para volver antes de que los
// demás puedan pausar o saltar su canción (por ejemplo, porque el celular se suspendió y perdió la
// conexión). Devuelve { graceMs, warning }, con las mismas reglas que parseRoomGrace:
// - Si la variable no está definida, se usan 120 segundos.
// - Con 0 no hay tiempo de gracia: quien canta deja de contar en cuanto se desconecta.
// - Si el valor no es válido, se usa el valor por defecto y se devuelve un aviso.
function parseSingerGrace(value) {
  const defaultGrace = { graceMs: DEFAULT_SINGER_GRACE_SECONDS * 1000, warning: null };
  if (value === undefined || value === null) return defaultGrace;
  const raw = String(value).trim();
  if (raw === "") return defaultGrace;

  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return {
      graceMs: defaultGrace.graceMs,
      warning: `SINGER_GRACE_SECONDS="${value}" no es válido (usa un número de segundos, o 0 para no dar tiempo de gracia): se usan ${DEFAULT_SINGER_GRACE_SECONDS} segundos.`,
    };
  }
  return { graceMs: seconds * 1000, warning: null };
}

// Cada cuánto revisar si hay salas vencidas: una cuarta parte del tiempo de gracia, entre 5 y 60 segundos.
function roomSweepIntervalMs(graceMs) {
  return Math.min(MINUTE_MS, Math.max(5000, graceMs / 4));
}

// Una sala vence cuando lleva más que el tiempo de gracia sin ninguna conexión. `emptySince` es el
// momento en que se quedó vacía (o se creó sin que nadie llegara a conectarse), y null mientras haya
// alguien conectado.
function isRoomExpired(room, now, graceMs) {
  return room.emptySince !== null && now - room.emptySince >= graceMs;
}

module.exports = {
  DEFAULT_GRACE_MINUTES,
  DEFAULT_SINGER_GRACE_SECONDS,
  parseRoomGrace,
  parseSingerGrace,
  roomSweepIntervalMs,
  isRoomExpired,
};
