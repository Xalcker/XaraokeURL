#!/usr/bin/env node
// Reproductor nativo de XaraokeURL: la pantalla principal sin navegador, para equipos donde un
// navegador no alcanza a reproducir video (una Raspberry Pi Zero 2 W, por ejemplo). mpv reproduce el
// video con el decodificador por hardware y dibuja encima quién canta, quién sigue y el QR; este
// programa hace de host de la sala con las mismas APIs y mensajes que public/karaoke.js.
//
// No necesita paquetes de npm: usa el WebSocket, fetch y zlib que trae Node (Node 22+, o Node 20.10+
// arrancado con --experimental-websocket). Si no hay WebSocket integrado, usa el paquete ws.
//
// Uso:
//   node player/xaraoke-player.js http://192.168.1.50:8081/
//
// Variables de entorno (opcionales salvo el servidor, si no va como argumento):
//   XARAOKE_SERVER     URL del servidor
//   XARAOKE_LANG       idioma de los textos en pantalla (es)
//   XARAOKE_MPV_ARGS   opciones extra para mpv, separadas por espacios; p. ej. en un Raspberry Pi:
//                      "--vo=gpu --gpu-context=drm --hwdec=v4l2m2m-copy"
//   XARAOKE_MPV_BIN    ejecutable de mpv (mpv)
//   XARAOKE_STATE_DIR  dónde guardar la sala para recuperarla tras un reinicio
//                      ($XDG_STATE_HOME/xaraoke-player o ~/.local/state/xaraoke-player)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { translate, pickLanguage } = require("../public/js/i18n.js");
const { getSongDisplay } = require("../public/js/shared.js");
const { startMpv, createMpvPlayer } = require("./lib/mpv");
const { createRoomStore, createServerApi } = require("./lib/room");
const { createSession } = require("./lib/session");
const { buildScreen, qrPixels, WIDTH, HEIGHT } = require("./lib/screen");
const { decodePngDataUrl, toBgraSquare } = require("./lib/png");
const { logoDrawing } = require("./lib/svgPath");

const QR_OVERLAY_ID = 0;
const TEXT_OVERLAY_ID = 1;
// El instalador copia el logo junto al reproductor (como i18n.js y shared.js): así se ve desde la
// pantalla de "Conectando…", antes de poder pedírselo al servidor.
const LOGO_FILE = path.join(__dirname, "..", "public", "img", "logo.svg");
const LOGO_RETRY_MS = 60000;

function webSocketImpl() {
  if (typeof globalThis.WebSocket === "function") return globalThis.WebSocket;
  try {
    return require("ws");
  } catch {
    throw new Error("Este Node no trae WebSocket: usa Node 22 o más nuevo, o arráncalo con --experimental-websocket (Node 20.10+).");
  }
}

function readConfig(env, argv) {
  const serverUrl = argv[2] || env.XARAOKE_SERVER;
  if (!serverUrl || !/^https?:\/\//.test(serverUrl)) {
    throw new Error("Falta la URL del servidor (p. ej. http://192.168.1.50:8081/), como argumento o en XARAOKE_SERVER.");
  }
  const stateHome = env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  const runtimeHome = env.XDG_RUNTIME_DIR || os.tmpdir();
  return {
    serverUrl: new URL(serverUrl).origin + "/",
    lang: pickLanguage(env.XARAOKE_LANG || "es"),
    mpvBin: env.XARAOKE_MPV_BIN || "mpv",
    mpvArgs: (env.XARAOKE_MPV_ARGS || "").split(/\s+/).filter(Boolean),
    stateDir: env.XARAOKE_STATE_DIR || path.join(stateHome, "xaraoke-player"),
    runtimeDir: path.join(runtimeHome, `xaraoke-player-${process.pid}`),
  };
}

