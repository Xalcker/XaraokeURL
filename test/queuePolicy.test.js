const test = require("node:test");
const assert = require("node:assert/strict");
const { moveOwnSong } = require("../lib/queuePolicy");

const item = (id, name) => ({ id, name, song: `${id}.mp4` });
const ids = (queue) => queue.map((i) => i.id);

// Suena "a" (Ana). En espera: b (Beto), c (Ana), d (Beto), e (Ana).
const queue = () => [item("a", "Ana"), item("b", "Beto"), item("c", "Ana"), item("d", "Beto"), item("e", "Ana")];

test("subir intercambia con la canción anterior de la misma persona, sin mover las de los demás", () => {
  // e (Ana) sube: toma el lugar de c y c pasa al de e; b y d (Beto) no cambian de turno.
  assert.deepEqual(ids(moveOwnSong(queue(), "e", "Ana", "up")), ["a", "b", "e", "d", "c"]);
});

test("bajar intercambia con la siguiente canción de la misma persona", () => {
  assert.deepEqual(ids(moveOwnSong(queue(), "c", "Ana", "down")), ["a", "b", "e", "d", "c"]);
});

test("las canciones de otras personas quedan exactamente en su lugar", () => {
  const moved = moveOwnSong(queue(), "e", "Ana", "up");
  assert.equal(moved[1].id, "b");
  assert.equal(moved[3].id, "d");
});

test("la canción que suena no se mueve ni se puede pasar por encima de ella", () => {
  // "a" es de Ana y suena: no se puede mover, y c (la primera de Ana en espera) no puede subir a su lugar.
  assert.equal(moveOwnSong(queue(), "a", "Ana", "down"), null);
  assert.equal(moveOwnSong(queue(), "a", "Ana", "up"), null);
  assert.equal(moveOwnSong(queue(), "c", "Ana", "up"), null);
});

test("no se puede subir la primera de tus canciones en espera ni bajar la última", () => {
  assert.equal(moveOwnSong(queue(), "c", "Ana", "up"), null);
  assert.equal(moveOwnSong(queue(), "e", "Ana", "down"), null);
  assert.equal(moveOwnSong(queue(), "b", "Beto", "up"), null);
  assert.equal(moveOwnSong(queue(), "d", "Beto", "down"), null);
});

test("solo puedes mover tus propias canciones", () => {
  assert.equal(moveOwnSong(queue(), "b", "Ana", "down"), null);
  assert.equal(moveOwnSong(queue(), "d", "Ana", "up"), null);
});

test("con una sola canción tuya en espera no hay nada que ordenar", () => {
  const q = [item("a", "Ana"), item("b", "Beto"), item("c", "Ana")];
  assert.equal(moveOwnSong(q, "c", "Ana", "up"), null);
  assert.equal(moveOwnSong(q, "c", "Ana", "down"), null);
});

test("un id que ya no está en la cola (se quitó o ya sonó) no mueve nada", () => {
  assert.equal(moveOwnSong(queue(), "zzz", "Ana", "up"), null);
});

test("no modifica la cola original", () => {
  const original = queue();
  moveOwnSong(original, "e", "Ana", "up");
  assert.deepEqual(ids(original), ["a", "b", "c", "d", "e"]);
});

test("varias canciones seguidas: cada movimiento avanza un lugar entre las tuyas", () => {
  let q = [item("x", "Zoe"), item("a1", "Ana"), item("a2", "Ana"), item("a3", "Ana")];
  q = moveOwnSong(q, "a3", "Ana", "up");
  assert.deepEqual(ids(q), ["x", "a1", "a3", "a2"]);
  q = moveOwnSong(q, "a3", "Ana", "up");
  assert.deepEqual(ids(q), ["x", "a3", "a1", "a2"]);
  assert.equal(moveOwnSong(q, "a3", "Ana", "up"), null);
});

test("rechaza datos inválidos sin lanzar", () => {
  assert.equal(moveOwnSong(queue(), "e", "Ana", "sideways"), null);
  assert.equal(moveOwnSong(queue(), "e", "Ana", undefined), null);
  assert.equal(moveOwnSong(queue(), "e", "", "up"), null);
  assert.equal(moveOwnSong(queue(), "e", undefined, "up"), null);
  assert.equal(moveOwnSong(queue(), "e", null, "up"), null);
  assert.equal(moveOwnSong(null, "e", "Ana", "up"), null);
  assert.equal(moveOwnSong([], "e", "Ana", "up"), null);
});
