const test = require("node:test");
const assert = require("node:assert/strict");
const { escapeHtml, parseSongFilename, getSongDisplay } = require("../public/js/shared");

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

test("getSongDisplay usa el título de YouTube cuando el ítem lo trae", () => {
  assert.deepEqual(
    getSongDisplay({ song: "b1cb4b3e-eade-4727-b804-06937d8b7561.mp4", title: "Me at the zoo" }),
    { artist: "YouTube", songTitle: "Me at the zoo" }
  );
});

test("getSongDisplay deriva artista y título del filename en canciones del catálogo", () => {
  assert.deepEqual(getSongDisplay({ song: "Queen - Bohemian Rhapsody.mp4" }), {
    artist: "Queen",
    songTitle: "Bohemian Rhapsody",
  });
});

test("getSongDisplay ignora un título vacío, nulo o solo con espacios", () => {
  for (const title of ["", "   ", null, undefined]) {
    assert.deepEqual(getSongDisplay({ song: "Queen - Bohemian Rhapsody.mp4", title }), {
      artist: "Queen",
      songTitle: "Bohemian Rhapsody",
    });
  }
});
