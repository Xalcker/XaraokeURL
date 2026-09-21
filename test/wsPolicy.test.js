const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAllowed,
  presentNames,
  canControlPlayback,
  sanitizeControlAction,
  sanitizePlaybackState,
  sanitizePlayNext,
  sanitizeMoveSong,
  sanitizeRating,
  HOST_ONLY_TYPES,
} = require("../lib/wsPolicy");

test("el host puede enviar cualquier mensaje", () => {
  for (const type of ["playNext", "timeUpdate", "playbackState", "addSong", "removeSong", "controlAction", "getQueue", "moveSong", "rateSong"]) {
    assert.equal(isAllowed(type, true), true, type);
  }
});

test("un control remoto no puede pasar de canción, ni informar el tiempo ni el estado", () => {
  for (const type of ["playNext", "timeUpdate", "playbackState"]) {
    assert.equal(isAllowed(type, false), false, type);
  }
  assert.deepEqual([...HOST_ONLY_TYPES].sort(), ["playNext", "playbackState", "timeUpdate"]);
});

test("un control remoto sí puede añadir, quitar, reordenar, calificar, pedir la cola y mandar órdenes de reproducción", () => {
  for (const type of ["addSong", "removeSong", "moveSong", "rateSong", "getQueue", "controlAction"]) {
    assert.equal(isAllowed(type, false), true, type);
  }
});

test("un tipo desconocido, o uno heredado de Object, no se confunde con uno del host", () => {
  for (const type of ["otro", "", undefined, null, "constructor", "__proto__", "toString"]) {
    assert.equal(isAllowed(type, false), true, String(type)); // no está restringido: el servidor lo ignora al no reconocerlo
  }
});

test("sanitizeControlAction acepta las órdenes válidas y conserva solo lo necesario", () => {
  for (const action of ["play", "pause", "playPause"]) {
    assert.deepEqual(sanitizeControlAction({ action }), { action });
  }
  assert.deepEqual(sanitizeControlAction({ action: "skip" }), { action: "skip" });
  assert.deepEqual(sanitizeControlAction({ action: "skip", id: "abc-123" }), { action: "skip", id: "abc-123" });
});

test("sanitizeControlAction descarta campos ajenos y el id en órdenes que no son skip", () => {
  assert.deepEqual(sanitizeControlAction({ action: "pause", id: "abc", extra: { a: 1 } }), { action: "pause" });
  assert.deepEqual(sanitizeControlAction({ action: "skip", id: "abc", extra: "x", __proto__: { x: 1 } }), { action: "skip", id: "abc" });
});

test("sanitizeControlAction rechaza órdenes inválidas", () => {
  for (const bad of [null, undefined, 5, "skip", [], {}, { action: "" }, { action: "apagar" }, { action: 7 }, { action: ["skip"] }, { action: "__proto__" }, { action: "constructor" }]) {
    assert.equal(sanitizeControlAction(bad), null, JSON.stringify(bad));
  }
});

test("sanitizeControlAction ignora un id que no sea texto razonable", () => {
  for (const id of [5, {}, [], "", null, "x".repeat(65)]) {
    assert.deepEqual(sanitizeControlAction({ action: "skip", id }), { action: "skip" }, JSON.stringify(id));
  }
  assert.deepEqual(sanitizeControlAction({ action: "skip", id: "x".repeat(64) }), { action: "skip", id: "x".repeat(64) });
});

test("sanitizePlaybackState solo da por pausado un true de verdad", () => {
  assert.deepEqual(sanitizePlaybackState({ paused: true }), { paused: true });
  assert.deepEqual(sanitizePlaybackState({ paused: false }), { paused: false });
  for (const bad of [null, undefined, 1, "true", {}, { paused: "true" }, { paused: 1 }, { paused: [] }]) {
    assert.deepEqual(sanitizePlaybackState(bad), { paused: false }, JSON.stringify(bad));
  }
});

test("sanitizePlayNext solo da por terminada una canción que acabó sola y dice cuál era", () => {
  assert.deepEqual(sanitizePlayNext({ ended: true, id: "abc-123" }), { ended: true, id: "abc-123" });
  // Saltar manda playNext sin nada: no se pide calificar.
  assert.deepEqual(sanitizePlayNext(undefined), { ended: false, id: null });
  assert.deepEqual(sanitizePlayNext({}), { ended: false, id: null });
  assert.deepEqual(sanitizePlayNext({ ended: false, id: "abc" }), { ended: false, id: null });
  // Sin saber cuál era, tampoco: no se le puede atribuir a nadie.
  assert.deepEqual(sanitizePlayNext({ ended: true }), { ended: true, id: null });
  for (const bad of [null, 1, "true", [], { ended: "true" }, { ended: 1 }]) {
    assert.equal(sanitizePlayNext(bad).ended, false, JSON.stringify(bad));
  }
  for (const id of [5, {}, [], "", null, "x".repeat(65)]) {
    assert.equal(sanitizePlayNext({ ended: true, id }).id, null, JSON.stringify(id));
  }
});

