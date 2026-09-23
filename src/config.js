// Toda la configuración que sale del entorno, leída y validada en un solo sitio.
//
// Antes esto eran ~90 líneas al principio de server.js, mezcladas con el arranque. Tenerlo
// aparte permite ver de un vistazo qué se puede configurar, y que el resto de los módulos
// reciban un objeto ya validado en vez de leer process.env por su cuenta.
//
// Los parsers de cada variable viven en lib/ y están probados uno por uno; aquí solo se
// invocan, se avisa de lo que no era válido y se crean las carpetas de datos.
const fs = require("fs");
const path = require("path");

const { parseDownloadTtl } = require("../lib/downloadPolicy");
const { parseRoomGrace, parseSingerGrace } = require("../lib/roomPolicy");
const { parseSearchResultLimit } = require("../lib/ytdlp");
const { parseQueueLimit, parsePerPersonLimit } = require("../lib/queueLimits");
const { checkSessionSecret } = require("../lib/config");

// Ruta por defecto según el entorno: en producción los datos viven en /data, que es lo que se
// monta como volumen persistente; en desarrollo, junto al proyecto.
const rutaSegunEntorno = (env, enProduccion, enDesarrollo) =>
  env.NODE_ENV === "production" ? enProduccion : enDesarrollo;

// Lee el entorno y devuelve la configuración. `env` se inyecta para poder probarlo.
// `onWarning` recibe cada aviso; `onFatal` se llama con un error que impide arrancar.
function loadConfig({
  env = process.env,
  onWarning = (mensaje) => console.warn(`⚠️  ${mensaje}`),
  onFatal = (mensaje) => {
    console.error(`❌ ${mensaje}`);
    process.exit(1);
  },
} = {}) {
  const isProduction = env.NODE_ENV === "production";

  // express-session no lanza si falta el secreto: arrancaría entero y después respondería 500
  // en todas las peticiones. Se comprueba antes para fallar con un mensaje claro y no a medias.
  const secreto = checkSessionSecret(env.SESSION_SECRET, { production: isProduction });
  if (secreto.error) return onFatal(secreto.error);
  if (secreto.warning) onWarning(secreto.warning);

  // Bypass de Google OAuth solo para desarrollo local: nunca se activa en producción aunque la
  // variable quede seteada por accidente en un .env.
  const authDisabled = !isProduction && env.DISABLE_GOOGLE_AUTH === "true";
  if (authDisabled) {
    onWarning("DISABLE_GOOGLE_AUTH=true: autenticación de Google desactivada (solo dev local).");
  }

  const avisar = ({ warning }) => {
    if (warning) onWarning(warning);
  };

  const ttl = parseDownloadTtl(env.DOWNLOAD_TTL_HOURS);
  const roomGrace = parseRoomGrace(env.ROOM_GRACE_MINUTES);
  const singerGrace = parseSingerGrace(env.SINGER_GRACE_SECONDS);
  const queueLimit = parseQueueLimit(env.MAX_QUEUE_LENGTH);
  const perPerson = parsePerPersonLimit(env.MAX_SONGS_PER_PERSON);
  const searchResults = parseSearchResultLimit(env.SEARCH_RESULTS);
  [ttl, roomGrace, singerGrace, queueLimit, perPerson, searchResults].forEach(avisar);

  const config = {
    isProduction,
    port: env.PORT || 8081,
    sessionSecret: env.SESSION_SECRET,
    allowedDomain: env.ALLOWED_DOMAIN || "xalcker.xyz",
    authDisabled,
    // Sin login: nombre de las conexiones que llegan sin uno elegido. Si no se fija, depende del idioma de quien pide.
    devUserName: env.DEV_USER_NAME,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    lanIp: env.LAN_IP,

    dbPath: env.DB_PATH || rutaSegunEntorno(env, "/data/karaoke.db", "./karaoke.db"),
    sessionsPath: env.SESSIONS_PATH || rutaSegunEntorno(env, "/data/sessions", "./sessions"),
    downloadsPath: env.DOWNLOADS_PATH || rutaSegunEntorno(env, "/data/downloads", "./downloads"),
    // Segunda base, propia de las descargas de YouTube (karaoke.db no se toca).
    downloadsDbPath: env.DOWNLOADS_DB_PATH || rutaSegunEntorno(env, "/data/downloads.db", "./downloads.db"),
    // Tercera base, con las calificaciones. Aparte de downloads.db porque las descargas se
    // borran solas con el tiempo y las calificaciones deben quedar.
    ratingsDbPath: env.RATINGS_DB_PATH || rutaSegunEntorno(env, "/data/ratings.db", "./ratings.db"),

    downloadTtlMs: ttl.ttlMs,
    roomGraceMs: roomGrace.graceMs,
    singerGraceMs: singerGrace.graceMs,
    maxQueueLength: queueLimit.limit,
    maxSongsPerPerson: perPerson.limit,
    searchResultLimit: searchResults.limit,
    // Se pide el doble a YouTube para que, al subir los de los canales ya conocidos, entren
    // también los que YouTube dejó más abajo.
    searchFetchLimit: searchResults.limit * 2,
  };

  return config;
}

// Crea las carpetas de datos. Aparte de loadConfig para que leer la configuración no tenga
// efectos en el disco y se pueda probar sin ensuciar nada.
function ensureDataDirs(config) {
  fs.mkdirSync(config.downloadsPath, { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(config.downloadsDbPath)), { recursive: true });
  fs.mkdirSync(path.dirname(path.resolve(config.ratingsDbPath)), { recursive: true });
}

module.exports = { loadConfig, ensureDataDirs };
