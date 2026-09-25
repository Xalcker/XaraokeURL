// Las rutas HTTP de la API: catálogo, salas, QR, descargas de YouTube y calificaciones.
//
// Todas reciben lo que necesitan (`salas`, `descargas`, el catálogo, el traductor) en vez de
// buscarlo, para que montarlas en una prueba no obligue a levantar el servidor entero.
const path = require("path");
const rateLimit = require("express-rate-limit");
const express = require("express");
const QRCode = require("qrcode");

const { normalizeRoomId } = require("../../lib/roomId");
const { getServerAddresses, remoteBaseUrl } = require("../../lib/network");
const { sanitizeDisplayName } = require("../../lib/displayName");
const { nameKey, isNameTaken } = require("../../lib/nameClaims");
const { SUPPORTED, translate } = require("../../public/js/i18n");
const { YOUTUBE_ID_RE, normalizeSearchSuffix, rankByKnownChannels, searchYoutubeWithFallback } = require("../../lib/ytdlp");
const { sanitizeSearchQuery } = require("../../lib/downloadPolicy");
const { DownloadError } = require("../downloads");

const MAX_SEARCH_QUERY_LENGTH = 100;
const RAIZ = path.join(__dirname, "..", "..");

const limitador = (max, clave, tr) =>
  rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: (req) => ({ error: tr(req, clave) }),
  });