test("sanitizeMoveSong acepta subir o bajar una canción por su id y descarta campos ajenos", () => {
  assert.deepEqual(sanitizeMoveSong({ id: "abc", direction: "up" }), { id: "abc", direction: "up" });
  assert.deepEqual(sanitizeMoveSong({ id: "abc", direction: "down", name: "Otra persona", extra: 1 }), { id: "abc", direction: "down" });
});

test("sanitizeMoveSong rechaza órdenes inválidas", () => {
  for (const bad of [null, undefined, 5, "up", [], {}, { id: "abc" }, { direction: "up" }, { id: "", direction: "up" }, { id: 7, direction: "up" }, { id: "abc", direction: "left" }, { id: "abc", direction: ["up"] }, { id: "x".repeat(65), direction: "up" }]) {
    assert.equal(sanitizeMoveSong(bad), null, JSON.stringify(bad));
  }
});

test("sanitizeRating acepta 1 (bien), -1 (mal) y 0 (ahora no), y solo eso", () => {
  for (const value of [1, -1, 0]) {
    assert.deepEqual(sanitizeRating({ id: "abc", value }), { id: "abc", value });
  }
  assert.deepEqual(sanitizeRating({ id: "abc", value: 1, name: "Otra persona", songKey: "yt:x" }), { id: "abc", value: 1 });
  for (const bad of [null, undefined, 5, "1", [], {}, { id: "abc" }, { value: 1 }, { id: "", value: 1 }, { id: 7, value: 1 }, { id: "abc", value: 2 }, { id: "abc", value: -5 }, { id: "abc", value: "1" }, { id: "abc", value: true }, { id: "abc", value: NaN }, { id: "x".repeat(65), value: 1 }]) {
    assert.equal(sanitizeRating(bad), null, JSON.stringify(bad));
  }
});

// ---------- quién puede pausar, reanudar y saltar

const queue = [
  { id: "1", name: "Ana", song: "A - Uno.mp4" },
  { id: "2", name: "Beto", song: "B - Dos.mp4" },
];

test("quien canta la canción que suena puede controlarla, esté o no en la lista de conectados", () => {
  assert.equal(canControlPlayback(queue, "Ana", new Set(["Ana", "Beto"])), true);
  assert.equal(canControlPlayback(queue, "Ana", new Set()), true);
});

test("los demás no pueden controlar la canción de alguien que sigue conectado", () => {
  assert.equal(canControlPlayback(queue, "Beto", new Set(["Ana", "Beto"])), false);
  assert.equal(canControlPlayback(queue, "Carla", new Set(["Ana", "Carla"])), false);
  // Ser dueño de una canción que espera no da control sobre la que suena.
  assert.equal(canControlPlayback([queue[0], queue[1]], "Beto", new Set(["Ana"])), false);
});

test("si quien canta ya no está conectado, cualquiera puede controlar su canción", () => {
  assert.equal(canControlPlayback(queue, "Beto", new Set(["Beto"])), true);
  assert.equal(canControlPlayback(queue, "Carla", new Set()), true);
});

test("sin canción sonando no hay nada que controlar", () => {
  for (const empty of [[], undefined, null, "no es una lista", {}]) {
    assert.equal(canControlPlayback(empty, "Ana", new Set(["Ana"])), false, JSON.stringify(empty));
  }
});

test("un nombre vacío o ausente no cuenta como ser el dueño", () => {
  const anonymous = [{ id: "9", name: "", song: "X - Y.mp4" }];
  for (const name of [null, undefined, "", 5]) {
    assert.equal(canControlPlayback(anonymous, name, new Set([""])), false, String(name));
  }
  // Una canción sin dueño conocido (ni conectado) la puede controlar cualquiera, como si se hubiera ido.
  assert.equal(canControlPlayback([{ id: "9", song: "X - Y.mp4" }], "Ana", new Set(["Ana"])), true);
});

// ---------- quién cuenta como presente (tiempo de gracia)

const GRACE = 120 * 1000;
const NOW = 1_000_000;

test("presentNames: los conectados cuentan siempre, aunque nadie los haya visto irse", () => {
  assert.deepEqual([...presentNames(new Set(["Ana"]), new Map(), 0, NOW, GRACE)], ["Ana"]);
  assert.deepEqual([...presentNames(new Set(["Ana"]), new Map([["Ana", 0]]), 0, NOW, 0)], ["Ana"]);
});

test("presentNames: quien se fue hace menos del tiempo de gracia sigue contando; al cumplirse, ya no", () => {
  const leftAt = new Map([["Ana", NOW - GRACE + 1]]);
  assert.equal(presentNames(new Set(), leftAt, 0, NOW, GRACE).has("Ana"), true);
  assert.equal(presentNames(new Set(), new Map([["Ana", NOW - GRACE]]), 0, NOW, GRACE).has("Ana"), false);
  assert.equal(presentNames(new Set(), new Map([["Ana", NOW - 10 * GRACE]]), 0, NOW, GRACE).has("Ana"), false);
});

