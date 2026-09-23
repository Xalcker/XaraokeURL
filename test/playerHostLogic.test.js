// Las reglas de host del reproductor nativo (player/lib/hostLogic.js), con un reproductor de
// mentira. Son las mismas que sigue public/karaoke.js: si una cambia allá, esta prueba debe cambiar.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHostLogic } = require("../player/lib/hostLogic");

const A = { id: "a", song: "Queen - Bohemian Rhapsody.mp4", name: "Ana" };
const B = { id: "b", song: "x.mp4", title: "Persiana Americana", name: "Beto" };

function setup({ failUrl = false } = {}) {
  const sent = [];
  const player = {
    loaded: false,
    paused: false,
    loads: [],
    stops: 0,
    async load(url, start) {
      this.loaded = true;
      this.paused = false;
      this.loads.push({ url, start });
    },
    pause() {
      this.paused = true;
    },
    resume() {
      this.paused = false;
    },
    stop() {
      this.loaded = false;
      this.stops++;
    },
  };
  const logic = createHostLogic({
    player,
    send: (m) => sent.push(m),
    resolveSongUrl: async (song) => {
      if (failUrl) throw new Error("sin red");
      return `http://servidor/${song}`;
    },
    log: { error() {} },
  });
  const queue = (...items) => logic.handleMessage({ type: "queueUpdate", payload: items });
  const control = (payload) => logic.handleMessage({ type: "controlAction", payload });
  const tick = () => new Promise((r) => setImmediate(r));
  return { logic, player, sent, queue, control, tick };
}

test("carga la primera de la cola, y no la recarga si solo se agregan canciones", async () => {
  const { player, queue, tick } = setup();
  queue(A);
  await tick();
  assert.deepEqual(player.loads, [{ url: `http://servidor/${A.song}`, start: 0 }]);
  queue(A, B);
  await tick();
  assert.equal(player.loads.length, 1, "la que suena no se reinicia");
});

test("al terminar sola avisa cuál era; al vaciarse la cola se detiene", async () => {
  const { logic, player, sent, queue, tick } = setup();
  queue(A, B);
  await tick();
  logic.onEnded();
  assert.deepEqual(sent.at(-1), { type: "playNext", payload: { ended: true, id: "a" } });
  queue(B);
  await tick();
  assert.equal(player.loads.at(-1).url, `http://servidor/${B.song}`);
  queue();
  assert.equal(player.loaded, false);
});

test("pausa, reanuda y alterna solo si hay algo cargado", async () => {
  const { player, control, queue, tick } = setup();
  control({ action: "pause" });
  assert.equal(player.paused, false, "sin canción no hay nada que pausar");
  queue(A);
  await tick();
  control({ action: "pause" });
  assert.equal(player.paused, true);
  control({ action: "play" });
  assert.equal(player.paused, false);
  control({ action: "playPause" });
  assert.equal(player.paused, true);
});

test("saltar: solo la canción que vio el remoto, y pide la siguiente", async () => {
  const { player, sent, control, queue, tick } = setup();
  queue(A, B);
  await tick();
  control({ action: "skip", id: "b" }); // ya no es la que suena: se ignora
  assert.equal(player.loaded, true);
  assert.equal(sent.length, 0);
  control({ action: "skip", id: "a" });
  assert.equal(player.loaded, false);
  assert.deepEqual(sent.at(-1), { type: "playNext" });
});

test("los cambios de pausa y el avance se le avisan al servidor", async () => {
  const { logic, sent, queue, tick } = setup();
  queue(B);
  await tick();
  logic.onPauseChange(true);
  assert.deepEqual(sent.at(-1), { type: "playbackState", payload: { paused: true } });
  logic.onTime(10, 200, 5000);
  assert.deepEqual(sent.at(-1), {
    type: "timeUpdate",
    payload: { currentTime: 10, duration: 200, song: B.song, title: B.title },
  });
  const count = sent.length;
  logic.onTime(10.5, 200, 5500);
  assert.equal(sent.length, count, "como mucho uno por segundo");
  logic.onTime(11, 200, 6000);
  assert.equal(sent.length, count + 1, "pero un intervalo de ~1 s no se salta");
});

test("tras un error retoma la misma canción donde iba cuando la cola vuelve a cambiar", async () => {
  const { logic, player, queue, tick } = setup();
  queue(A);
  await tick();
  player.loaded = false;
  logic.onError(42.5);
  queue(A, B);
  await tick();
  assert.deepEqual(player.loads.at(-1), { url: `http://servidor/${A.song}`, start: 42.5 });
});

test("si no consigue la URL, lo reintenta con el siguiente cambio de la cola", async () => {
  const s = setup({ failUrl: true });
  s.queue(A);
  await s.tick();
  assert.equal(s.player.loads.length, 0);
  s.queue(A, B);
  await s.tick();
  assert.equal(s.player.loads.length, 0, "sigue sin red, pero lo intentó de nuevo sin romperse");
});

test("al conectarse cuenta si está en pausa", async () => {
  const { logic, sent, control, queue, tick } = setup();
  logic.onConnected();
  assert.deepEqual(sent.at(-1), { type: "playbackState", payload: { paused: false } });
  queue(A);
  await tick();
  control({ action: "pause" });
  logic.onConnected();
  assert.deepEqual(sent.at(-1), { type: "playbackState", payload: { paused: true } });
});