function mountApi(app, { config, auth, salas, descargas, catalogo, ratings, tr }) {
  const { ensureAuthenticated, ensureAuthenticatedRemote, requestUserName } = auth;

  // --- quién soy ---

  app.get("/api/me", ensureAuthenticated, (req, res) => {
    if (config.authDisabled) {
      // Sin login, cada dispositivo elige su nombre (se guarda en su sesión). Hasta que lo
      // elija, `name` es null: no se le sugiere ninguno, porque quien no lo lee entraría con el
      // mismo que los demás.
      return res.json({ devMode: true, name: req.session.devName || null });
    }
    res.json({ name: req.user.displayName || tr(req, "user.default") });
  });

  if (config.authDisabled) {
    // Los nombres genéricos quedan reservados para las conexiones que llegan sin nombre (ver
    // defaultDevName en src/auth.js): quien entrara con uno de ellos compartiría identidad con todas esas.
    const reservedNames = new Set(
      [
        config.devUserName,
        ...SUPPORTED.flatMap((lang) => [translate(lang, "dev.defaultName"), translate(lang, "user.default")]),
      ]
        .filter(Boolean)
        .map(nameKey)
    );

    // `room` es opcional: si viene, se avisa desde ya de que el nombre lo tiene otra persona de
    // esa sala, en vez de dejar entrar y que el WebSocket lo rechace después. Solo existe en
    // modo desarrollo: en producción esta ruta ni se registra.
    app.post("/api/dev-name", (req, res) => {
      const name = sanitizeDisplayName(req.body?.name);
      if (!name) return res.status(400).json({ error: tr(req, "api.nameRequired") });
      if (reservedNames.has(nameKey(name))) {
        return res.status(400).json({ error: tr(req, "api.nameReserved") });
      }
      if (isNameTaken(salas.get(normalizeRoomId(req.body?.room)), name, req.sessionID)) {
        return res.status(409).json({ error: tr(req, "api.nameTaken") });
      }
      req.session.devName = name;
      res.json({ name });
    });
  }

  // --- catálogo ---

  app.get("/api/songs", ensureAuthenticated, (req, res) => {
    const db = catalogo();
    if (!db) return res.json({});
    db.all("SELECT artist, filename FROM songs ORDER BY artist, title", [], (err, rows) => {
      if (err) return res.status(500).json({ error: tr(req, "api.songsFailed") });
      const porInicial = {};
      rows.forEach(({ artist, filename }) => {
        let inicial = artist.charAt(0).toUpperCase();
        if (!/\D/.test(inicial)) inicial = "#";
        if (!porInicial[inicial]) porInicial[inicial] = {};
        if (!porInicial[inicial][artist]) porInicial[inicial][artist] = [];
        porInicial[inicial][artist].push(filename);
      });
      res.json(porInicial);
    });
  });

  app.get("/api/song-url", (req, res) => {
    const { song } = req.query;
    if (!song) return res.status(400).json({ error: tr(req, "api.songNameMissing") });
    const descarga = descargas.get(song);
    if (descarga) return res.json({ url: descarga.url });

    const db = catalogo();
    if (!db) return res.status(404).json({ error: tr(req, "api.songNotFound") });
    db.get("SELECT url FROM songs WHERE filename = ?", [song], (err, row) => {
      if (err || !row) return res.status(404).json({ error: tr(req, "api.songNotFound") });
      res.json({ url: row.url });
    });
  });

  // --- YouTube ---

  app.get(
    "/api/youtube/search",
    ensureAuthenticated,
    limitador(20, "api.tooManySearches", tr),
    async (req, res) => {
      const query = (req.query.q || "").toString().trim();
      if (!query) return res.status(400).json({ error: tr(req, "api.queryMissing") });
      if (query.length > MAX_SEARCH_QUERY_LENGTH) {
        return res.status(400).json({ error: tr(req, "api.queryTooLong") });
      }
      try {
        // Sin selector en el remoto: se busca "karaoke" y, solo si no hay nada, otras versiones.
        const { results: encontrados, suffix } = await searchYoutubeWithFallback(query, { limit: config.searchFetchLimit });
        const canales = descargas.all().map((entry) => entry.channel);
        const results = rankByKnownChannels(encontrados, canales).slice(0, config.searchResultLimit);
        res.json({ results, suffix });
      } catch (err) {
        console.error("Error buscando en YouTube:", err.message);
        res.status(502).json({ error: tr(req, "api.searchFailed") });
      }
    }
  );

  app.post(
    "/api/youtube/download",
    ensureAuthenticated,
    limitador(5, "api.tooManyDownloads", tr),
    async (req, res) => {
      const { videoId, query, suffix } = req.body || {};
      if (typeof videoId !== "string" || !YOUTUBE_ID_RE.test(videoId)) {
        return res.status(400).json({ error: tr(req, "api.invalidVideoId") });
      }
      try {
        const { entry, reused } = await descargas.ensureDownloaded({
          videoId,
          searchQuery: sanitizeSearchQuery(query),
          searchSuffix: normalizeSearchSuffix(suffix),
          requestedBy: requestUserName(req),
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

  // Lista de las descargas que siguen en disco. El control remoto la usa para incluirlas en la
  // búsqueda local (por título, canal o búsqueda original).
  app.get("/api/downloads", ensureAuthenticated, (req, res) => {
    const lista = descargas
      .all()
      .sort((a, b) => (a.downloadedAt < b.downloadedAt ? 1 : -1))
      .map((entry) => ({
        filename: entry.filename,
        title: entry.title,
        channel: entry.channel,
        query: entry.searchQuery,
        durationSeconds: entry.durationSeconds,
        downloadedAt: entry.downloadedAt,
      }));
    res.json(lista);
  });

  // Pulgares arriba y abajo acumulados de todas las salas, por nombre de archivo (que es como
  // el control remoto identifica cada canción). Las calificaciones de un video de YouTube se
  // guardan por su id, así que solo se listan mientras el video siga descargado.
  app.get("/api/ratings", ensureAuthenticated, async (req, res) => {
    const store = ratings();
    if (!store) return res.json({});
    try {
      const porArchivo = {};
      for (const [songKey, totals] of Object.entries(await store.totals())) {
        const [tipo, ...resto] = songKey.split(":");
        const id = resto.join(":");
        const filename = tipo === "yt" ? descargas.findByVideoId(id)?.filename : id;
        if (filename) porArchivo[filename] = totals;
      }
      res.json(porArchivo);
    } catch (err) {
      console.error("No se pudieron leer las calificaciones:", err.message);
      res.status(500).json({ error: tr(req, "api.ratingsFailed") });
    }
  });

  // --- salas ---

  // Sin este límite, cualquiera podía crear salas sin autenticarse y sin límite alguno;
  // combinado con la limpieza, una sala que nunca recibe conexiones se quedaba en memoria
  // para siempre (fuga de memoria/DoS).
  app.post("/api/rooms", limitador(10, "api.tooManyRooms", tr), (req, res) => {
    res.json(salas.create());
  });

  // Un código de sala son 4 letras: 456.976 combinaciones. Sin límite, esta ruta permitía
  // barrerlas todas y listar las salas activas. Unirse sigue requiriendo sesión, así que el
  // riesgo era bajo, pero el barrido no tiene por qué salir gratis. El tope es holgado: al
  // unirse se consulta una o dos veces.
  app.get("/api/rooms/:roomId", limitador(60, "api.tooManyRooms", tr), (req, res) => {
    res.json({ exists: salas.exists(req.params.roomId) });
  });

  // El host que cerró el reproductor vuelve con el hostToken que guardó su navegador: si la
  // sala sigue existiendo (no venció su gracia) y el token es el suyo, puede retomarla.
  app.post("/api/rooms/:roomId/resume", (req, res) => {
    const room = salas.get(req.params.roomId);
    const hostToken = req.body?.hostToken;
    if (!room || typeof hostToken !== "string" || hostToken !== room.hostToken) {
      return res.status(404).json({ error: tr(req, "api.roomGone") });
    }
    res.json({ queueLength: room.songQueue.length });
  });

  app.get("/api/qr", (req, res) => {
    // Con 'trust proxy' puesto, req.secure detecta bien el protocolo tras el proxy.
    const protocol = req.secure ? "https" : "http";
    // Si la pantalla principal se abrió como "localhost" (fuera de producción), el QR usa la
    // dirección de la red local para que los teléfonos puedan abrirlo.
    const baseUrl = remoteBaseUrl({
      protocol,
      host: req.get("host"),
      addresses: config.isProduction ? [] : getServerAddresses(config.lanIp),
    });
    const remoteUrl = `${baseUrl}/remote.html`;
    // Con la sala en el enlace, el teléfono entra directo: no tiene que escribir el código.
    const roomId = normalizeRoomId(req.query.sala);
    const joinUrl = roomId ? `${remoteUrl}?sala=${roomId}` : remoteUrl;

    QRCode.toDataURL(joinUrl, (err, url) => {
      if (err) {
        console.error("Error generando QR:", err);
        return res.status(500).send("Error generando QR");
      }
      // remoteUrl es la dirección corta que se escribe bajo el QR; joinUrl es lo que contiene.
      res.send({ qrUrl: url, remoteUrl, joinUrl });
    });
  });

  // --- archivos ---

  // Algunos clientes piden /favicon.ico sin leer los <link>: se les sirve el PNG.
  //
  // Se pasa `root` en vez de la ruta absoluta completa a propósito. Con la ruta completa, la
  // comprobación de archivos ocultos de `send` se aplica a TODA la ruta, así que si el proyecto
  // vive bajo un directorio que empieza por punto (~/.local/share/xaraoke, un worktree dentro
  // de .claude/...), el favicon devuelve 404. Con `root`, solo se mira la parte de después, que
  // siempre está limpia. Express 4 lo toleraba; express 5 no.
  app.get("/favicon.ico", (req, res) =>
    res.sendFile("favicon-32.png", { root: path.join(RAIZ, "public", "img") })
  );

  app.use("/remote.html", ensureAuthenticatedRemote);
  app.use(express.static(path.join(RAIZ, "public")));
  // Sin auth a propósito: el host (pantalla principal) reproduce estos archivos sin sesión de
  // Google, igual que ya pasa con las URLs externas del catálogo. La protección real es que el
  // nombre es un UUID v4 al que solo se llega habiendo pasado por /api/youtube/download.
  app.use("/downloads", express.static(config.downloadsPath));
}

module.exports = { mountApi };
