// Cuenta regresiva antes de cada canción (SONG_COUNTDOWN_SECONDS), como la del cine: el servidor le
// dice al host cuántos segundos son, y la pantalla (web o nativa) cuenta con el video ya cargado y en
// pausa antes de arrancarlo. Las órdenes de pausa de los remotos detienen la cuenta.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_SONG_COUNTDOWN_SECONDS,
  MAX_SONG_COUNTDOWN_SECONDS,
  parseSongCountdown,
} = require("../lib/roomPolicy");
const { loadConfig } = require("../src/config");
const { createCountdown, getSongDisplay } = require("../public/js/shared.js");
const { translate } = require("../public/js/i18n.js");
const { createHostLogic } = require("../player/lib/hostLogic");
const { buildScreen } = require("../player/lib/screen");
const { startServer } = require("../test-helpers/testServer");
const { connectToRoom } = require("../test-helpers/wsClient");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

// Temporizadores de mentira: `advance()` dispara el que esté pendiente, como si pasara un segundo.
function fakeTimers() {
  let pending = null;
  let nextId = 1;
  return {
    setTimeout(fn) {
      pending = { id: nextId++, fn };
      return pending.id;
    },
    clearTimeout(id) {
      if (pending?.id === id) pending = null;
    },
    get pending() {
      return pending !== null;
    },
    advance() {
      const current = pending;
      pending = null;
      current?.fn();
    },
  };
}

// ---------- configuración

test("parseSongCountdown usa 5 segundos si la variable no está definida o está vacía", () => {
  assert.equal(DEFAULT_SONG_COUNTDOWN_SECONDS, 5);
  for (const value of [undefined, null, "", "   "]) {
    assert.deepEqual(parseSongCountdown(value), { seconds: 5, warning: null }, JSON.stringify(value));
  }
});

test("parseSongCountdown acepta segundos (redondeados) y 0 para no contar", () => {
  assert.deepEqual(parseSongCountdown("10"), { seconds: 10, warning: null });
  assert.deepEqual(parseSongCountdown(" 3.4 "), { seconds: 3, warning: null });
  assert.deepEqual(parseSongCountdown(7), { seconds: 7, warning: null });
  assert.deepEqual(parseSongCountdown("0"), { seconds: 0, warning: null });
});

test("parseSongCountdown no pasa del máximo, y avisa si el valor no es válido", () => {
  const tooMuch = parseSongCountdown("120");
  assert.equal(tooMuch.seconds, MAX_SONG_COUNTDOWN_SECONDS);
  assert.match(tooMuch.warning, /SONG_COUNTDOWN_SECONDS/);
  for (const value of ["abc", "-5", "NaN", "Infinity", "1,5"]) {
    const result = parseSongCountdown(value);
    assert.equal(result.seconds, 5, value);
    assert.match(result.warning, /SONG_COUNTDOWN_SECONDS/, value);
  }
});

test("la configuración del servidor lee SONG_COUNTDOWN_SECONDS y avisa si es inválido", () => {
  const base = { SESSION_SECRET: "x".repeat(40) };
  assert.equal(loadConfig({ env: base, onWarning() {} }).songCountdownSeconds, 5);
  assert.equal(loadConfig({ env: { ...base, SONG_COUNTDOWN_SECONDS: "10" }, onWarning() {} }).songCountdownSeconds, 10);
  const warnings = [];
  loadConfig({ env: { ...base, SONG_COUNTDOWN_SECONDS: "mucho" }, onWarning: (w) => warnings.push(w) });
  assert.ok(warnings.some((w) => /SONG_COUNTDOWN_SECONDS/.test(w)), "no avisó del valor inválido");
});

test(".env.example documenta SONG_COUNTDOWN_SECONDS", () => {
  assert.match(read(".env.example"), /SONG_COUNTDOWN_SECONDS/);
});

// ---------- la cuenta (public/js/shared.js)

test("la cuenta baja de uno en uno y avisa al llegar a cero", () => {
  const timers = fakeTimers();
  const ticks = [];
  let done = 0;
  const countdown = createCountdown({ onTick: (n, paused) => ticks.push([n, paused]), onDone: () => done++, timers });
  countdown.start(3);
  assert.equal(countdown.active, true);
  timers.advance();
  timers.advance();
  assert.deepEqual(ticks, [[3, false], [2, false], [1, false]]);
  assert.equal(done, 0);
  timers.advance();
  assert.equal(done, 1);
  assert.equal(countdown.active, false);
  assert.equal(timers.pending, false, "no queda nada programado");
});

test("en pausa la cuenta no avanza, y al reanudar sigue donde iba", () => {
  const timers = fakeTimers();
  const ticks = [];
  const countdown = createCountdown({ onTick: (n, paused) => ticks.push([n, paused]), onDone() {}, timers });
  countdown.start(5);
  timers.advance(); // 4
  countdown.pause();
  assert.equal(timers.pending, false, "en pausa no hay nada programado");
  assert.deepEqual(ticks.at(-1), [4, true]);
  countdown.resume();
  assert.deepEqual(ticks.at(-1), [4, false]);
  timers.advance();
  assert.equal(countdown.remaining, 3);
});

