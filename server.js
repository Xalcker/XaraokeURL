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
const { generateRoomId } = require("./lib/roomId");
const { getLanAddresses, formatAccessLines } = require("./lib/network");
const {
  YOUTUBE_ID_RE,
  checkYtdlpAvailable,
  searchYoutube,
  getVideoDurationSeconds,
  downloadYoutubeVideo,
} = require("./lib/ytdlp");

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
const DEV_USER_NAME = process.env.DEV_USER_NAME || "Usuario Local";
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
// Registro efímero de videos descargados de YouTube: filename -> { url, title, addedAt }.
// Nunca se escriben en karaoke.db (que se abre en modo solo-lectura); un
// barrido periódico los borra del disco después de un tiempo (ver más abajo).
let downloadedVideos = {};

const sessionMiddleware = session({
  store: new FileStore({
    path: SESSIONS_PATH,
    ttl: 86400,
    logFn: function () {},
  }),
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
    passport.authenticate("google", { failureRedirect: "/login-failed" }),
    (req, res) => {
      res.redirect("/remote.html");
    }
  );
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

function ensureAuthenticated(req, res, next) {
  if (AUTH_DISABLED || req.isAuthenticated()) return next();
  res.redirect("/login");
}

app.get("/login", (req, res) => {
  if (AUTH_DISABLED) return res.redirect("/remote.html");
  res.send(
    `<div style="font-family: sans-serif; text-align: center; padding-top: 50px;"><h1>XaraokeURL</h1><p>Necesitas iniciar sesión para acceder al control remoto.</p><a href="/auth/google" style="background-color: #4285F4; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Iniciar sesión con Google</a></div>`
  );
});

app.get("/logout", (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/");
  });
});

app.get("/login-failed", (req, res) => {
  res
    .status(403)
    .send(
      `<h1>Acceso denegado</h1><p>Debes usar una cuenta del dominio ${ALLOWED_DOMAIN} para acceder.</p>`
    );
});

app.get("/api/me", ensureAuthenticated, (req, res) => {
  if (AUTH_DISABLED) return res.json({ name: DEV_USER_NAME });
  res.json({ name: req.user.displayName || "Usuario" });
});

app.get("/api/songs", ensureAuthenticated, (req, res) => {
  if (!db) return res.json({});
  db.all(
    "SELECT artist, filename FROM songs ORDER BY artist, title",
    [],
    (err, rows) => {
      if (err)
        return res
          .status(500)
          .json({ error: "No se pudieron obtener las canciones." });
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
    return res.status(400).json({ error: "Falta el nombre de la canción." });
  if (downloadedVideos[song]) {
    return res.json({ url: downloadedVideos[song].url });
  }
  if (!db) return res.status(404).json({ error: "Canción no encontrada." });
  db.get("SELECT url FROM songs WHERE filename = ?", [song], (err, row) => {
    if (err || !row)
      return res.status(404).json({ error: "Canción no encontrada." });
    res.json({ url: row.url });
  });
});

const youtubeSearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas búsquedas en YouTube. Espera un minuto." },
});

const youtubeDownloadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas descargas. Espera un minuto." },
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
      return res.status(400).json({ error: "Falta el término de búsqueda." });
    }
    if (query.length > 100) {
      return res.status(400).json({ error: "Búsqueda demasiado larga." });
    }
    try {
      const results = await searchYoutube(query, { limit: 4, suffix });
      res.json({ results });
    } catch (err) {
      console.error("Error buscando en YouTube:", err.message);
      res.status(502).json({ error: "No se pudo buscar en YouTube." });
    }
  }
);

