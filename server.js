// Arranque del servidor: lee la configuración, crea las piezas, las conecta y escucha.
//
// La lógica vive en src/: config (el entorno), auth (sesiones y Google), rooms (las salas),
// downloads (yt-dlp), routes/api (los endpoints HTTP) y realtime (el WebSocket). Cada pieza
// recibe lo que necesita en vez de buscarlo, así que no hay requires circulares y se pueden
// probar por separado. Este archivo no tiene reglas de negocio: solo las junta.
require("dotenv").config();
const express = require("express");
const http = require("http");
const helmet = require("helmet");
const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");

const { pickLanguage, translate } = require("./public/js/i18n");
const { checkYtdlpAvailable } = require("./lib/ytdlp");
const { openRatingsStore } = require("./lib/ratingsStore");
const { getServerAddresses, parseLanIpOverride, formatAccessLines } = require("./lib/network");

const { loadConfig, ensureDataDirs } = require("./src/config");
const { setupAuth } = require("./src/auth");
const { createRooms } = require("./src/rooms");
const { createDownloads } = require("./src/downloads");
const { mountApi } = require("./src/routes/api");
const { createRealtime } = require("./src/realtime");

const FORCE_EXIT_MS = 10000;

const config = loadConfig();
ensureDataDirs(config);

// Idioma de quien hace la petición (header Accept-Language) y texto traducido: los mensajes de
// error de la API y las pantallas de acceso salen en su idioma. Los registros de la consola del
// servidor siguen en español.
const langOf = (req) => pickLanguage(req.headers["accept-language"]);
const tr = (req, key, params) => translate(langOf(req), key, params);

const app = express();

// Content-Security-Policy. No queda nada inline (el script que redirige a los teléfonos vive en
// public/js/mobileRedirect.js y los estilos de las pantallas de acceso en
// public/css/simple-page.css), así que script-src y style-src pueden quedarse en 'self' sin
// 'unsafe-inline', que es lo que hace que la política valga de algo.
//
// Las excepciones son las que el karaoke necesita de verdad:
//  - imgSrc data:  -> el código QR se genera como data:image/png (ver /api/qr).
//    imgSrc https: -> las miniaturas de los resultados de YouTube.
//  - mediaSrc abierto -> las canciones del catálogo son URLs arbitrarias que salen de
//    songs.csv y pueden apuntar a cualquier sitio; restringirlo rompería la biblioteca entera.
//    Lo que importa es que el atacante no pueda ejecutar código, y eso lo cubre script-src.
//  - connectSrc con ws:/wss: -> el WebSocket. 'self' debería bastar según la especificación,
//    pero no todos los navegadores lo han tratado igual, y aquí hay teléfonos de por medio.
//  - upgradeInsecureRequests se quita (helmet lo pone por defecto): en una red local se sirve
//    por http, y forzar https rompería tanto la propia página como los vídeos del catálogo.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"],
        mediaSrc: ["'self'", "https:", "http:", "data:", "blob:"],
        connectSrc: ["'self'", "ws:", "wss:"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: null,
      },
    },
  })
);
app.use(express.json({ limit: "10kb" }));

if (config.isProduction) {
  app.set("trust proxy", 1); // Se confía en el primer salto (Nginx)
  console.log("Trust Proxy enabled for production environment.");
}

// Si karaoke.db no existe (todavía no se importó songs.csv), el servidor arranca igual en "modo
// sin biblioteca": el catálogo local queda vacío y solo se pueden agregar canciones buscándolas
// en YouTube. Si el archivo sí existe pero no se puede abrir (por ejemplo, sin permisos de
// lectura), el error sigue siendo fatal para no ocultar un problema real.
let db = null;
if (fs.existsSync(config.dbPath)) {
  db = new sqlite3.Database(config.dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error("Error al conectar con la base de datos:", err.message);
      process.exit(1);
    }
    console.log("Conectado a la base de datos de canciones en modo lectura.");
  });
} else {
  console.warn(
    `⚠️  No se encontró la base de datos (${config.dbPath}): la biblioteca local queda vacía y solo se podrán agregar canciones buscándolas en YouTube. Ejecuta "npm run import" para crearla.`
  );
}
const catalogo = () => db;

// null si la base de calificaciones no se pudo abrir: entonces no se pide calificar.
let ratingsStore = null;
const ratings = () => ratingsStore;

