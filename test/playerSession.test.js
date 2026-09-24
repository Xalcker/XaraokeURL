// El reproductor nativo de punta a punta contra un servidor de verdad: crea o recupera la sala, hace
// de host por el WebSocket y reproduce lo que agregan los remotos. Lo único de mentira es el
// reproductor (mpv), que aquí solo anota lo que le piden.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const WebSocket = require("ws");
const { startServer } = require("../test-helpers/testServer");
const { connectToRoom } = require("../test-helpers/wsClient");
const { createSession } = require("../player/lib/session");
const { createServerApi, createRoomStore } = require("../player/lib/room");

const A = "Queen - Bohemian Rhapsody.mp4";
const B = "Soda Stereo - De Música Ligera.mp4";
const CANCIONES = [
  { artist: "Queen", title: "Bohemian Rhapsody", filename: A, url: "http://videos.ejemplo/queen.mp4" },
  { artist: "Soda Stereo", title: "De Música Ligera", filename: B, url: "http://videos.ejemplo/soda.mp4" },
];

const silent = { info() {}, warn() {}, error() {} };

function fakePlayer() {
  return {
    loaded: false,
    paused: false,
    loads: [],
    async load(url, start, { paused = false } = {}) {
      this.loaded = true;
      this.paused = paused;
      this.loadedPaused = paused;
      this.loads.push({ url, start });
    },
    pause() {
      this.paused = true;
      this.onPause?.(true);
    },
    resume() {
      this.paused = false;
      this.onPause?.(false);
    },
    stop() {
      this.loaded = false;
    },
  };
}