app.post(
  "/api/youtube/download",
  ensureAuthenticated,
  youtubeDownloadLimiter,
  async (req, res) => {
    const { videoId, title } = req.body || {};
    if (typeof videoId !== "string" || !YOUTUBE_ID_RE.test(videoId)) {
      return res.status(400).json({ error: "ID de video inválido." });
    }
    if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS) {
      return res
        .status(429)
        .json({ error: "Ya hay demasiadas descargas en curso, intenta en un momento." });
    }

    activeDownloads++;
    try {
      // Chequeo autoritativo de duración: nunca confiar en la que haya
      // devuelto la búsqueda (puede faltar o estar desactualizada).
      const duration = await getVideoDurationSeconds(videoId);
      if (duration !== null && duration > MAX_YOUTUBE_DURATION_SECONDS) {
        return res
          .status(400)
          .json({ error: "El video es demasiado largo (máximo 10 minutos)." });
      }

      const filename = `${crypto.randomUUID()}.mp4`;
      const destPath = path.join(DOWNLOADS_PATH, filename);
      await downloadYoutubeVideo(videoId, destPath);

      downloadedVideos[filename] = {
        url: `/downloads/${filename}`,
        title: typeof title === "string" && title ? title.slice(0, 200) : "Video de YouTube",
        addedAt: Date.now(),
      };
      res.json({ filename, title: downloadedVideos[filename].title });
    } catch (err) {
      console.error("Error descargando de YouTube:", err.message);
      res.status(502).json({ error: "No se pudo descargar el video." });
    } finally {
      activeDownloads--;
    }
  }
);

// Borra las descargas de YouTube después de un tiempo: son efímeras por
// diseño (nunca se agregan a karaoke.db) y si no se limpiaran el disco
// crecería sin límite con cada canción que alguien busque y agregue.
const DOWNLOAD_TTL_MS = 6 * 60 * 60 * 1000; // 6 horas
setInterval(() => {
  const now = Date.now();
  for (const [filename, info] of Object.entries(downloadedVideos)) {
    if (now - info.addedAt > DOWNLOAD_TTL_MS) {
      delete downloadedVideos[filename];
      fs.unlink(path.join(DOWNLOADS_PATH, filename), (err) => {
        if (err && err.code !== "ENOENT") {
          console.error(`No se pudo borrar la descarga ${filename}:`, err.message);
        }
      });
      console.log(`Descarga ${filename} eliminada por antigüedad.`);
    }
  }
}, 30 * 60 * 1000).unref();

// Sin este límite, cualquiera podía crear salas sin autenticarse y sin
// límite alguno; combinado con la limpieza de abajo, una sala que nunca
// recibe conexiones se quedaba en memoria para siempre (fuga de memoria/DoS).
const createRoomLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas salas creadas. Intenta de nuevo en un minuto." },
});

app.post("/api/rooms", createRoomLimiter, (req, res) => {
  const roomId = generateRoomId(rooms);
  const hostToken = crypto.randomUUID();
  rooms[roomId] = {
    songQueue: [],
    clients: new Set(),
    hostToken,
    hostWs: null,
    createdAt: Date.now(),
  };
  console.log(`Sala creada: ${roomId}`);
  res.json({ roomId, hostToken });
});

// Elimina salas que nunca llegaron a tener un cliente conectado (el host
// nunca abrió el WebSocket). Las salas activas se limpian de inmediato al
// desconectarse el último cliente, así que esto solo cubre ese caso huérfano.
const ROOM_IDLE_TTL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of Object.entries(rooms)) {
    if (room.clients.size === 0 && now - room.createdAt > ROOM_IDLE_TTL_MS) {
      delete rooms[roomId];
      console.log(`Sala ${roomId} eliminada por inactividad (nadie se conectó).`);
    }
  }
}, 60 * 1000).unref();

app.get("/api/rooms/:roomId", (req, res) => {
  res.json({ exists: !!rooms[req.params.roomId.toUpperCase()] });
});

