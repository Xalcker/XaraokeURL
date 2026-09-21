require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");
const WebSocket = require("ws");
const QRCode = require("qrcode");
const sqlite3 = require("sqlite3").verbose();
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const FileStore = require("session-file-store")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { generateRoomId, normalizeRoomId } = require("./lib/roomId");
const { getServerAddresses, parseLanIpOverride, formatAccessLines, remoteBaseUrl } = require("./lib/network");
const { sanitizeDisplayName } = require("./lib/displayName");
const { escapeHtml } = require("./public/js/shared");
const { pickLanguage, translate } = require("./public/js/i18n");
const {
  YOUTUBE_ID_RE,
  checkYtdlpAvailable,
  normalizeSearchSuffix,
  parseSearchResultLimit,
  rankByKnownChannels,
  searchYoutube,
  getVideoInfo,
  downloadYoutubeVideo,
} = require("./lib/ytdlp");
const { openDownloadsStore } = require("./lib/downloadsStore");
const { openRatingsStore } = require("./lib/ratingsStore");
const { moveOwnSong } = require("./lib/queuePolicy");
const { hardenSessionStore } = require("./lib/sessionStore");
const { checkSessionSecret } = require("./lib/config");
const {
  isAllowed,
  presentNames,
  pruneLeftAt,
  canControlPlayback,
  sanitizeControlAction,
  sanitizePlaybackState,
  sanitizePlayNext,
  sanitizeMoveSong,
  sanitizeRating,
} = require("./lib/wsPolicy");
const {
  parseDownloadTtl,
  sweepIntervalMs,
  sanitizeSearchQuery,
} = require("./lib/downloadPolicy");
const {
  parseRoomGrace,
  parseSingerGrace,
  roomSweepIntervalMs,
  isRoomExpired,
} = require("./lib/roomPolicy");

const app = express();

// CSP se deja desactivado: la config por defecto de helmet rompería los
// scripts inline existentes en public/index.html. El resto de headers
// (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.) sí aplican.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "10kb" }));

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1); // Trust the first proxy hop (Nginx)
  console.log("Trust Proxy enabled for production environment.");
}

const PORT = process.env.PORT || 8081;
const ALLOWED_DOMAIN = process.env.ALLOWED_DOMAIN || "xalcker.xyz";
// Bypass de Google OAuth solo para desarrollo local: nunca se activa en
// producción aunque la variable quede seteada por accidente en un .env.
const AUTH_DISABLED =
  process.env.NODE_ENV !== "production" &&
  process.env.DISABLE_GOOGLE_AUTH === "true";
// Nombre sugerido en modo desarrollo. Si no se fija en .env, depende del idioma
// del navegador de quien pide (ver devUserName).
const DEV_USER_NAME = process.env.DEV_USER_NAME;

// Idioma de quien hace la petición (header Accept-Language) y texto traducido:
// los mensajes de error de la API y las pantallas de acceso salen en su idioma.
// Los registros de la consola del servidor siguen en español.
const langOf = (req) => pickLanguage(req.headers["accept-language"]);
const tr = (req, key, params) => translate(langOf(req), key, params);
const devUserName = (req) => DEV_USER_NAME || tr(req, "dev.defaultName");
if (AUTH_DISABLED) {
  console.warn(
    "⚠️  DISABLE_GOOGLE_AUTH=true: autenticación de Google desactivada (solo dev local)."
  );
}
const DB_PATH =
  process.env.DB_PATH ||
  (process.env.NODE_ENV === "production" ? "/data/karaoke.db" : "./karaoke.db");
const SESSIONS_PATH =
  process.env.SESSIONS_PATH ||
  (process.env.NODE_ENV === "production" ? "/data/sessions" : "./sessions");
const DOWNLOADS_PATH =
  process.env.DOWNLOADS_PATH ||
  (process.env.NODE_ENV === "production" ? "/data/downloads" : "./downloads");
fs.mkdirSync(DOWNLOADS_PATH, { recursive: true });
// Segunda base de datos, propia de las descargas de YouTube (karaoke.db no se toca).
const DOWNLOADS_DB_PATH =
  process.env.DOWNLOADS_DB_PATH ||
  (process.env.NODE_ENV === "production" ? "/data/downloads.db" : "./downloads.db");
fs.mkdirSync(path.dirname(path.resolve(DOWNLOADS_DB_PATH)), { recursive: true });
// Tercera base de datos, con las calificaciones del karaoke. Aparte de downloads.db porque las
// descargas se borran solas con el tiempo y las calificaciones deben quedar.
const RATINGS_DB_PATH =
  process.env.RATINGS_DB_PATH ||
  (process.env.NODE_ENV === "production" ? "/data/ratings.db" : "./ratings.db");
fs.mkdirSync(path.dirname(path.resolve(RATINGS_DB_PATH)), { recursive: true });
// Horas que vive una descarga sin usarse (DOWNLOAD_TTL_HOURS); null = no borrar nunca.
const { ttlMs: DOWNLOAD_TTL_MS, warning: downloadTtlWarning } = parseDownloadTtl(
  process.env.DOWNLOAD_TTL_HOURS
);
if (downloadTtlWarning) console.warn(`⚠️  ${downloadTtlWarning}`);
// Minutos que se conserva una sala sin nadie conectado (ROOM_GRACE_MINUTES): si el host cierra el
// reproductor sin querer, puede volver y recuperarla con su cola.
const { graceMs: ROOM_GRACE_MS, warning: roomGraceWarning } = parseRoomGrace(
  process.env.ROOM_GRACE_MINUTES
);
if (roomGraceWarning) console.warn(`⚠️  ${roomGraceWarning}`);
// Segundos que se le da a quien canta para volver (SINGER_GRACE_SECONDS) antes de que los demás puedan
// pausar o saltar su canción: un celular que se suspende pierde la conexión un rato.
const { graceMs: SINGER_GRACE_MS, warning: singerGraceWarning } = parseSingerGrace(
  process.env.SINGER_GRACE_SECONDS
);
if (singerGraceWarning) console.warn(`⚠️  ${singerGraceWarning}`);
// Resultados de YouTube que se muestran (SEARCH_RESULTS, de 5 a 10). Se piden el
// doble a YouTube para que, al subir los de los canales ya conocidos, entren
// también los que YouTube dejó más abajo.
const { limit: SEARCH_RESULT_LIMIT, warning: searchResultsWarning } = parseSearchResultLimit(
  process.env.SEARCH_RESULTS
);
if (searchResultsWarning) console.warn(`⚠️  ${searchResultsWarning}`);
const SEARCH_FETCH_LIMIT = SEARCH_RESULT_LIMIT * 2;

