// Lectura de songs.csv (lib/csv.js). El importador partía las filas con split(","), así que
// cualquier campo con coma corrompía artista, título y URL en silencio.
const test = require("node:test");
const assert = require("node:assert/strict");
const { parseCsv, parseSongsCsv, pareceCabecera } = require("../lib/csv");

test("parseCsv separa campos y filas simples", () => {
  assert.deepEqual(parseCsv("a,b,c\nd,e,f"), [["a", "b", "c"], ["d", "e", "f"]]);
});

test("parseCsv respeta las comas dentro de comillas", () => {
  assert.deepEqual(parseCsv('"Tyler, The Creator",EARFQUAKE,http://x/2.mp4'), [
    ["Tyler, The Creator", "EARFQUAKE", "http://x/2.mp4"],
  ]);
});

test("parseCsv entiende las comillas escapadas y los saltos de línea dentro de un campo", () => {
  assert.deepEqual(parseCsv('"dijo ""hola""",b'), [['dijo "hola"', "b"]]);
  assert.deepEqual(parseCsv('"linea1\nlinea2",b'), [["linea1\nlinea2", "b"]]);
});

test("parseCsv acepta CRLF, CR y un salto de línea final sin inventar filas vacías", () => {
  assert.deepEqual(parseCsv("a,b\r\nc,d\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\rc,d"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
});

test("parseCsv se salta el BOM que dejan Excel y algunos editores", () => {
  assert.deepEqual(parseCsv("﻿artista,titulo,url"), [["artista", "titulo", "url"]]);
});

test("parseCsv aguanta lo que no es texto", () => {
  for (const v of [undefined, null, 42, {}]) assert.deepEqual(parseCsv(v), []);
});

test("pareceCabecera pide al menos dos nombres de columna", () => {
  assert.equal(pareceCabecera(["artista", "titulo", "url"]), true);
  assert.equal(pareceCabecera(["Artist", "Title", "URL"]), true, "sin importar mayúsculas");
  assert.equal(pareceCabecera(["Queen", "Bohemian Rhapsody", "http://x/1.mp4"]), false);
  // Una canción que se llame como una columna no debe confundirse con una cabecera.
  assert.equal(pareceCabecera(["Link", "Bohemian Rhapsody", "http://x/1.mp4"]), false);
});

test("parseSongsCsv salta la cabecera en vez de importarla como canción", () => {
  const { songs, cabecera } = parseSongsCsv("artista,titulo,url\nQueen,BR,http://x/1.mp4\n");
  assert.equal(cabecera, true);
  assert.deepEqual(songs.map((s) => s.artist), ["Queen"]);
});

test("parseSongsCsv no salta la primera fila si es una canción de verdad", () => {
  const { songs, cabecera } = parseSongsCsv("Queen,BR,http://x/1.mp4\nSoda,DML,http://x/2.mp4\n");
  assert.equal(cabecera, false);
  assert.equal(songs.length, 2, "no se debe perder la primera canción");
});

// El caso que motivó el issue.
test("parseSongsCsv no corrompe un artista con coma si viene entrecomillado", () => {
  const { songs } = parseSongsCsv('"Tyler, The Creator",EARFQUAKE,http://x/2.mp4');
  assert.equal(songs.length, 1);
  assert.deepEqual(
    { artist: songs[0].artist, title: songs[0].title, url: songs[0].url, filename: songs[0].filename },
    {
      artist: "Tyler, The Creator",
      title: "EARFQUAKE",
      url: "http://x/2.mp4",
      filename: "Tyler, The Creator - EARFQUAKE.mp4",
    }
  );
  assert.equal(songs[0].urlSospechosa, undefined, "entrecomillado, la URL queda bien");
});

test("parseSongsCsv admite una coma dentro de la URL, como siempre", () => {
  const { songs } = parseSongsCsv("Queen,BR,http://x/a,b.mp4");
  assert.equal(songs[0].url, "http://x/a,b.mp4");
});

test("parseSongsCsv arma el filename con el que trabaja toda la aplicación", () => {
  const { songs } = parseSongsCsv("Soda Stereo,De Música Ligera,http://x/1.mp4");
  assert.equal(songs[0].filename, "Soda Stereo - De Música Ligera.mp4");
});

test("parseSongsCsv descarta lo inservible y dice por qué y en qué línea", () => {
  const { songs, descartadas } = parseSongsCsv(
    ["Queen,BR,http://x/1.mp4", "incompleta,solo-dos", ",,", "Soda,DML,http://x/2.mp4"].join("\n")
  );
  assert.deepEqual(songs.map((s) => s.artist), ["Queen", "Soda"]);
  assert.deepEqual(descartadas.map((d) => d.linea), [2, 3]);
  assert.match(descartadas[0].motivo, /tres campos/);
  assert.match(descartadas[1].motivo, /vacío/);
});

test("parseSongsCsv ignora las líneas en blanco sin contarlas como error", () => {
  const { songs, descartadas } = parseSongsCsv("Queen,BR,http://x/1.mp4\n\n\nSoda,DML,http://x/2.mp4\n");
  assert.equal(songs.length, 2);
  assert.deepEqual(descartadas, []);
});

test("parseSongsCsv quita los espacios de alrededor de cada campo", () => {
  const { songs } = parseSongsCsv("  Queen ,  BR  ,  http://x/1.mp4  ");
  assert.deepEqual([songs[0].artist, songs[0].title, songs[0].url], ["Queen", "BR", "http://x/1.mp4"]);
});

test("pareceUrl reconoce lo que puede ser una URL o una ruta", () => {
  const { pareceUrl } = require("../lib/csv");
  for (const v of ["http://x/1.mp4", "https://x/1.mp4", "file:///x.mp4", "/videos/1.mp4", "./1.mp4"]) {
    assert.equal(pareceUrl(v), true, v);
  }
  for (const v of ["EARFQUAKE,http://x/2.mp4", "url", "", "1.mp4"]) {
    assert.equal(pareceUrl(v), false, v);
  }
});

// Una coma SIN comillas es ambigua y no se puede recuperar; lo que sí se puede es dejar de
// corromper en silencio y señalar la línea.
test("parseSongsCsv marca la fila cuando la URL no parece una URL", () => {
  const { songs } = parseSongsCsv("Tyler, The Creator,EARFQUAKE,http://x/2.mp4");
  assert.equal(songs[0].urlSospechosa, true);
  assert.equal(songs[0].linea, 1, "se guarda la línea para poder avisar");

  const { songs: buenas } = parseSongsCsv("Queen,BR,http://x/1.mp4");
  assert.equal(buenas[0].urlSospechosa, undefined, "una URL normal no se marca");
});