test("con los temporizadores de verdad, la cuenta corre aunque setTimeout exija su `this` (como en el navegador)", async (t) => {
  // El setTimeout del navegador lanza "Illegal invocation" si se llama como método de otro objeto; el
  // de Node no, así que aquí se imita al del navegador.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const strict = (real) =>
    function (...args) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return real(...args);
    };
  globalThis.setTimeout = strict(realSetTimeout);
  globalThis.clearTimeout = strict(realClearTimeout);
  t.after(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  const ticks = [];
  const done = new Promise((resolve) => {
    const countdown = createCountdown({ onTick: (n) => ticks.push(n), onDone: resolve });
    countdown.start(1);
    countdown.pause();
    countdown.resume();
  });
  await done;
  assert.deepEqual(ticks, [1, 1, 1]);
});

test("cancelar la cuenta no la termina (no arranca la canción)", () => {
  const timers = fakeTimers();
  let done = 0;
  const countdown = createCountdown({ onTick() {}, onDone: () => done++, timers });
  countdown.start(2);
  countdown.cancel();
  assert.equal(countdown.active, false);
  assert.equal(timers.pending, false);
  assert.equal(done, 0);
  // Pausar o reanudar sin una cuenta en curso no hace nada.
  countdown.pause();
  countdown.resume();
  assert.equal(timers.pending, false);
});

// ---------- el servidor

test("el servidor le dice al host (y solo al host) cuántos segundos contar, antes de la cola", async (t) => {
  const server = await startServer({ env: { SONG_COUNTDOWN_SECONDS: "7" } });
  t.after(() => server.stop());
  const res = await fetch(`${server.baseUrl}/api/rooms`, { method: "POST" });
  const { roomId, hostToken } = await res.json();

  const host = await connectToRoom(`${server.wsUrl}/?sala=${roomId}&hostToken=${hostToken}`);
  t.after(() => host.close());
  const { payload } = await host.rewind().waitFor("hostConfig");
  assert.deepEqual(payload, { countdownSeconds: 7 });
  const types = host.received.map((m) => m.type);
  assert.ok(types.indexOf("hostConfig") < types.indexOf("queueUpdate"), "debe llegar antes que la cola");

  const remoto = await connectToRoom(`${server.wsUrl}/?sala=${roomId}`);
  t.after(() => remoto.close());
  await remoto.rewind().waitFor("queueUpdate");
  assert.ok(!remoto.received.some((m) => m.type === "hostConfig"), "un remoto no la necesita");
});

// ---------- el reproductor nativo (player/lib/hostLogic.js)

const A = { id: "a", song: "Queen - Bohemian Rhapsody.mp4", name: "Ana" };
const B = { id: "b", song: "x.mp4", title: "Persiana Americana", name: "Beto" };

function setupNative({ seconds = 3 } = {}) {
  const timers = fakeTimers();
  const sent = [];
  let changes = 0;
  const player = {
    loaded: false,
    paused: false,
    loads: [],
    resumes: 0,
    async load(url, start, { paused = false } = {}) {
      this.loaded = true;
      this.paused = paused;
      this.loads.push({ url, start, paused });
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
      this.resumes++;
    },
    stop() {
      this.loaded = false;
    },
  };
  const logic = createHostLogic({
    player,
    send: (m) => sent.push(m),
    resolveSongUrl: async (song) => `http://servidor/${song}`,
    onChange: () => changes++,
    log: { error() {} },
    timers,
  });
  logic.handleMessage({ type: "hostConfig", payload: { countdownSeconds: seconds } });
  const queue = (...items) => logic.handleMessage({ type: "queueUpdate", payload: items });
  const control = (payload) => logic.handleMessage({ type: "controlAction", payload });
  const flush = () => new Promise((r) => setImmediate(r));
  return { logic, player, sent, timers, queue, control, flush, changes: () => changes };
}

test("nativo: la canción se abre en pausa, cuenta y arranca al llegar a cero", async () => {
  const { logic, player, sent, timers, queue, flush } = setupNative({ seconds: 3 });
  queue(A);
  await flush();
  assert.deepEqual(player.loads, [{ url: `http://servidor/${A.song}`, start: 0, paused: true }]);
  assert.deepEqual(logic.countdown, { remaining: 3, paused: false });
  assert.equal(logic.isPaused(), false, "para los remotos, la cuenta es 'sonando'");
  assert.deepEqual(sent.filter((m) => m.type === "playbackState").at(-1), { type: "playbackState", payload: { paused: false } });
  timers.advance();
  timers.advance();
  assert.equal(player.resumes, 0);
  timers.advance();
  assert.equal(logic.countdown, null);
  assert.equal(player.resumes, 1, "al llegar a cero se reanuda el video");
});