checkYtdlpAvailable().then((available) => {
  if (!available) {
    console.warn(
      "⚠️  yt-dlp no está disponible en el PATH del servidor: la búsqueda/descarga desde YouTube no funcionará hasta que se instale."
    );
  }
});

// Si karaoke.db no existe (todavía no se importó songs.csv), el servidor
// arranca igual en "modo sin biblioteca": el catálogo local queda vacío y
// solo se pueden agregar canciones buscándolas en YouTube. Si el archivo sí
// existe pero no se puede abrir (por ejemplo, sin permisos de lectura), el
// error sigue siendo fatal para no ocultar un problema real.
let db = null;
if (fs.existsSync(DB_PATH)) {
  db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error("Error al conectar con la base de datos:", err.message);
      process.exit(1);
    } else {
      console.log("Conectado a la base de datos de canciones en modo lectura.");
    }
  });
} else {
  console.warn(
    `⚠️  No se encontró la base de datos (${DB_PATH}): la biblioteca local queda vacía y solo se podrán agregar canciones buscándolas en YouTube. Ejecuta "npm run import" para crearla.`
  );
}

let rooms = {};
// Videos descargados de YouTube que siguen en disco: filename -> entrada (con
// url, título, canal, búsqueda original, fechas, etc.). Es una copia en memoria
// de la base downloads.db (que es la que persiste entre reinicios), para
// consultarla de forma síncrona. Nunca se escribe en karaoke.db.
//
// Es un Map y no un objeto a propósito: en un objeto, las claves que se heredan de
// Object.prototype ("__proto__", "constructor", "toString"...) devuelven un valor
// truthy en una consulta directa, así que un nombre de archivo inventado por el
// cliente pasaba por descarga válida y se colaba en la cola. Peor aún, escribir en
// esa "entrada" (ver touchDownload) modificaba el prototipo de todo el proceso. Un
// Map no tiene cadena de prototipos, así que el problema no puede volver a aparecer.
const downloadedVideos = new Map();
let downloadsStore = null;
// null si la base de calificaciones no se pudo abrir: entonces no se pide calificar (ver initRatings).
let ratingsStore = null;
// Descargas en curso por id de video, para que dos personas que piden el mismo
// video a la vez no lo descarguen dos veces.
const inflightDownloads = new Map();

// Renovar una sesión puede fallar en Windows si otro programa (antivirus, sincronizador de la
// nube) tiene abierto su archivo justo entonces. No afecta a nadie: se reintenta en la siguiente
// petición. Se avisa como mucho una vez cada 10 minutos, por si es algo persistente.
let lastSessionWarning = 0;
function warnSessionTouchFailed(err) {
  if (Date.now() - lastSessionWarning < 10 * 60 * 1000) return;
  lastSessionWarning = Date.now();
  console.warn(
    `⚠️  No se pudo renovar una sesión (${err.code || err.message}). Suele ser un antivirus o un sincronizador usando la carpeta ${SESSIONS_PATH}; se reintenta solo.`
  );
}

// express-session no lanza si falta el secreto: arrancaría entero y después respondería 500 en
// todas las peticiones. Se comprueba antes para fallar con un mensaje claro y no a medias.
const { error: sessionSecretError, warning: sessionSecretWarning } = checkSessionSecret(
  process.env.SESSION_SECRET,
  { production: process.env.NODE_ENV === "production" }
);
if (sessionSecretError) {
  console.error(`❌ ${sessionSecretError}`);
  process.exit(1);
}
if (sessionSecretWarning) console.warn(`⚠️  ${sessionSecretWarning}`);

const sessionMiddleware = session({
  store: hardenSessionStore(
    new FileStore({
      path: SESSIONS_PATH,
      ttl: 86400,
      logFn: function () {},
    }),
    { onTouchError: warnSessionTouchFailed }
  ),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  // Add secure cookie setting for production
  cookie: {
    secure: process.env.NODE_ENV === "production", // Set Secure flag in production
    httpOnly: true, // Recommended for security
    maxAge: 24 * 60 * 60 * 1000,
  },
});
app.use(sessionMiddleware);

app.use(passport.initialize());
app.use(passport.session());

if (!AUTH_DISABLED) {
  // Construir la estrategia requiere GOOGLE_CLIENT_ID/SECRET; por eso se
  // omite por completo cuando la auth está desactivada, así no hace falta
  // tener credenciales de Google para levantar el server en local.
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: "/auth/google/callback",
      },
      (accessToken, refreshToken, profile, done) => {
        const userEmail = profile.emails?.[0]?.value;
        if (userEmail && userEmail.endsWith(`@${ALLOWED_DOMAIN}`)) {
          return done(null, profile);
        } else {
          return done(null, false, { message: "Acceso denegado." });
        }
      }
    )
  );

  app.get(
    "/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
  );

  app.get(
    "/auth/google/callback",
    // keepSessionInfo: al iniciar sesión, passport renueva la sesión y borraría la sala que se
    // guardó antes de ir a Google (ver ensureAuthenticatedRemote).
    passport.authenticate("google", { failureRedirect: "/login-failed", keepSessionInfo: true }),
    (req, res) => {
      // Quien escaneó el QR sin haber iniciado sesión vuelve al control remoto con su sala ya puesta.
      const roomId = normalizeRoomId(req.session.joinRoomId);
      delete req.session.joinRoomId;
      res.redirect(roomId ? `/remote.html?sala=${roomId}` : "/remote.html");
    }
  );
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

function ensureAuthenticated(req, res, next) {
  if (AUTH_DISABLED || req.isAuthenticated()) return next();
  res.redirect("/login");
}

// Igual que ensureAuthenticated, pero para /remote.html: si el enlace del QR trae la sala y falta
// iniciar sesión, la sala se guarda en la sesión para no perderla en el recorrido por Google.
function ensureAuthenticatedRemote(req, res, next) {
  if (!AUTH_DISABLED && !req.isAuthenticated()) {
    const roomId = normalizeRoomId(req.query.sala);
    if (roomId) req.session.joinRoomId = roomId;
  }
  ensureAuthenticated(req, res, next);
}

