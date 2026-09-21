const test = require("node:test");
const assert = require("node:assert/strict");
const {
  YOUTUBE_ID_RE,
  VIDEO_FORMAT,
  buildSearchQuery,
  normalizeSearchSuffix,
  parseSearchOutput,
  parseVideoInfoOutput,
  parseSearchResultLimit,
  rankByKnownChannels,
} = require("../lib/ytdlp");

test("buildSearchQuery agrega el sufijo karaoke por defecto", () => {
  assert.equal(buildSearchQuery("bohemian rhapsody", "karaoke"), "bohemian rhapsody karaoke");
});

test("buildSearchQuery soporta instrumental y pista", () => {
  assert.equal(buildSearchQuery("hey jude", "instrumental"), "hey jude instrumental");
  assert.equal(buildSearchQuery("hey jude", "pista"), "hey jude pista");
  assert.equal(buildSearchQuery("hey jude", "backing"), "hey jude backing track");
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

test("VIDEO_FORMAT prefiere H.264, cae a cualquier MP4 (AV1) y termina en 'best'", () => {
  const options = VIDEO_FORMAT.split("/");
  assert.match(options[0], /vcodec\^=avc1/);
  assert.doesNotMatch(options[1], /vcodec/);
  assert.equal(options[options.length - 1], "best");
});

test("VIDEO_FORMAT limita la resolución a 720p en las opciones de video separado", () => {
  const separateVideo = VIDEO_FORMAT.split("/").filter((o) => o.startsWith("bestvideo"));
  assert.equal(separateVideo.length, 2);
  separateVideo.forEach((o) => assert.match(o, /height<=720/));
});

test("parseVideoInfoOutput lee duración, título y canal de tres líneas JSON", () => {
  const stdout = '354\n"Queen - Bohemian Rhapsody (Karaoke Version)"\n"Sing King"\n';
  assert.deepEqual(parseVideoInfoOutput(stdout), {
    duration: 354,
    title: "Queen - Bohemian Rhapsody (Karaoke Version)",
    channel: "Sing King",
  });
});

test("parseVideoInfoOutput conserva acentos y comillas tipográficas del título", () => {
  const stdout = '19\n"“Me at the Zoo” — canción más vista"\n"Canal Ñandú"\r\n';
  const info = parseVideoInfoOutput(stdout);
  assert.equal(info.title, "“Me at the Zoo” — canción más vista");
  assert.equal(info.channel, "Canal Ñandú");
});

test("parseVideoInfoOutput devuelve null en los datos que faltan o no son válidos", () => {
  assert.deepEqual(parseVideoInfoOutput("null\nnull\nnull\n"), { duration: null, title: null, channel: null });
  assert.deepEqual(parseVideoInfoOutput('"no es número"\n"   "\n7'), { duration: null, title: null, channel: null });
  assert.deepEqual(parseVideoInfoOutput(""), { duration: null, title: null, channel: null });
});

test("normalizeSearchSuffix acepta solo los sufijos conocidos", () => {
  for (const suffix of ["karaoke", "instrumental", "pista", "backing", "none"]) {
    assert.equal(normalizeSearchSuffix(suffix), suffix);
  }
  for (const suffix of ["otro", "", undefined, null, 5, "__proto__", "toString"]) {
    assert.equal(normalizeSearchSuffix(suffix), null);
  }
});

const video = (id, channel) => ({ id, title: id, channel, duration: 200, thumbnail: null });

test("rankByKnownChannels sube los canales ya descargados y conserva el orden dentro de cada grupo", () => {
  const results = [video("a", "Otro"), video("b", "Karaoke XD"), video("c", "Nuevo"), video("d", "Karaoke XD")];
  const ranked = rankByKnownChannels(results, ["Karaoke XD"]);
  assert.deepEqual(ranked.map((r) => r.id), ["b", "d", "a", "c"]);
});

test("rankByKnownChannels pone primero el canal con más descargas", () => {
  const results = [video("a", "Canal A"), video("b", "Canal B"), video("c", "Canal C")];
  const ranked = rankByKnownChannels(results, ["Canal B", "Canal A", "Canal B"]);
  assert.deepEqual(ranked.map((r) => r.id), ["b", "a", "c"]);
});

test("rankByKnownChannels ignora mayúsculas y acentos del nombre del canal", () => {
  const results = [video("a", "Otro"), video("b", "KARAOKÉ xd ")];
  assert.deepEqual(rankByKnownChannels(results, ["karaoke XD"]).map((r) => r.id), ["b", "a"]);
});

test("rankByKnownChannels no cambia nada sin descargas previas o con canales vacíos", () => {
  const results = [video("a", "Canal A"), video("b", "")];
  assert.deepEqual(rankByKnownChannels(results, []).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(rankByKnownChannels(results, [null, "", undefined]).map((r) => r.id), ["a", "b"]);
});

test("rankByKnownChannels no modifica el arreglo original", () => {
  const results = [video("a", "Otro"), video("b", "Karaoke XD")];
  rankByKnownChannels(results, ["Karaoke XD"]);
  assert.deepEqual(results.map((r) => r.id), ["a", "b"]);
});

test("parseSearchResultLimit usa 5 si la variable no está definida o está vacía", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.deepEqual(parseSearchResultLimit(value), { limit: 5, warning: null });
  }
});

test("parseSearchResultLimit acepta enteros de 5 a 10", () => {
  for (const n of [5, 6, 7, 8, 9, 10]) {
    assert.deepEqual(parseSearchResultLimit(String(n)), { limit: n, warning: null });
  }
  assert.deepEqual(parseSearchResultLimit(" 8 "), { limit: 8, warning: null });
});

test("parseSearchResultLimit ajusta al rango y avisa si el número queda fuera", () => {
  const low = parseSearchResultLimit("3");
  assert.equal(low.limit, 5);
  assert.match(low.warning, /SEARCH_RESULTS/);
  const high = parseSearchResultLimit("25");
  assert.equal(high.limit, 10);
  assert.match(high.warning, /SEARCH_RESULTS/);
});

test("parseSearchResultLimit vuelve a 5 y avisa si el valor no es un entero", () => {
  for (const value of ["abc", "7.5", "-1x", "1e1x"]) {
    const result = parseSearchResultLimit(value);
    assert.equal(result.limit, 5, `valor: ${value}`);
    assert.match(result.warning, /SEARCH_RESULTS/);
  }
});