test("nativo: pausar desde un remoto detiene la cuenta, y reanudar la sigue", async () => {
  const { logic, player, sent, timers, queue, control, flush } = setupNative();
  queue(A);
  await flush();
  control({ action: "pause" });
  assert.deepEqual(logic.countdown, { remaining: 3, paused: true });
  assert.equal(logic.isPaused(), true);
  assert.deepEqual(sent.at(-1), { type: "playbackState", payload: { paused: true } });
  assert.equal(timers.pending, false);
  assert.equal(player.paused, true, "el video sigue quieto");
  control({ action: "play" });
  assert.deepEqual(logic.countdown, { remaining: 3, paused: false });
  assert.deepEqual(sent.at(-1), { type: "playbackState", payload: { paused: false } });
  control({ action: "playPause" });
  assert.equal(logic.countdown.paused, true);
});

test("nativo: saltar durante la cuenta la cancela y no arranca el video", async () => {
  const { logic, player, sent, timers, queue, control, flush } = setupNative();
  queue(A, B);
  await flush();
  control({ action: "skip", id: A.id });
  assert.equal(logic.countdown, null);
  assert.equal(timers.pending, false);
  assert.equal(player.resumes, 0);
  assert.deepEqual(sent.at(-1), { type: "playNext" });
  // La siguiente tiene su propia cuenta desde el principio.
  queue(B);
  await flush();
  assert.deepEqual(logic.countdown, { remaining: 3, paused: false });
});

test("nativo: el cambio de pausa del video durante la cuenta no se reporta como pausa", async () => {
  const { logic, sent, queue, flush } = setupNative();
  queue(A);
  await flush();
  const before = sent.length;
  logic.onPauseChange(true); // lo que avisaría mpv al abrir el video en pausa
  assert.equal(sent.length, before);
});

test("nativo: al retomar una canción tras un error no se vuelve a contar", async () => {
  const { logic, player, timers, queue, flush } = setupNative();
  queue(A);
  await flush();
  timers.advance();
  timers.advance();
  timers.advance(); // ya suena
  logic.onError(42);
  queue(A, B); // el siguiente cambio de la cola la reintenta
  await flush();
  assert.deepEqual(player.loads.at(-1), { url: `http://servidor/${A.song}`, start: 42, paused: false });
  assert.equal(logic.countdown, null);
});

test("nativo: sin hostConfig (o con 0) no hay cuenta", async () => {
  const { logic, player, queue, flush } = setupNative({ seconds: 0 });
  queue(A);
  await flush();
  assert.equal(player.loads[0].paused, false);
  assert.equal(logic.countdown, null);
});

// ---------- la pantalla del reproductor nativo (player/lib/screen.js)

test("nativo: la pantalla de la cuenta muestra el número, quién canta y qué, sin QR", () => {
  const t = (key, params) => translate("es", key, params);
  const songDisplay = (item) => getSongDisplay(item, t("song.unknownArtist"));
  const state = { status: "room", roomId: "ABCD", queue: [A], qrAvailable: true, countdown: { remaining: 4, paused: false } };
  const { ass, qr } = buildScreen(state, { t, songDisplay });
  assert.equal(qr, null);
  assert.match(ass, /\}4$/m, "el número de la cuenta");
  assert.match(ass, /Ahora canta/);
  assert.match(ass, /Ana/);
  assert.match(ass, /Queen — Bohemian Rhapsody/);
  assert.doesNotMatch(ass, /En pausa/);
  const paused = buildScreen({ ...state, countdown: { remaining: 4, paused: true } }, { t, songDisplay });
  assert.match(paused.ass, /En pausa/);
});

// ---------- la pantalla web (public/karaoke.js)

test("web: el host guarda la duración que manda el servidor y cuenta solo al empezar una canción", () => {
  const js = read("public/karaoke.js");
  assert.match(js, /message\.type === "hostConfig"/);
  assert.match(js, /countdownSeconds > 0 && !resuming/, "al retomar tras un error no se cuenta");
  assert.match(js, /countdown\.start\(countdownSeconds\)/);
  assert.match(js, /if \(countdown\.active\) countdown\.pause\(\);/);
  assert.match(js, /if \(countdown\.active\) countdown\.resume\(\);/);
  // Saltar y cambiar de canción cancelan la cuenta.
  assert.ok((js.match(/stopCountdown\(\);/g) || []).length >= 3);
  // Mientras se pedía la URL pudo cambiar la canción de arriba.
  assert.match(js, /if \(currentSongId !== item\.id\) return;/);
});

test("web: la pantalla tiene la cuenta encima del video, con número, quién canta y qué", () => {
  const html = read("public/index.html");
  const overlay = /<div id="countdown-overlay" class="hidden"[\s\S]*?<div id="idle-screen">/.exec(html);
  assert.ok(overlay, "falta #countdown-overlay (oculto al empezar) dentro de la columna del video");
  for (const id of ["countdown-number", "countdown-singer", "countdown-song"]) {
    assert.match(overlay[0], new RegExp(`id="${id}"`), id);
  }
  assert.match(overlay[0], /data-i18n="host\.countdown\.label"/);
  const css = read("public/css/host.css");
  assert.match(css, /@property --leader-sweep/);
  assert.match(css, /prefers-reduced-motion[\s\S]*#countdown-overlay/);
});
