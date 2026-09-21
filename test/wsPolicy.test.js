const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAllowed,
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