async function main() {
  const config = readConfig(process.env, process.argv);
  const WebSocketImpl = webSocketImpl();
  const t = (key, params) => translate(config.lang, key, params);
  const songDisplay = (item) => getSongDisplay(item, t("song.unknownArtist"));
  fs.mkdirSync(config.runtimeDir, { recursive: true });

  const mpv = await startMpv({
    bin: config.mpvBin,
    extraArgs: config.mpvArgs,
    socketPath: path.join(config.runtimeDir, "mpv.sock"),
    onExit: (code, signal) => {
      console.error(`mpv se cerró (${signal || code}); salgo para que systemd reinicie todo.`);
      process.exit(1);
    },
  });

  let session = null;
  const player = createMpvPlayer(mpv, {
    onPauseChange: (paused) => session.logic.onPauseChange(paused),
    onEnded: () => session.logic.onEnded(),
    onError: (time) => session.logic.onError(time),
    onTime: (time, duration) => session.logic.onTime(time, duration),
  });

  // --- logo ---
  let logo = null;
  try {
    logo = logoDrawing(fs.readFileSync(LOGO_FILE, "utf8"));
  } catch (error) {
    console.warn("No se pudo leer el logo local, se pedirá al servidor:", error.message);
  }
  let logoRequestedAt = 0;
  // Si no estaba en disco, se pide al servidor (como mucho una vez por minuto si falla).
  function ensureLogo() {
    if (logo || session.state.status !== "room" || Date.now() - logoRequestedAt < LOGO_RETRY_MS) return;
    logoRequestedAt = Date.now();
    fetch(new URL("/img/logo.svg", config.serverUrl))
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((svg) => {
        logo = logoDrawing(svg);
        render();
      })
      .catch((error) => console.warn("No se pudo obtener el logo del servidor:", error.message));
  }

  // --- pantalla ---
  let screenSize = { w: 0, h: 0 };
  let qrCache = { dataUrl: null, image: null };
  let shownQr = null; // { key, file } del QR que está en pantalla
  let qrFiles = 0;

  function qrImage() {
    const dataUrl = session.state.qrDataUrl;
    if (!dataUrl) return null;
    if (qrCache.dataUrl !== dataUrl) {
      try {
        qrCache = { dataUrl, image: decodePngDataUrl(dataUrl) };
      } catch (error) {
        console.warn("No se pudo leer el QR:", error.message);
        qrCache = { dataUrl, image: null };
      }
    }
    return qrCache.image;
  }

  async function removeQr() {
    if (!shownQr) return;
    await mpv.command("overlay-remove", QR_OVERLAY_ID);
    fs.rmSync(shownQr.file, { force: true });
    shownQr = null;
  }

  async function showQr(placement, image) {
    const { size, left, top } = qrPixels(placement, screenSize.w, screenSize.h);
    const key = `${session.state.qrDataUrl}|${size}|${left}|${top}`;
    if (shownQr?.key === key) return;
    // Un archivo nuevo cada vez: mpv lee los píxeles del archivo, y reescribir el que está en
    // pantalla podría mostrarse a medias.
    const file = path.join(config.runtimeDir, `qr-${++qrFiles}.bgra`);
    fs.writeFileSync(file, toBgraSquare(image, size));
    await mpv.command("overlay-add", QR_OVERLAY_ID, left, top, file, 0, "bgra", size, size, size * 4);
    if (shownQr) fs.rmSync(shownQr.file, { force: true });
    shownQr = { key, file };
  }

  async function renderScreen() {
    ensureLogo();
    const image = qrImage();
    const { ass, qr } = buildScreen(
      {
        ...session.state,
        serverUrl: config.serverUrl,
        queue: session.logic.queue,
        paused: session.logic.isPaused(),
        countdown: session.logic.countdown,
        qrAvailable: !!image,
      },
      { t, songDisplay, logo }
    );
    await mpv.commandNamed({
      name: "osd-overlay",
      id: TEXT_OVERLAY_ID,
      format: "ass-events",
      data: ass,
      res_x: WIDTH,
      res_y: HEIGHT,
    });
    if (qr && image && screenSize.w > 0) await showQr(qr, image);
    else await removeQr();
  }

  // Se dibuja de a una vez: dos dibujos cruzados podrían dejar un QR viejo en pantalla.
  let rendering = Promise.resolve();
  const render = () => {
    if (!session) return; // mpv puede avisar el tamaño de la pantalla antes de que haya sesión
    rendering = rendering.then(renderScreen).catch((error) => console.error("No se pudo dibujar la pantalla:", error.message));
  };

  mpv.observe("osd-dimensions", (dims) => {
    if (!dims || !dims.w || !dims.h) return;
    if (dims.w === screenSize.w && dims.h === screenSize.h) return;
    screenSize = { w: dims.w, h: dims.h };
    render();
  });

  session = createSession({
    api: createServerApi(config.serverUrl),
    store: createRoomStore(path.join(config.stateDir, "room.json")),
    WebSocketImpl,
    player,
    onScreenChange: render,
  });

  const shutdown = () => {
    session.stop();
    mpv.close();
    fs.rmSync(config.runtimeDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(`XaraokeURL: reproductor nativo apuntando a ${config.serverUrl}`);
  await session.start();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { readConfig };
