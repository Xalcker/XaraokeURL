const HOUR_MS = 60 * 60 * 1000;
const DEFAULT_TTL_HOURS = 6;
const MAX_SEARCH_QUERY_LENGTH = 100;

// Valores de DOWNLOAD_TTL_HOURS que significan "no borrar nunca".
const NEVER_VALUES = new Set(["0", "never", "nunca", "forever", "off", "false", "no"]);

// Interpreta DOWNLOAD_TTL_HOURS: cuántas horas vive una descarga de YouTube sin
// usarse antes de borrarse. Devuelve { ttlMs, warning }:
// - ttlMs es null cuando las descargas no se borran nunca.
// - Si la variable no está definida, se usa el valor por defecto (6 horas).
// - Si el valor no es válido, se usa el valor por defecto y se devuelve un aviso.
function parseDownloadTtl(value) {
  const defaultTtl = { ttlMs: DEFAULT_TTL_HOURS * HOUR_MS, warning: null };
  if (value === undefined || value === null) return defaultTtl;
  const raw = String(value).trim().toLowerCase();
  if (raw === "") return defaultTtl;
  if (NEVER_VALUES.has(raw)) return { ttlMs: null, warning: null };

  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours < 0) {
    return {
      ttlMs: defaultTtl.ttlMs,
      warning: `DOWNLOAD_TTL_HOURS="${value}" no es válido (usa un número de horas, o 0/never para no borrar nunca): se usan ${DEFAULT_TTL_HOURS} horas.`,
    };
  }
  if (hours === 0) return { ttlMs: null, warning: null };
  return { ttlMs: hours * HOUR_MS, warning: null };
}

// Cada cuánto revisar si hay descargas vencidas: una cuarta parte de la vida
// útil, entre 5 segundos y 30 minutos.
function sweepIntervalMs(ttlMs) {
  return Math.min(30 * 60 * 1000, Math.max(5000, ttlMs / 4));
}

// Limpia la búsqueda original que se guarda junto a una descarga: solo texto,
// espacios colapsados y con el mismo tope de largo que la búsqueda en YouTube.
function sanitizeSearchQuery(value) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  const query = Array.from(cleaned).slice(0, MAX_SEARCH_QUERY_LENGTH).join("").trim();
  return query || null;
}

module.exports = {
  DEFAULT_TTL_HOURS,
  parseDownloadTtl,
  sweepIntervalMs,
  sanitizeSearchQuery,
};