// Espera a que se cumpla una condición (el reproductor y la sesión no emiten promesas propias).
async function until(check, what, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`no pasó a tiempo: ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function newSession(server, t, { stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "xaraoke-player-")) } = {}) {
  const player = fakePlayer();
  const session = createSession({
    api: createServerApi(`${server.baseUrl}/`),
    store: createRoomStore(path.join(stateDir, "room.json")),
    WebSocketImpl: WebSocket,
    player,
    log: silent,
    retryMs: 200,
    reconnectMs: 200,
  });
  player.onPause = (paused) => session.logic.onPauseChange(paused);
  t.after(() => session.stop());
  return { session, player, stateDir };
}

test("el reproductor nativo contra el servidor", async (t) => {
  // Sin cuenta regresiva: aquí se prueba el resto (la cuenta tiene su propia prueba, abajo).
  const server = await startServer({ songs: CANCIONES, env: { SONG_COUNTDOWN_SECONDS: "0" } });
  t.after(() => server.stop());

  await t.test("crea la sala, obtiene el QR y reproduce lo que agrega un remoto", async (t) => {
    const { session, player } = newSession(server, t);
    await session.start();
    await until(() => session.connected, "conectarse como host");
    assert.match(session.state.roomId, /^[A-Z]{4}$/);
    await until(() => session.state.qrDataUrl, "obtener el QR");
    assert.match(session.state.qrDataUrl, /^data:image\/png;base64,/);
    assert.match(session.state.remoteUrl, /\/remote\.html$/);

    const remoto = await connectToRoom(`${server.wsUrl}/?sala=${session.state.roomId}`);
    t.after(() => remoto.close());
    remoto.send({ type: "addSong", payload: { song: A } });
    await until(() => player.loads.length === 1, "cargar la canción");
    assert.deepEqual(player.loads[0], { url: "http://videos.ejemplo/queen.mp4", start: 0 });

    // Una orden del remoto le llega al reproductor, y el cambio de pausa vuelve a los remotos.
    remoto.clear();
    remoto.send({ type: "controlAction", payload: { action: "pause" } });
    await until(() => player.paused, "pausar por orden del remoto");
    await remoto.waitFor("playbackState", (p) => p.paused === true);

    // Al terminar sola, el servidor la quita y el reproductor pasa a la siguiente.
    remoto.send({ type: "addSong", payload: { song: B } });
    await remoto.waitFor("queueUpdate", (p) => p.length === 2);
    player.loaded = false;
    session.logic.onEnded();
    await until(() => player.loads.length === 2, "cargar la siguiente");
    assert.equal(player.loads[1].url, "http://videos.ejemplo/soda.mp4");
  });

  await t.test("tras reiniciarse recupera la misma sala", async (t) => {
    const first = newSession(server, t);
    await first.session.start();
    await until(() => first.session.connected, "conectarse");
    const roomId = first.session.state.roomId;
    first.session.stop();

    const again = newSession(server, t, { stateDir: first.stateDir });
    await again.session.start();
    await until(() => again.session.connected, "reconectarse");
    assert.equal(again.session.state.roomId, roomId, "la sala guardada se retoma");
  });

  await t.test("si la sala guardada ya no existe, crea otra", async (t) => {
    const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "xaraoke-player-"));
    fs.writeFileSync(path.join(stateDir, "room.json"), JSON.stringify({ roomId: "ZZZZ", hostToken: "viejo" }));
    const { session } = newSession(server, t, { stateDir });
    await session.start();
    await until(() => session.connected, "conectarse");
    assert.notEqual(session.state.roomId, "ZZZZ");
    const saved = JSON.parse(fs.readFileSync(path.join(stateDir, "room.json"), "utf8"));
    assert.equal(saved.roomId, session.state.roomId, "guarda la sala nueva");
  });

  await t.test("si otra pantalla toma la sala, esta se detiene y no pelea por el control", async (t) => {
    const first = newSession(server, t);
    await first.session.start();
    await until(() => first.session.connected, "conectarse");

    const second = newSession(server, t, { stateDir: first.stateDir });
    await second.session.start();
    await until(() => first.session.state.status === "replaced", "quedar reemplazada");
    await new Promise((r) => setTimeout(r, 500)); // más que reconnectMs: no debe volver a entrar
    assert.equal(first.session.connected, false);
    assert.equal(second.session.connected, true);
  });
});

test("con SONG_COUNTDOWN_SECONDS, el reproductor cuenta antes de empezar la canción", async (t) => {
  const server = await startServer({ songs: CANCIONES, env: { SONG_COUNTDOWN_SECONDS: "1" } });
  t.after(() => server.stop());
  const { session, player } = newSession(server, t);
  await session.start();
  await until(() => session.connected, "conectarse como host");

  const remoto = await connectToRoom(`${server.wsUrl}/?sala=${session.state.roomId}`);
  t.after(() => remoto.close());
  remoto.clear();
  remoto.send({ type: "addSong", payload: { song: A } });
  await until(() => player.loads.length === 1, "cargar la canción");
  assert.equal(player.loadedPaused, true, "se abre detenida en el principio");
  await until(() => session.logic.countdown, "empezar la cuenta");
  assert.deepEqual(session.logic.countdown, { remaining: 1, paused: false });
  // Para los remotos la cuenta ya es "sonando" (pueden pausarla).
  await remoto.waitFor("playbackState", (p) => p.paused === false);

  await until(() => session.logic.countdown === null, "terminar la cuenta");
  assert.equal(player.paused, false, "al llegar a cero, la canción arranca");
});

test("sin servidor: muestra 'conectando' y sigue reintentando sin romperse", async (t) => {
  // Un puerto donde no escucha nadie todavía.
  const net = require("node:net");
  const port = await new Promise((resolve) => {
    const probe = net.createServer().listen(0, "127.0.0.1", () => {
      const p = probe.address().port;
      probe.close(() => resolve(p));
    });
  });
  const fakeServer = { baseUrl: `http://127.0.0.1:${port}` };
  const { session } = newSession(fakeServer, t);
  await session.start();
  assert.equal(session.state.status, "connecting");
  await new Promise((r) => setTimeout(r, 500)); // más que retryMs: ya reintentó al menos una vez
  assert.equal(session.state.status, "connecting");
  assert.equal(session.connected, false);
});