// Página completa (con viewport, título e iconos) para las pantallas de acceso.
// Antes eran un <div> suelto sin <head>, que en un celular se veía diminuto.
// Viven aquí y no en public/ porque dependen de la configuración.
function simplePage(lang, title, contentHtml) {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#171124">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="/img/logo.svg" type="image/svg+xml" sizes="any">
<link rel="icon" href="/img/favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/css/tokens.css">
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 1rem; box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #fff; background: var(--bg-gradient); }
  main { max-width: 360px; text-align: center; }
  img { display: block; margin: 0 auto 1rem; filter: drop-shadow(0 8px 24px rgba(var(--accent-rgb), 0.25)); }
  h1 { margin: 0.2rem 0 0.8rem; }
  p { color: #ccc; line-height: 1.4; }
  a.btn { display: inline-block; margin-top: 1rem; padding: 12px 22px; border-radius: 8px; background: #4285F4; color: #fff; font-weight: 600; text-decoration: none; }
</style>
</head>
<body>
<main>
<img src="/img/logo.svg" alt="" width="96" height="96">
${contentHtml}
</main>
</body>
</html>`;
}

app.get("/login", (req, res) => {
  if (AUTH_DISABLED) return res.redirect("/remote.html");
  const lang = langOf(req);
  res.vary("Accept-Language").send(
    simplePage(
      lang,
      "XaraokeURL",
      `<h1>XaraokeURL</h1><p>${escapeHtml(translate(lang, "login.prompt"))}</p><a class="btn" href="/auth/google">${escapeHtml(translate(lang, "login.google"))}</a>`
    )
  );
});

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

app.get("/login-failed", (req, res) => {
  const lang = langOf(req);
  const title = escapeHtml(translate(lang, "login.deniedTitle"));
  res
    .status(403)
    .vary("Accept-Language")
    .send(
      simplePage(
        lang,
        translate(lang, "login.deniedTitle"),
        `<h1>${title}</h1><p>${escapeHtml(translate(lang, "login.deniedBody", { domain: ALLOWED_DOMAIN }))}</p><a class="btn" href="/login">${escapeHtml(translate(lang, "login.retry"))}</a>`
      )
    );
});

app.get("/api/me", ensureAuthenticated, (req, res) => {
  if (AUTH_DISABLED) {
    // Sin login, cada dispositivo elige su nombre (se guarda en su sesión).
    // Hasta que lo elija, `name` es null y DEV_USER_NAME solo se sugiere.
    return res.json({
      devMode: true,
      name: req.session.devName || null,
      suggestedName: devUserName(req),
    });
  }
  res.json({ name: req.user.displayName || tr(req, "user.default") });
});

if (AUTH_DISABLED) {
  // Solo existe en modo desarrollo: en producción esta ruta ni se registra.
  app.post("/api/dev-name", (req, res) => {
    const name = sanitizeDisplayName(req.body?.name);
    if (!name) {
      return res.status(400).json({ error: tr(req, "api.nameRequired") });
    }
    req.session.devName = name;
    res.json({ name });
  });
}

app.get("/api/songs", ensureAuthenticated, (req, res) => {
  if (!db) return res.json({});
  db.all(
    "SELECT artist, filename FROM songs ORDER BY artist, title",
    [],
    (err, rows) => {
      if (err)
        return res
          .status(500)
          .json({ error: tr(req, "api.songsFailed") });
      const structuredSongs = {};
      rows.forEach(({ artist, filename }) => {
        let firstLetter = artist.charAt(0).toUpperCase();
        if (!/\D/.test(firstLetter)) firstLetter = "#";
        if (!structuredSongs[firstLetter]) structuredSongs[firstLetter] = {};
        if (!structuredSongs[firstLetter][artist])
          structuredSongs[firstLetter][artist] = [];
        structuredSongs[firstLetter][artist].push(filename);
      });
      res.json(structuredSongs);
    }
  );
});

app.get("/api/song-url", (req, res) => {
  const { song } = req.query;
  if (!song)
    return res.status(400).json({ error: tr(req, "api.songNameMissing") });
  const download = downloadedVideos.get(song);
  if (download) {
    return res.json({ url: download.url });
  }
  if (!db) return res.status(404).json({ error: tr(req, "api.songNotFound") });
  db.get("SELECT url FROM songs WHERE filename = ?", [song], (err, row) => {
    if (err || !row)
      return res.status(404).json({ error: tr(req, "api.songNotFound") });
    res.json({ url: row.url });
  });
});

const youtubeSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req) => ({ error: tr(req, "api.tooManySearches") }),
});

const youtubeDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req) => ({ error: tr(req, "api.tooManyDownloads") }),
});

const MAX_CONCURRENT_DOWNLOADS = 3;
const MAX_YOUTUBE_DURATION_SECONDS = 10 * 60; // 10 minutos
let activeDownloads = 0;

app.get(
  "/api/youtube/search",
  ensureAuthenticated,
  youtubeSearchLimiter,
  async (req, res) => {
    const query = (req.query.q || "").toString().trim();
    const suffix = (req.query.suffix || "karaoke").toString();
    if (!query) {
      return res.status(400).json({ error: tr(req, "api.queryMissing") });
    }
    if (query.length > 100) {
      return res.status(400).json({ error: tr(req, "api.queryTooLong") });
    }
    try {
      const found = await searchYoutube(query, { limit: SEARCH_FETCH_LIMIT, suffix });
      const downloadedChannels = Array.from(downloadedVideos.values(), (entry) => entry.channel);
      const results = rankByKnownChannels(found, downloadedChannels).slice(0, SEARCH_RESULT_LIMIT);
      res.json({ results });
    } catch (err) {
      console.error("Error buscando en YouTube:", err.message);
      res.status(502).json({ error: tr(req, "api.searchFailed") });
    }
  }
);

// Error con el código HTTP con el que se debe responder al cliente. Lleva la
// clave del mensaje (y sus parámetros), no el texto: se traduce al responder.
class DownloadError extends Error {
  constructor(status, messageKey, params) {
    super(messageKey);
    this.status = status;
    this.messageKey = messageKey;
    this.params = params;
  }
}

function toDownloadEntry(row) {
  return { ...row, url: `/downloads/${row.filename}` };
}

function findDownloadByVideoId(videoId) {
  return [...downloadedVideos.values()].find((entry) => entry.videoId === videoId);
}

// Quién hace la petición, para dejarlo registrado junto a la descarga.
function getRequestUserName(req) {
  if (AUTH_DISABLED) return req.session?.devName || devUserName(req);
  return req.user?.displayName || tr(req, "user.default");
}

// Borra el archivo, el registro en la base y la copia en memoria.
async function removeDownload(filename) {
  downloadedVideos.delete(filename);
  notifyDownloadsChanged();
  try {
    fs.unlinkSync(path.join(DOWNLOADS_PATH, filename));
  } catch (err) {
    if (err.code !== "ENOENT") {
      console.error(`No se pudo borrar la descarga ${filename}:`, err.message);
    }
  }
  await downloadsStore.remove(filename);
}

// Si una descarga falla a medias, yt-dlp deja archivos temporales con el uuid
// (por ejemplo <uuid>.f136.mp4 o <uuid>.mp4.part): se limpian todos.
function removePartialFiles(uuid) {
  for (const file of fs.readdirSync(DOWNLOADS_PATH)) {
    if (!file.startsWith(uuid)) continue;
    try {
      fs.unlinkSync(path.join(DOWNLOADS_PATH, file));
    } catch {
      /* si no se puede borrar ahora, lo recoge el barrido de huérfanos */
    }
  }
}

async function downloadNewVideo({ videoId, searchQuery, searchSuffix, requestedBy }) {
  // Metadatos autoritativos, pedidos a YouTube: la duración para aplicar el
  // tope, y el título y el canal que se guardan (no se confía en el cliente).
  const info = await getVideoInfo(videoId);
  if (info.duration !== null && info.duration > MAX_YOUTUBE_DURATION_SECONDS) {
    throw new DownloadError(400, "api.videoTooLong", { minutes: MAX_YOUTUBE_DURATION_SECONDS / 60 });
  }

  const uuid = crypto.randomUUID();
  const filename = `${uuid}.mp4`;
  const destPath = path.join(DOWNLOADS_PATH, filename);
  try {
    await downloadYoutubeVideo(videoId, destPath);
    const row = {
      uuid,
      filename,
      videoId,
      videoUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: Array.from(info.title || "Video de YouTube").slice(0, 200).join(""),
      channel: info.channel,
      durationSeconds: info.duration === null ? null : Math.round(info.duration),
      searchQuery,
      searchSuffix,
      requestedBy,
      fileSizeBytes: fs.statSync(destPath).size,
      downloadedAt: new Date().toISOString(),
    };
    await downloadsStore.insert(row);
    const entry = toDownloadEntry({ ...row, lastUsedAt: row.downloadedAt, useCount: 0 });
    downloadedVideos.set(filename, entry);
    notifyDownloadsChanged();
    return entry;
  } catch (err) {
    removePartialFiles(uuid);
    throw err;
  }
}

// Devuelve la descarga de ese video, reutilizando el archivo si ya existe (o si
// otra persona lo está descargando en este momento) para no bajarlo dos veces.
async function ensureDownloaded(params) {
  const { videoId } = params;

  const existing = findDownloadByVideoId(videoId);
  if (existing) {
    if (fs.existsSync(path.join(DOWNLOADS_PATH, existing.filename))) {
      return { entry: existing, reused: true };
    }
    await removeDownload(existing.filename); // el archivo desapareció: registro huérfano
  }

  const running = inflightDownloads.get(videoId);
  if (running) return { entry: await running, reused: true };

  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
    throw new DownloadError(429, "api.downloadsBusy");
  }
  activeDownloads++;
  const promise = downloadNewVideo(params).finally(() => {
    activeDownloads--;
    inflightDownloads.delete(videoId);
  });
  inflightDownloads.set(videoId, promise);
  return { entry: await promise, reused: false };
}

app.post(
  "/api/youtube/download",
  ensureAuthenticated,
  youtubeDownloadLimiter,
  async (req, res) => {
    const { videoId, query, suffix } = req.body || {};
    if (typeof videoId !== "string" || !YOUTUBE_ID_RE.test(videoId)) {
      return res.status(400).json({ error: tr(req, "api.invalidVideoId") });
    }
    try {
      const { entry, reused } = await ensureDownloaded({
        videoId,
        searchQuery: sanitizeSearchQuery(query),
        searchSuffix: normalizeSearchSuffix(suffix),
        requestedBy: getRequestUserName(req),
      });
      res.json({ filename: entry.filename, title: entry.title, reused });
    } catch (err) {
      if (err instanceof DownloadError) {
        return res.status(err.status).json({ error: tr(req, err.messageKey, err.params) });
      }
      console.error("Error descargando de YouTube:", err.message);
      res.status(502).json({ error: tr(req, "api.downloadFailed") });
    }
  }
);

// Lista de las descargas que siguen en disco. El control remoto la usa para
// incluirlas en la búsqueda local (por título, canal o búsqueda original).
app.get("/api/downloads", ensureAuthenticated, (req, res) => {
  const list = [...downloadedVideos.values()]
    .sort((a, b) => (a.downloadedAt < b.downloadedAt ? 1 : -1))
    .map((entry) => ({
      filename: entry.filename,
      title: entry.title,
      channel: entry.channel,
      query: entry.searchQuery,
      durationSeconds: entry.durationSeconds,
      downloadedAt: entry.downloadedAt,
    }));
  res.json(list);
});

// Pulgares arriba y abajo acumulados de todas las salas, por nombre de archivo (que es como el
// control remoto identifica cada canción): { filename: { up, down } }. Las calificaciones de un
// video de YouTube se guardan por su id, así que solo se listan mientras el video siga descargado.
app.get("/api/ratings", ensureAuthenticated, async (req, res) => {
  if (!ratingsStore) return res.json({});
  try {
    const byFilename = {};
    for (const [songKey, totals] of Object.entries(await ratingsStore.totals())) {
      const [kind, ...rest] = songKey.split(":");
      const id = rest.join(":");
      const filename = kind === "yt" ? findDownloadByVideoId(id)?.filename : id;
      if (filename) byFilename[filename] = totals;
    }
    res.json(byFilename);
  } catch (err) {
    console.error("No se pudieron leer las calificaciones:", err.message);
    res.status(500).json({ error: tr(req, "api.ratingsFailed") });
  }
});

// Registra un uso (se agregó a una cola): suma al contador y renueva su vida útil.
function touchDownload(filename) {
  const entry = downloadedVideos.get(filename);
  if (!entry) return;
  const now = new Date().toISOString();
  entry.lastUsedAt = now;
  entry.useCount += 1;
  downloadsStore.touch(filename, now).catch((err) => {
    console.error(`No se pudo registrar el uso de ${filename}:`, err.message);
  });
}

// Borra las descargas que llevan DOWNLOAD_TTL_HOURS sin usarse, salvo las que
// están en la cola de alguna sala (se borraría el archivo mientras espera su
// turno o suena). También limpia los archivos huérfanos: con nombre de uuid,
// sin registro y más viejos que la vida útil (restos de descargas fallidas o de
// versiones anteriores, que no guardaban registro y perdían el rastro al reiniciar).
const UUID_PREFIX_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Archivos con nombre de uuid en DOWNLOADS_PATH que no tienen registro.
function findOrphanFiles() {
  const knownUuids = new Set(Array.from(downloadedVideos.values(), (entry) => entry.uuid));
  return fs.readdirSync(DOWNLOADS_PATH).filter((file) => {
    const match = UUID_PREFIX_RE.exec(file);
    return match && !knownUuids.has(match[0].toLowerCase());
  });
}

async function sweepDownloads() {
  const cutoff = new Date(Date.now() - DOWNLOAD_TTL_MS).toISOString();
  const queued = new Set(
    Object.values(rooms).flatMap((room) => room.songQueue.map((item) => item.song))
  );
  for (const row of await downloadsStore.listUnusedSince(cutoff)) {
    if (queued.has(row.filename)) continue;
    await removeDownload(row.filename);
    console.log(`Descarga "${row.title}" (${row.filename}) eliminada: ${row.lastUsedAt} fue su último uso.`);
  }

  const orphanMinAgeMs = Math.max(60 * 60 * 1000, DOWNLOAD_TTL_MS);
  for (const file of findOrphanFiles()) {
    const filePath = path.join(DOWNLOADS_PATH, file);
    try {
      if (Date.now() - fs.statSync(filePath).mtimeMs < orphanMinAgeMs) continue;
      fs.unlinkSync(filePath);
      console.log(`Archivo huérfano ${file} eliminado (sin registro).`);
    } catch {
      /* ya no existe o no se puede borrar: se reintenta en el próximo barrido */
    }
  }
}

// Abre la base de descargas y recupera lo que quedó registrado antes del último
// apagado: lo que sigue en disco vuelve a estar disponible, y se limpian los
// registros cuyo archivo ya no existe.
async function initDownloads() {
  downloadsStore = await openDownloadsStore(DOWNLOADS_DB_PATH);
  let restored = 0;
  for (const row of await downloadsStore.list()) {
    if (fs.existsSync(path.join(DOWNLOADS_PATH, row.filename))) {
      downloadedVideos.set(row.filename, toDownloadEntry(row));
      restored++;
    } else {
      await downloadsStore.remove(row.filename);
    }
  }
  console.log(
    `Descargas de YouTube: ${restored} registrada(s) en ${DOWNLOADS_DB_PATH}. ` +
      (DOWNLOAD_TTL_MS === null
        ? "No se borran nunca (DOWNLOAD_TTL_HOURS lo desactiva)."
        : `Se borran tras ${DOWNLOAD_TTL_MS / 3600000} h sin usarse.`)
  );

  if (DOWNLOAD_TTL_MS !== null) {
    // Las descargas de versiones anteriores no tienen registro (esa versión lo
    // perdía al reiniciar): se avisa antes de que el barrido las borre.
    const orphans = findOrphanFiles();
    if (orphans.length > 0) {
      console.warn(
        `⚠️  Hay ${orphans.length} archivo(s) sin registro en ${DOWNLOADS_PATH} (descargas de una versión anterior o fallidas). ` +
          `Se borrarán cuando lleven más de ${Math.max(1, DOWNLOAD_TTL_MS / 3600000)} h sin modificarse. ` +
          "Para conservarlos, usa DOWNLOAD_TTL_HOURS=0 (así no se borra nada)."
      );
    }
    const runSweep = () =>
      sweepDownloads().catch((err) =>
        console.error("Error al limpiar las descargas:", err.message)
      );
    runSweep();
    setInterval(runSweep, sweepIntervalMs(DOWNLOAD_TTL_MS)).unref();
  }
}

// Sin este límite, cualquiera podía crear salas sin autenticarse y sin
// límite alguno; combinado con la limpieza de abajo, una sala que nunca
// recibe conexiones se quedaba en memoria para siempre (fuga de memoria/DoS).
const createRoomLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req) => ({ error: tr(req, "api.tooManyRooms") }),
});

app.post("/api/rooms", createRoomLimiter, (req, res) => {
  const roomId = generateRoomId(rooms);
  const hostToken = crypto.randomUUID();
  rooms[roomId] = {
    songQueue: [],
    pendingRatings: [],
    clients: new Set(),
    hostToken,
    hostWs: null,
    // Quién se desconectó y cuándo (nombre -> momento), y cuándo empezó a sonar la canción de arriba de
    // la cola: con eso se da un tiempo de gracia a quien canta si pierde la conexión (SINGER_GRACE_SECONDS).
    leftAt: new Map(),
    headId: null,
    headSince: 0,
    // Desde cuándo no hay nadie conectado (null mientras haya alguien): una sala recién creada
    // empieza vacía. Al pasar ROOM_GRACE_MS así, el barrido la borra.
    emptySince: Date.now(),
  };
  console.log(`Sala creada: ${roomId}`);
  res.json({ roomId, hostToken });
});

// Borra las salas que llevan más que el tiempo de gracia sin ninguna conexión: las que nunca
// llegaron a tener un cliente (el host nunca abrió el WebSocket) y las que se quedaron vacías
// (el host cerró el reproductor y no volvió). Mientras dura la gracia la sala sigue existiendo
// con su cola, y el host la puede recuperar (ver /api/rooms/:roomId/resume).
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of Object.entries(rooms)) {
    if (isRoomExpired(room, now, ROOM_GRACE_MS)) {
      delete rooms[roomId];
      console.log(`Sala ${roomId} eliminada: nadie se conectó durante ${ROOM_GRACE_MS / 60000} min.`);
    }
  }
}, roomSweepIntervalMs(ROOM_GRACE_MS)).unref();

app.get("/api/rooms/:roomId", (req, res) => {
  res.json({ exists: !!rooms[req.params.roomId.toUpperCase()] });
});

// El host que cerró el reproductor vuelve con el hostToken que se guardó en su navegador: si la sala
// sigue existiendo (no venció su tiempo de gracia) y el token es el suyo, puede retomarla.
app.post("/api/rooms/:roomId/resume", (req, res) => {
  const room = rooms[req.params.roomId.toUpperCase()];
  const hostToken = req.body?.hostToken;
  if (!room || typeof hostToken !== "string" || hostToken !== room.hostToken) {
    return res.status(404).json({ error: tr(req, "api.roomGone") });
  }
  res.json({ queueLength: room.songQueue.length });
});

app.get("/api/qr", (req, res) => {
  // Rely on 'trust proxy' to correctly detect the protocol
  const protocol = req.secure ? "https" : "http";
  // Si la pantalla principal se abrió como "localhost" (fuera de producción), el QR usa la
  // dirección de la red local para que los teléfonos puedan abrirlo.
  const baseUrl = remoteBaseUrl({
    protocol,
    host: req.get("host"),
    addresses: process.env.NODE_ENV === "production" ? [] : getServerAddresses(process.env.LAN_IP),
  });
  const remoteUrl = `${baseUrl}/remote.html`;
  // Con la sala en el enlace, el teléfono entra directo: no tiene que escribir el código.
  const roomId = normalizeRoomId(req.query.sala);
  const joinUrl = roomId ? `${remoteUrl}?sala=${roomId}` : remoteUrl;

  QRCode.toDataURL(joinUrl, (err, url) => {
    if (err) {
      console.error("Error generando QR:", err);
      res.status(500).send("Error generando QR");
    } else {
      // remoteUrl es la dirección corta que se escribe bajo el QR; joinUrl es lo que el QR contiene.
      res.send({ qrUrl: url, remoteUrl, joinUrl });
    }
  });
});

// Algunos clientes piden /favicon.ico sin leer los <link>: se les sirve el PNG.
app.get("/favicon.ico", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "img", "favicon-32.png"))
);
app.use("/remote.html", ensureAuthenticatedRemote);
app.use(express.static(path.join(__dirname, "public")));
// Sin auth a propósito: el host (pantalla principal) reproduce estos
// archivos sin sesión de Google, igual que ya pasa con las URLs externas
// del catálogo. La protección real es que el nombre es un UUID v4 al que
// solo se llega habiendo pasado por /api/youtube/download (autenticado).
app.use("/downloads", express.static(DOWNLOADS_PATH));

const server = http.createServer(app);
// maxPayload: todo lo que manda un cliente es JSON pequeño (un nombre de archivo, una orden de
// reproducción, una calificación). El tope por defecto de ws son 100 MB por mensaje.
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });

// Latido: una desconexión sucia (el celular se sale del alcance del WiFi, se queda sin batería,
// se corta la red) no manda ningún "close", así que la conexión se quedaría viva para siempre. Y
// con ella se quedaría trabada media sala: quien canta seguiría contando como presente y nadie
// podría saltar su canción por mucho que venciera SINGER_GRACE_SECONDS, y la sala nunca llegaría
// a tener cero clientes, así que el barrido no la borraría nunca (fuga de memoria).
const HEARTBEAT_MS = 30 * 1000;
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    // No contestó al ping anterior: se da por muerta. terminate() dispara su "close", que es
    // donde ya está toda la lógica de salir de la sala; no hace falta duplicarla aquí.
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_MS);
heartbeat.unref();
wss.on("close", () => clearInterval(heartbeat));

function broadcastToRoom(roomId, data) {
  const room = rooms[roomId];
  if (room) {
    room.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
}

// Nombres de las personas con algún control remoto conectado a la sala en este momento.
function connectedNames(room) {
  const names = new Set();
  room.clients.forEach((client) => {
    if (!client.isHost && client.userName && client.readyState === WebSocket.OPEN) names.add(client.userName);
  });
  return names;
}

// Las personas que cuentan como presentes ahora: las conectadas y las que se fueron hace menos que el
// tiempo de gracia (ver presentNames).
function roomPresentNames(room) {
  return presentNames(connectedNames(room), room.leftAt, room.headSince, Date.now(), SINGER_GRACE_MS);
}

// Vuelve a avisar quién puede controlar cuando termine un tiempo de gracia: pasar el tiempo no dispara
// ningún otro evento, y sin esto los botones de los demás seguirían deshabilitados aunque ya se pueda.
function scheduleAccessRecheck(roomId, room) {
  if (SINGER_GRACE_MS === 0) return;
  setTimeout(() => {
    if (rooms[roomId] === room) sendControlAccess(room);
  }, SINGER_GRACE_MS + 100).unref();
}

// Le dice a cada control remoto si puede pausar, reanudar y saltar la canción que suena (ver
// canControlPlayback): así deshabilita sus botones en lugar de dejarlos hacer algo que el servidor
// rechazaría. Hay que llamarla cada vez que cambia la cola o quién está presente.
function sendControlAccess(room) {
  const online = roomPresentNames(room);
  room.clients.forEach((client) => {
    if (client.isHost || client.readyState !== WebSocket.OPEN) return;
    const allowed = canControlPlayback(room.songQueue, client.userName, online);
    client.send(JSON.stringify({ type: "controlAccess", payload: { allowed } }));
  });
}

// Difunde la cola a todos los de la sala, junto con quién puede controlar la reproducción ahora.
function broadcastQueue(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  // Cuando cambia la canción que suena, su dueño empieza a contar desde ahora (ver presentNames).
  const headId = room.songQueue[0]?.id ?? null;
  if (headId !== room.headId) {
    room.headId = headId;
    room.headSince = Date.now();
    scheduleAccessRecheck(roomId, room);
  }
  // Quien ya no tiene nada en la cola no necesita que se recuerde cuándo se fue (ver pruneLeftAt):
  // sin esto, leftAt acumula un nombre por cada persona que pasó por la sala y nunca se vacía.
  room.leftAt = pruneLeftAt(room.leftAt, room.songQueue);
  broadcastToRoom(roomId, JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));
  sendControlAccess(room);
}

// Avisa a los controles remotos de todas las salas (no al host, que no usa la lista) de que
// cambió la lista de descargas: ellos la vuelven a pedir. Varios cambios seguidos (por ejemplo,
// el barrido que borra varias descargas) se juntan en un solo aviso.
let downloadsChangedTimer = null;
function notifyDownloadsChanged() {
  if (downloadsChangedTimer) return;
  downloadsChangedTimer = setTimeout(() => {
    downloadsChangedTimer = null;
    const message = JSON.stringify({ type: "downloadsChanged" });
    for (const room of Object.values(rooms)) {
      room.clients.forEach((client) => {
        if (!client.isHost && client.readyState === WebSocket.OPEN) client.send(message);
      });
    }
  }, 250);
  downloadsChangedTimer.unref();
}

// Agrega una canción a la cola de la sala y la difunde a todos los clientes.
// El ítem se arma solo con los campos esperados (no se copia el payload
// completo del cliente); `title` únicamente lo aporta el servidor.
function enqueueSong(roomId, payload, title) {
  const room = rooms[roomId];
  if (!room) return;
  room.songQueue.push({
    song: payload.song,
    name: payload.name,
    id: crypto.randomUUID(),
    ...(title ? { title } : {}),
  });
  broadcastQueue(roomId);
}

// Cuántas calificaciones pendientes se recuerdan por sala (las más viejas se olvidan): son las de
// canciones que terminaron y cuya persona aún no ha respondido.
const MAX_PENDING_RATINGS = 20;

// Manda un mensaje a todos los controles remotos de esa persona en la sala (puede tener varios
// dispositivos). Al host no: su pantalla no califica.
function sendToUser(room, name, message) {
  const text = JSON.stringify(message);
  room.clients.forEach((client) => {
    if (!client.isHost && client.userName === name && client.readyState === WebSocket.OPEN) {
      client.send(text);
    }
  });
}

// Lo que se le dice a la persona de una calificación pendiente (sin datos internos como la clave).
function ratingRequestMessage(pending) {
  return {
    type: "ratingRequest",
    payload: { id: pending.id, song: pending.song, ...(pending.title ? { title: pending.title } : {}) },
  };
}

// La canción se identifica por el video de YouTube (no por el archivo, que se borra con el tiempo) o,
// si es del catálogo, por su nombre de archivo.
function songKeyOf(filename) {
  const download = downloadedVideos.get(filename);
  return download ? `yt:${download.videoId}` : `lib:${filename}`;
}

// La canción terminó por sí sola: se le pide a quien la cantó que califique el karaoke.
function requestRating(roomId, item) {
  const room = rooms[roomId];
  if (!room || !ratingsStore || !item.name) return;
  const pending = {
    id: item.id,
    song: item.song,
    title: item.title,
    name: item.name,
    songKey: songKeyOf(item.song),
  };
  room.pendingRatings.push(pending);
  if (room.pendingRatings.length > MAX_PENDING_RATINGS) room.pendingRatings.shift();
  sendToUser(room, pending.name, ratingRequestMessage(pending));
}

// Respuesta de una persona a una calificación pendiente: solo puede responder quien cantó esa canción.
// Con 0 ("ahora no") se descarta sin guardar nada.
async function handleRating(ws, room, payload) {
  const rating = sanitizeRating(payload);
  if (!rating || !ws.userName) return;
  const findPending = () =>
    room.pendingRatings.findIndex((p) => p.id === rating.id && p.name === ws.userName);
  const pending = room.pendingRatings[findPending()];
  if (!pending) return;

  if (rating.value !== 0) {
    try {
      await ratingsStore.upsert({
        songKey: pending.songKey,
        rater: pending.name,
        value: rating.value,
        title: pending.title || pending.song,
        ratedAt: new Date().toISOString(),
      });
    } catch (err) {
      // Sigue pendiente: se le vuelve a pedir si se reconecta.
      console.error(`No se pudo guardar la calificación de ${pending.songKey}:`, err.message);
      return;
    }
  }
  const index = findPending(); // la sala pudo cambiar mientras se guardaba
  if (index !== -1) room.pendingRatings.splice(index, 1);
  // Todos los dispositivos de esa persona cierran la petición, no solo el que respondió.
  sendToUser(room, pending.name, { type: "ratingResolved", payload: { id: pending.id } });
}

wss.on("connection", (ws, req) => {
  // Para el latido de arriba: se marca viva al conectar y cada vez que contesta un ping.
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  // Reject cross-site WebSocket handshakes: browsers always send Origin,
  // so only same-origin connections (or non-browser clients with none) pass.
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) {
        return ws.close(4003, "Origin not allowed");
      }
    } catch {
      return ws.close(4003, "Invalid origin");
    }
  }

  sessionMiddleware(req, {}, () => {
    const url = new URL(req.url, `${req.protocol}://${req.headers.host}`); // Use req.protocol after trust proxy
    const roomId = url.searchParams.get("sala")?.toUpperCase();
    const hostToken = url.searchParams.get("hostToken");
    const isAuthenticated = AUTH_DISABLED || !!req.session?.passport?.user;

    if (!roomId) {
      return ws.close(4005, "Room ID not provided");
    }

    const room = rooms[roomId];
    if (!room) {
      return ws.close(4004, "Room not found");
    }

    // Only the client holding the room's secret hostToken (issued when the
    // room was created) may act as host; the old `isHost=true` query flag
    // let anyone impersonate the host without authenticating.
    const isHost = !!hostToken && hostToken === room.hostToken;

    if (!isHost && !isAuthenticated) {
      return ws.close(4001, "Not authenticated");
    }

    ws.roomId = roomId;
    ws.isHost = isHost;
    // Quién es esta conexión, decidido por el servidor (nunca por el cliente). En modo desarrollo es
    // el nombre que la persona eligió en su sesión.
    ws.userName = isAuthenticated
      ? AUTH_DISABLED
        ? req.session?.devName || devUserName(req)
        : req.session.passport.user.displayName
      : null;
    room.clients.add(ws);
    room.emptySince = null; // ya hay alguien: si la sala estaba en su tiempo de gracia, se salva
    if (ws.userName) room.leftAt.delete(ws.userName); // volvió: ya no cuenta como ausente
    console.log(
      `Client connected to room ${roomId}. Total clients: ${room.clients.size}`
    );
    ws.send(JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));
    // A todos, no solo a esta conexión: que vuelva quien canta cambia lo que pueden hacer los demás.
    sendControlAccess(room);
    ws.send(
      JSON.stringify({
        type: "hostStatus",
        payload: { connected: !!room.hostWs },
      })
    );
    if (typeof room.paused === "boolean") {
      ws.send(JSON.stringify({ type: "playbackState", payload: { paused: room.paused } }));
    }
    // Si terminó una canción suya mientras no estaba conectada (o recargó la página), se le vuelve a pedir.
    if (ws.userName && !isHost) {
      room.pendingRatings
        .filter((pending) => pending.name === ws.userName)
        .forEach((pending) => ws.send(JSON.stringify(ratingRequestMessage(pending))));
    }

    if (isHost) {
      // Si ya había una pantalla de host conectada (por ejemplo, la que se abrió de nuevo para
      // recuperar la sala mientras la anterior seguía abierta), la anterior se desconecta: dos
      // hosts reproducirían el karaoke al mismo tiempo.
      const previousHost = room.hostWs;
      room.hostWs = ws;
      if (previousHost && previousHost !== ws) previousHost.close(4006, "Host replaced");
      broadcastToRoom(
        roomId,
        JSON.stringify({ type: "hostStatus", payload: { connected: true } })
      );
    }

    ws.on("message", (message) => {
      let data;
      try {
        data = JSON.parse(message);
      } catch {
        return; // Ignore malformed messages instead of crashing the process.
      }
      // Un JSON válido no garantiza la forma esperada: "null", un número o un
      // mensaje sin payload lanzaban un TypeError más abajo y tumbaban todo
      // el servidor.
      if (!data || typeof data !== "object") return;
      if (!data.payload || typeof data.payload !== "object") data.payload = {};

      const currentRoom = rooms[ws.roomId];
      if (!currentRoom) return;

      if (!isAllowed(data.type, isHost)) return;

      if (
        isAuthenticated &&
        (data.type === "addSong" || data.type === "removeSong")
      ) {
        // El nombre lo pone siempre el servidor (nunca el cliente).
        data.payload.name = ws.userName;
      }

      let updateQueue = false;
      switch (data.type) {
        case "addSong": {
          const filename = data.payload?.song;
          if (typeof filename !== "string" || !filename) return;

          // Se valida contra la DB (o el registro de descargas de YouTube)
          // para que un cliente no pueda meter en la cola un "filename"
          // arbitrario que no exista (rompería /api/song-url al intentar
          // reproducirlo para todos).
          const download = downloadedVideos.get(filename);
          if (download) {
            // El título de YouTube lo pone el servidor (nunca el cliente) para
            // mostrar algo legible en la cola en lugar del UUID del archivo.
            touchDownload(filename);
            enqueueSong(ws.roomId, data.payload, download.title);
            return;
          }

          if (!db) return; // Sin biblioteca local: solo valen las descargas de YouTube.
          db.get(
            "SELECT 1 FROM songs WHERE filename = ?",
            [filename],
            (err, row) => {
              if (err || !row) return;
              enqueueSong(ws.roomId, data.payload);
            }
          );
          return;
        }
        case "removeSong":
          currentRoom.songQueue = currentRoom.songQueue.filter(
            (song) =>
              !(song.id === data.payload.id && song.name === data.payload.name)
          );
          updateQueue = true;
          break;
        case "moveSong": {
          // Cada persona ordena solo sus canciones entre sí (ver lib/queuePolicy.js).
          const move = sanitizeMoveSong(data.payload);
          if (!move || !ws.userName) return;
          const moved = moveOwnSong(currentRoom.songQueue, move.id, ws.userName, move.direction);
          if (!moved) return;
          currentRoom.songQueue = moved;
          updateQueue = true;
          break;
        }
        case "playNext": {
          const { ended, id } = sanitizePlayNext(data.payload);
          const finished = currentRoom.songQueue.shift();
          // Solo si terminó por sí sola, y era la que el host tenía cargada, se pide calificarla.
          if (finished && ended && id === finished.id) requestRating(ws.roomId, finished);
          updateQueue = true;
          break;
        }
        case "rateSong":
          handleRating(ws, currentRoom, data.payload).catch((err) =>
            console.error("Error al procesar una calificación:", err.message)
          );
          return;
        case "controlAction": {
          // Al host solo le llega una orden válida y sin campos de más.
          const action = sanitizeControlAction(data.payload);
          if (!action) return;
          // Pausar, reanudar y saltar son solo de quien canta la canción que suena (el host, que es
          // la pantalla de la sala, queda fuera de la regla).
          if (!isHost && !canControlPlayback(currentRoom.songQueue, ws.userName, roomPresentNames(currentRoom))) return;
          return broadcastToRoom(ws.roomId, JSON.stringify({ type: "controlAction", payload: action }));
        }
        case "playbackState":
          // Lo informa el host cuando el video se pausa o se reanuda; se recuerda para quien entre después.
          currentRoom.paused = sanitizePlaybackState(data.payload).paused;
          return broadcastToRoom(
            ws.roomId,
            JSON.stringify({ type: "playbackState", payload: { paused: currentRoom.paused } })
          );
        case "timeUpdate":
          return broadcastToRoom(ws.roomId, JSON.stringify(data));
        case "getQueue":
          return ws.send(
            JSON.stringify({
              type: "queueUpdate",
              payload: currentRoom.songQueue,
            })
          );
      }
      if (updateQueue) broadcastQueue(ws.roomId);
    });

    ws.on("close", () => {
      const room = rooms[ws.roomId]; // Use local variable
      if (room) {
        room.clients.delete(ws);
        console.log(
          `Client disconnected from room ${roomId}. Remaining: ${room.clients.size}`
        );
        // Si se fue quien canta, empieza su tiempo de gracia; al terminar, los demás pasan a poder
        // controlar su canción. Si todavía le queda otro dispositivo conectado, no se fue.
        if (!ws.isHost && ws.userName && !connectedNames(room).has(ws.userName)) {
          room.leftAt.set(ws.userName, Date.now());
          scheduleAccessRecheck(roomId, room);
        }
        if (!ws.isHost) sendControlAccess(room);
        if (room.hostWs === ws) {
          room.hostWs = null;
          room.paused = undefined;
          broadcastToRoom(
            roomId,
            JSON.stringify({ type: "hostStatus", payload: { connected: false } })
          );
        }
        if (room.clients.size === 0) {
          // No se borra al momento: si el host cerró el reproductor sin querer, tiene el tiempo de
          // gracia para volver y recuperar la sala con su cola (el barrido de arriba la borra al vencer).
          if (ROOM_GRACE_MS === 0) {
            delete rooms[roomId];
            console.log(`Room ${roomId} deleted.`);
          } else {
            room.emptySince = Date.now();
            console.log(`Room ${roomId} sin conexiones: se conserva ${ROOM_GRACE_MS / 60000} min por si el host vuelve.`);
          }
        }
      }
    });
  });
});

