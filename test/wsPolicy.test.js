const test = require("node:test");
const assert = require("node:assert/strict");
const { isAllowed, sanitizeControlAction, sanitizePlaybackState, HOST_ONLY_TYPES } = require("../lib/wsPolicy");

test("el host puede enviar cualquier mensaje", () => {
  for (const type of ["playNext", "timeUpdate", "playbackState", "addSong", "removeSong", "controlAction", "getQueue"]) {
    assert.equal(isAllowed(type, true), true, type);
  }
});

test("un control remoto no puede pasar de canción, ni informar el tiempo ni el estado", () => {
  for (const type of ["playNext", "timeUpdate", "playbackState"]) {
    assert.equal(isAllowed(type, false), false, type);
  }
  assert.deepEqual([...HOST_ONLY_TYPES].sort(), ["playNext", "playbackState", "timeUpdate"]);
});

test("un control remoto sí puede añadir, quitar, pedir la cola y mandar órdenes de reproducción", () => {
  for (const type of ["addSong", "removeSong", "getQueue", "controlAction"]) {
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
