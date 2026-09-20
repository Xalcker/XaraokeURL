const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, parseSongFilename } = require("../public/js/shared");

test("escapeHtml neutraliza caracteres especiales de HTML", () => {
  assert.equal(
    escapeHtml(`<script>alert('xss')</script> & "comillas"`),
    "&lt;script&gt;alert(&#39;xss&#39;)&lt;/script&gt; &amp; &quot;comillas&quot;"
  );
});

test("parseSongFilename separa artista y título simples", () => {
  assert.deepEqual(parseSongFilename("Queen - Bohemian Rhapsody.mp4"), {
    artist: "Queen",
    songTitle: "Bohemian Rhapsody",
  });
});

test("parseSongFilename conserva ' - ' dentro del título en vez de truncarlo", () => {
  // Bug real que existía en remote.js: usaba split(" - ")[1] y perdía todo
  // lo que viniera después del segundo segmento.
  assert.deepEqual(
    parseSongFilename("Michael Jackson - Say Say Say - 2015 Remaster.mp4"),
    { artist: "Michael Jackson", songTitle: "Say Say Say - 2015 Remaster" }
  );
});

test("parseSongFilename maneja un filename sin separador", () => {
  assert.deepEqual(parseSongFilename("cancion-sin-formato.mp4"), {
    artist: "Desconocido",
    songTitle: "cancion-sin-formato",
  });
});