// A diferencia de las descargas, las calificaciones no son imprescindibles: si su base no se puede abrir
// (por ejemplo, sin permisos de escritura) el servidor arranca igual, avisa, y no pide calificar.
async function initRatings() {
  try {
    ratingsStore = await openRatingsStore(RATINGS_DB_PATH);
    console.log(`Calificaciones del karaoke: se guardan en ${RATINGS_DB_PATH}.`);
  } catch (err) {
    console.warn(
      `⚠️  No se pudo abrir la base de calificaciones (${RATINGS_DB_PATH}): no se pedirá calificar las canciones. ${err.message}`
    );
  }
}

// El servidor empieza a atender cuando la base de descargas ya está abierta y
// su registro restaurado. Si no se puede abrir (por ejemplo, sin permisos de
// escritura), el error es fatal, igual que con karaoke.db, para no ocultarlo.
initDownloads()
  .then(initRatings)
  .then(() => {
    server.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
      // En producción se accede por dominio/proxy, así que las IPs de la red
      // local solo se muestran en desarrollo.
      if (process.env.NODE_ENV !== "production") {
        if (process.env.LAN_IP && !parseLanIpOverride(process.env.LAN_IP)) {
          console.warn(`⚠️  LAN_IP="${process.env.LAN_IP}" no es una dirección IPv4 válida: se ignora y se usan las de los adaptadores de red.`);
        }
        formatAccessLines(PORT, getServerAddresses(process.env.LAN_IP)).forEach((line) =>
          console.log(line)
        );
      }
    });
  })
  .catch((err) => {
    console.error(
      `Error al abrir la base de datos de descargas (${DOWNLOADS_DB_PATH}):`,
      err.message
    );
    process.exit(1);
  });