test("presentNames: el tiempo se cuenta desde que empezó su canción si eso es más reciente que su desconexión", () => {
  // Se fue hace mucho (bloqueó el celular esperando su turno), pero su canción empezó hace poco.
  const leftAt = new Map([["Ana", NOW - 10 * GRACE]]);
  assert.equal(presentNames(new Set(), leftAt, NOW - 1000, NOW, GRACE).has("Ana"), true, "acaba de empezar su canción");
  assert.equal(presentNames(new Set(), leftAt, NOW - GRACE, NOW, GRACE).has("Ana"), false, "su gracia desde que empezó ya venció");
  // Y si se fue después de que empezó su canción, cuenta desde que se fue.
  assert.equal(presentNames(new Set(), new Map([["Ana", NOW - 1000]]), NOW - 10 * GRACE, NOW, GRACE).has("Ana"), true);
});

test("presentNames: con gracia 0 quien se fue deja de contar de inmediato", () => {
  assert.equal(presentNames(new Set(), new Map([["Ana", NOW]]), NOW, NOW, 0).has("Ana"), false);
});

test("presentNames no modifica lo que recibe", () => {
  const connected = new Set(["Ana"]);
  const leftAt = new Map([["Beto", NOW]]);
  presentNames(connected, leftAt, 0, NOW, GRACE);
  assert.deepEqual([...connected], ["Ana"]);
  assert.deepEqual([...leftAt], [["Beto", NOW]]);
});

test("con la gracia vigente, los demás no pueden controlar; al vencer, sí", () => {
  const q = [{ id: "1", name: "Ana", song: "A - Uno.mp4" }];
  const during = presentNames(new Set(["Beto"]), new Map([["Ana", NOW - 1000]]), 0, NOW, GRACE);
  assert.equal(canControlPlayback(q, "Beto", during), false);
  const after = presentNames(new Set(["Beto"]), new Map([["Ana", NOW - 2 * GRACE]]), 0, NOW, GRACE);
  assert.equal(canControlPlayback(q, "Beto", after), true);
  // Ana, mientras tanto, sigue pudiendo controlar la suya al volver.
  assert.equal(canControlPlayback(q, "Ana", during), true);
});

// --- pruneLeftAt: limpieza del registro de quién se fue y cuándo ---

const { pruneLeftAt, presentNames: presentes } = require("../lib/wsPolicy");

const cola = (...nombres) => nombres.map((name, i) => ({ id: `s${i}`, name, song: `${name}.mp4` }));

test("pruneLeftAt conserva a quien todavía tiene una canción en la cola", () => {
  const leftAt = new Map([["Ana", 1000], ["Beto", 2000]]);
  const limpio = pruneLeftAt(leftAt, cola("Ana"));
  assert.deepEqual([...limpio.keys()], ["Ana"]);
  assert.equal(limpio.get("Ana"), 1000, "se conserva el momento original, no se reinicia");
});

test("pruneLeftAt quita a quien ya no tiene nada en la cola", () => {
  const leftAt = new Map([["Ana", 1000], ["Beto", 2000], ["Caro", 3000]]);
  assert.equal(pruneLeftAt(leftAt, cola()).size, 0, "con la cola vacía no queda nadie");
  assert.deepEqual([...pruneLeftAt(leftAt, cola("Caro")).keys()], ["Caro"]);
});

test("pruneLeftAt no modifica el Map que recibe", () => {
  const leftAt = new Map([["Ana", 1000]]);
  pruneLeftAt(leftAt, cola());
  assert.equal(leftAt.size, 1);
});

test("pruneLeftAt aguanta una cola ausente o que no es un arreglo", () => {
  const leftAt = new Map([["Ana", 1000]]);
  for (const queue of [undefined, null, "no soy una cola", 42]) {
    assert.equal(pruneLeftAt(leftAt, queue).size, 0, JSON.stringify(queue));
  }
});

// Esta es la razón por la que pruneLeftAt mira la cola y no el reloj: una entrada vencida hace
// rato vuelve a valer cuando la canción de esa persona llega a sonar (headSince se renueva).
test("pruneLeftAt no purga por tiempo vencido: una entrada vieja revive al llegar su turno", () => {
  const GRACE = 120000;
  const ahora = 1000000;
  const leftAt = new Map([["Ana", ahora - 3600000]]); // se fue hace una hora

  assert.equal(presentes(new Set(), leftAt, ahora - 3600000, ahora, GRACE).has("Ana"), false,
    "su canción aún no suena: está ausente");
  assert.equal(presentes(new Set(), leftAt, ahora, ahora, GRACE).has("Ana"), true,
    "su canción empieza a sonar: recupera la gracia aunque se fuera hace una hora");

  // Por eso solo se borra cuando ya no tiene nada que pueda llegar a sonar.
  assert.equal(pruneLeftAt(leftAt, cola("Ana")).size, 1);
  assert.equal(pruneLeftAt(leftAt, cola("Beto")).size, 0);
});
