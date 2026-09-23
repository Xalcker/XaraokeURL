// Qué dibuja el reproductor nativo en cada situación (player/lib/screen.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { translate } = require("../public/js/i18n.js");
const { getSongDisplay } = require("../public/js/shared.js");
const { buildScreen, qrPixels, assEscape } = require("../player/lib/screen");

const t = (key, params) => translate("es", key, params);
const songDisplay = (item) => getSongDisplay(item, t("song.unknownArtist"));
const opts = { t, songDisplay };

const ANA = { id: "1", song: "Queen - Bohemian Rhapsody.mp4", name: "Ana" };
const BETO = { id: "2", song: "x.mp4", title: "Soda Stereo - Persiana Americana", name: "Beto" };
const room = (extra) => ({
  status: "room",
  roomId: "ABCD",
  remoteUrl: "http://192.168.1.50:8081/remote.html",
  queue: [],
  paused: false,
  qrAvailable: true,
  ...extra,
});

test("sin canciones: QR grande al centro, código de sala y cómo entrar", () => {
  const { ass, qr } = buildScreen(room(), opts);
  assert.equal(qr.centerX, 0.5);
  assert.ok(qr.size > 0.3, "el QR de espera es grande");
  assert.match(ass, /ABCD/);
  assert.match(ass, /Escanea el código para elegir tu canción/);
  assert.match(ass, /192\.168\.1\.50:8081\/remote\.html/);
  assert.doesNotMatch(ass, /http:\/\//, "la dirección va sin http://, como en el navegador");
});

test("durante una canción: quién canta, qué canción, quién sigue y el QR chico en la esquina", () => {
  const { ass, qr } = buildScreen(room({ queue: [ANA, BETO] }), opts);
  assert.ok(qr.size < 0.3 && qr.right !== undefined && qr.bottom !== undefined, "QR chico, abajo a la derecha");
  assert.match(ass, /Ahora Suena/);
  assert.match(ass, /Ana/);
  assert.match(ass, /Queen — Bohemian Rhapsody/);
  assert.match(ass, /A Continuación: \{\\b1\}Beto/);
  assert.match(ass, /YouTube — Soda Stereo - Persiana Americana/, "las descargas usan su título");
  assert.match(ass, /Sala: ABCD/);
  assert.doesNotMatch(ass, /En pausa/);
});

test("quién canta va arriba a la izquierda; quién sigue, abajo a la izquierda; el código, sobre el QR", () => {
  const { ass } = buildScreen(room({ queue: [ANA, BETO] }), opts);
  const at = (text) => new RegExp(`\\{\\\\an(\\d)\\\\pos\\((\\d+),(\\d+)\\)\\}[^\\n]*${text}`).exec(ass);
  const singer = at("Ana");
  assert.equal(singer[1], "7", "quién canta: arriba a la izquierda");
  assert.ok(Number(singer[3]) < 100);
  const upNext = at("A Continuación");
  assert.equal(upNext[1], "1", "quién sigue: anclado abajo a la izquierda");
  assert.ok(Number(upNext[2]) < 100 && Number(upNext[3]) > 650, "pegado a la esquina de abajo");
  const code = at("Sala: ABCD");
  assert.equal(code[1], "2", "el código va centrado sobre el QR");
  assert.ok(Number(code[2]) > 1100, "del lado derecho");
  assert.ok(Number(code[3]) < 720 - 0.2 * 720, "por encima del QR");
});

test("la última canción no muestra quién sigue; en pausa se avisa al centro", () => {
  const { ass } = buildScreen(room({ queue: [ANA], paused: true }), opts);
  assert.doesNotMatch(ass, /A Continuación/);
  assert.match(ass, /\\an5[^}]*\}\{[^}]*\}En pausa/);
});

test("sin QR (el servidor no lo dio) queda el código de sala solo, y no se pide dibujar QR", () => {
  const idle = buildScreen(room({ qrAvailable: false }), opts);
  assert.equal(idle.qr, null);
  assert.match(idle.ass, /ABCD/);
  const playing = buildScreen(room({ qrAvailable: false, queue: [ANA] }), opts);
  assert.equal(playing.qr, null);
  assert.match(playing.ass, /Sala: ABCD/);
});

test("conectando y pantalla reemplazada: solo un aviso, sin QR", () => {
  const connecting = buildScreen({ status: "connecting", serverUrl: "http://10.0.0.2:8081/" }, opts);
  assert.equal(connecting.qr, null);
  assert.match(connecting.ass, /Conectando con el servidor http:\/\/10\.0\.0\.2:8081\/\.\.\./);
  const replaced = buildScreen({ status: "replaced" }, opts);
  assert.match(replaced.ass, /Otra pantalla tomó el control/);
});

test("lo que escribe la gente no se cuela como órdenes de ASS", () => {
  assert.equal(assEscape("{\\fs200}Hola"), "\\{\\​fs200\\}Hola");
  assert.equal(assEscape("uno\ndos"), "uno dos", "un salto de línea no parte el texto");
  const { ass } = buildScreen(room({ queue: [{ ...ANA, name: "{\\an5\\fs300}Troll" }] }), opts);
  assert.doesNotMatch(ass, /\{\\an5\\fs300\}/);
});

test("los textos largos se recortan para no pasar por debajo del QR", () => {
  const long = { ...ANA, name: "N".repeat(80), song: `${"A".repeat(50)} - ${"T".repeat(80)}.mp4` };
  const { ass } = buildScreen(room({ queue: [long] }), opts);
  assert.doesNotMatch(ass, /N{31}/, "el nombre no pasa de 30 caracteres");
  assert.match(ass, /N{29}…/);
  assert.doesNotMatch(ass, /T{20}/, "el título se corta");
});

test("qrPixels pasa las fracciones a píxeles de la pantalla real", () => {
  const idle = buildScreen(room(), opts).qr;
  const big = qrPixels(idle, 1280, 720);
  assert.equal(big.left, Math.round(640 - big.size / 2), "centrado");
  const corner = buildScreen(room({ queue: [ANA] }), opts).qr;
  const small = qrPixels(corner, 1920, 1080);
  assert.ok(small.left + small.size <= 1920 && small.left + small.size > 1920 - 60, "pegado a la derecha");
  assert.ok(small.top + small.size <= 1080 && small.top + small.size > 1080 - 60, "pegado abajo");
  assert.equal(small.size, Math.round(corner.size * 1080));
});
