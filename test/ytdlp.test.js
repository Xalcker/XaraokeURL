const test = require("node:test");
const assert = require("node:assert/strict");
const {
  YOUTUBE_ID_RE,
  buildSearchQuery,
  parseSearchOutput,
} = require("../lib/ytdlp");

test("buildSearchQuery agrega el sufijo karaoke por defecto", () => {
  assert.equal(buildSearchQuery("bohemian rhapsody", "karaoke"), "bohemian rhapsody karaoke");
});

test("buildSearchQuery soporta instrumental y pista", () => {
  assert.equal(buildSearchQuery("hey jude", "instrumental"), "hey jude instrumental");
  assert.equal(buildSearchQuery("hey jude", "pista"), "hey jude pista");
});

test("buildSearchQuery sin sufijo deja la query intacta", () => {
  assert.equal(buildSearchQuery("hey jude", "none"), "hey jude");
});

test("buildSearchQuery cae a karaoke si el sufijo no es válido", () => {
  assert.equal(buildSearchQuery("hey jude", "algo-raro"), "hey jude karaoke");
});

test("YOUTUBE_ID_RE valida el formato de 11 caracteres", () => {
  assert.equal(YOUTUBE_ID_RE.test("dQw4w9WgXcQ"), true);
  assert.equal(YOUTUBE_ID_RE.test("corto"), false);
  assert.equal(YOUTUBE_ID_RE.test("con espacios "), false);
  assert.equal(YOUTUBE_ID_RE.test("../../etc/passwd"), false);
});

test("parseSearchOutput parsea JSON-lines y descarta entradas inválidas", () => {
  const stdout = [
    JSON.stringify({ id: "dQw4w9WgXcQ", title: "Canción 1", channel: "Canal A", duration: 213 }),
    "",
    "esto no es json",
    JSON.stringify({ id: "corto", title: "ID inválido, se descarta" }),
    JSON.stringify({ id: "abcdefghijk", title: "Canción 2", thumbnails: [{ url: "a.jpg" }, { url: "b.jpg" }] }),
  ].join("\n");

  const results = parseSearchOutput(stdout);
  assert.equal(results.length, 2);
  assert.deepEqual(results[0], {
    id: "dQw4w9WgXcQ",
    title: "Canción 1",
    channel: "Canal A",
    duration: 213,
    thumbnail: null,
  });
  assert.equal(results[1].thumbnail, "b.jpg");
  assert.equal(results[1].duration, null);
});

test("parseSearchOutput usa 'Sin título' si falta el título", () => {
  const stdout = JSON.stringify({ id: "dQw4w9WgXcQ" });
  const results = parseSearchOutput(stdout);
  assert.equal(results[0].title, "Sin título");
});