checkYtdlpAvailable().then((available) => {
  if (!available) {
    console.warn(
      "⚠️  yt-dlp no está disponible en el PATH del servidor: la búsqueda/descarga desde YouTube no funcionará hasta que se instale."
    );
  }
});

const auth = setupAuth(app, { config, tr, langOf });
const salas = createRooms({ config });
// Las descargas avisan de sus cambios con un callback en vez de llamar al WebSocket: así este
// módulo no depende de aquel y no hay un require circular. Se conecta más abajo, al crearlo.
let avisarCambioDescargas = () => {};
const descargas = createDownloads({
  config,
  onChange: () => avisarCambioDescargas(),
  queuedFilenames: () => salas.queuedFilenames(),
});

mountApi(app, { config, auth, salas, descargas, catalogo, ratings, tr });

const server = http.createServer(app);
const realtime = createRealtime({ server, config, auth, salas, descargas, catalogo, ratings });
avisarCambioDescargas = realtime.notifyDownloadsChanged;

salas.startSweep();

// A diferencia de las descargas, las calificaciones no son imprescindibles: si su base no se
// puede abrir (por ejemplo, sin permisos de escritura) el servidor arranca igual, avisa, y no
// pide calificar.
async function initRatings() {
  try {
    ratingsStore = await openRatingsStore(config.ratingsDbPath);
    console.log(`Calificaciones del karaoke: se guardan en ${config.ratingsDbPath}.`);
  } catch (err) {
    console.warn(
      `⚠️  No se pudo abrir la base de calificaciones (${config.ratingsDbPath}): no se pedirá calificar las canciones. ${err.message}`
    );
  }
}

// Apagado ordenado: un despliegue o un reinicio manda SIGTERM/SIGINT y, sin esto, el proceso
// moría de golpe y podía cortar una escritura a SQLite a media. Se deja de aceptar conexiones,
// se cierran las que haya y se cierran las bases antes de salir.
let apagando = false;

async function apagar(senal) {
  if (apagando) return;
  apagando = true;
  console.log(`\n${senal} recibido: cerrando ordenadamente...`);

  // Por si algo se queda colgado (una conexión que no cierra, una base que no responde), no se
  // deja el proceso vivo para siempre: el gestor de servicios acabaría matándolo de todos modos.
  const forzar = setTimeout(() => {
    console.warn("⚠️  El cierre ordenado tardó demasiado: se sale de todos modos.");
    process.exit(1);
  }, FORCE_EXIT_MS);
  forzar.unref();

  try {
    await realtime.closeAll();
    await new Promise((resolve) => server.close(resolve));

    // Las bases se cierran al final: hasta aquí alguien podía seguir escribiendo.
    await Promise.all([
      descargas.close(),
      ratingsStore ? ratingsStore.close() : null,
      db ? new Promise((resolve) => db.close(() => resolve())) : null,
    ]);
    console.log("Todo cerrado. Hasta luego.");
    clearTimeout(forzar);
    process.exit(0);
  } catch (err) {
    console.error("Error al cerrar ordenadamente:", err.message);
    clearTimeout(forzar);
    process.exit(1);
  }
}

process.on("SIGTERM", () => apagar("SIGTERM"));
process.on("SIGINT", () => apagar("SIGINT"));

// El servidor empieza a atender cuando la base de descargas ya está abierta y su registro
// restaurado. Si no se puede abrir (por ejemplo, sin permisos de escritura), el error es fatal,
// igual que con karaoke.db, para no ocultarlo.
descargas
  .init()
  .then(initRatings)
  .then(() => {
    server.listen(config.port, () => {
      console.log(`🚀 Servidor corriendo en el puerto ${config.port}`);
      // En producción se accede por dominio/proxy, así que las IPs de la red local solo se
      // muestran en desarrollo.
      if (!config.isProduction) {
        if (config.lanIp && !parseLanIpOverride(config.lanIp)) {
          console.warn(
            `⚠️  LAN_IP="${config.lanIp}" no es una dirección IPv4 válida: se ignora y se usan las de los adaptadores de red.`
          );
        }
        formatAccessLines(config.port, getServerAddresses(config.lanIp)).forEach((line) =>
          console.log(line)
        );
      }
    });
  })
  .catch((err) => {
    console.error(
      `Error al abrir la base de datos de descargas (${config.downloadsDbPath}):`,
      err.message
    );
    process.exit(1);
  });