app.get("/api/qr", (req, res) => {
  // Rely on 'trust proxy' to correctly detect the protocol
  const protocol = req.secure ? "https" : "http";
  const host = req.get("host");
  const baseUrl = `${protocol}://${host}`;
  const remoteUrl = `${baseUrl}/remote.html`;

  QRCode.toDataURL(remoteUrl, (err, url) => {
    if (err) {
      console.error("Error generando QR:", err);
      res.status(500).send("Error generando QR");
    } else {
      res.send({ qrUrl: url, remoteUrl });
    }
  });
});

app.get("/favicon.ico", (req, res) => res.status(204).send());
app.use("/remote.html", ensureAuthenticated);
app.use(express.static(path.join(__dirname, "public")));
// Sin auth a propósito: el host (pantalla principal) reproduce estos
// archivos sin sesión de Google, igual que ya pasa con las URLs externas
// del catálogo. La protección real es que el nombre es un UUID v4 al que
// solo se llega habiendo pasado por /api/youtube/download (autenticado).
app.use("/downloads", express.static(DOWNLOADS_PATH));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcastToRoom(roomId, data) {
  const room = rooms[roomId];
  if (room) {
    room.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
  }
}

wss.on("connection", (ws, req) => {
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
    room.clients.add(ws);
    console.log(
      `Client connected to room ${roomId}. Total clients: ${room.clients.size}`
    );
    ws.send(JSON.stringify({ type: "queueUpdate", payload: room.songQueue }));
    ws.send(
      JSON.stringify({
        type: "hostStatus",
        payload: { connected: !!room.hostWs },
      })
    );

    if (isHost) {
      room.hostWs = ws;
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
      const currentRoom = rooms[ws.roomId];
      if (!currentRoom) return;

      if (
        isAuthenticated &&
        (data.type === "addSong" || data.type === "removeSong")
      ) {
        data.payload.name = AUTH_DISABLED
          ? DEV_USER_NAME
          : req.session.passport.user.displayName;
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
          if (downloadedVideos[filename]) {
            currentRoom.songQueue.push({
              ...data.payload,
              id: crypto.randomUUID(),
            });
            broadcastToRoom(
              ws.roomId,
              JSON.stringify({
                type: "queueUpdate",
                payload: currentRoom.songQueue,
              })
            );
            return;
          }

          if (!db) return; // Sin biblioteca local: solo valen las descargas de YouTube.
          db.get(
            "SELECT 1 FROM songs WHERE filename = ?",
            [filename],
            (err, row) => {
              if (err || !row) return;
              const roomNow = rooms[ws.roomId];
              if (!roomNow) return;
              roomNow.songQueue.push({
                ...data.payload,
                id: crypto.randomUUID(),
              });
              broadcastToRoom(
                ws.roomId,
                JSON.stringify({
                  type: "queueUpdate",
                  payload: roomNow.songQueue,
                })
              );
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
        case "playNext":
          if (currentRoom.songQueue.length > 0) currentRoom.songQueue.shift();
          updateQueue = true;
          break;
        case "controlAction":
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
      if (updateQueue) {
        broadcastToRoom(
          ws.roomId,
          JSON.stringify({
            type: "queueUpdate",
            payload: currentRoom.songQueue,
          })
        );
      }
    });

    ws.on("close", () => {
      const room = rooms[ws.roomId]; // Use local variable
      if (room) {
        room.clients.delete(ws);
        console.log(
          `Client disconnected from room ${roomId}. Remaining: ${room.clients.size}`
        );
        if (room.hostWs === ws) {
          room.hostWs = null;
          broadcastToRoom(
            roomId,
            JSON.stringify({ type: "hostStatus", payload: { connected: false } })
          );
        }
        if (room.clients.size === 0) {
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted.`);
        }
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
  // En producción se accede por dominio/proxy, así que las IPs de la red
  // local solo se muestran en desarrollo.
  if (process.env.NODE_ENV !== "production") {
    formatAccessLines(PORT, getLanAddresses()).forEach((line) =>
      console.log(line)
    );
  }
});
