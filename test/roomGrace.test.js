// Tiempo de gracia de las salas vacías, recuperación de la sala por el host y aviso en vivo de las
// descargas. La política (lib/roomPolicy.js) se prueba directo; el cableado en el servidor, el host y el
// remoto son comprobaciones sobre el código fuente: que las reglas sigan estando donde deben. El
// comportamiento completo (WebSocket real, dos salas) se probó a mano contra un servidor real.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_GRACE_MINUTES,
  parseRoomGrace,
  roomSweepIntervalMs,
  isRoomExpired,
} = require("../lib/roomPolicy");
const { MESSAGES } = require("../public/js/i18n");

const MIN = 60 * 1000;
const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const serverJs = read("server.js");
const hostJs = read("public", "karaoke.js");
const remoteJs = read("public", "remote.js");
const indexHtml = read("public", "index.html");

test("parseRoomGrace usa 10 minutos si la variable no está definida o está vacía", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.deepEqual(parseRoomGrace(value), { graceMs: DEFAULT_GRACE_MINUTES * MIN, warning: null });
  }
  assert.equal(DEFAULT_GRACE_MINUTES, 10);
});

test("parseRoomGrace acepta minutos enteros y decimales", () => {
  assert.deepEqual(parseRoomGrace("30"), { graceMs: 30 * MIN, warning: null });
  assert.deepEqual(parseRoomGrace(" 0.5 "), { graceMs: 30 * 1000, warning: null });
  assert.deepEqual(parseRoomGrace(2), { graceMs: 2 * MIN, warning: null });
});

test("parseRoomGrace con 0 no da tiempo de gracia", () => {
  assert.deepEqual(parseRoomGrace("0"), { graceMs: 0, warning: null });
});

test("parseRoomGrace vuelve al valor por defecto y avisa si el valor no es válido", () => {
  for (const value of ["abc", "-5", "NaN", "Infinity", "10 min"]) {
    const result = parseRoomGrace(value);
    assert.equal(result.graceMs, DEFAULT_GRACE_MINUTES * MIN, value);
    assert.match(result.warning, /ROOM_GRACE_MINUTES/, value);
  }
});

test("roomSweepIntervalMs es una cuarta parte de la gracia, entre 5 y 60 segundos", () => {
  assert.equal(roomSweepIntervalMs(10 * MIN), 60 * 1000);
  assert.equal(roomSweepIntervalMs(2 * MIN), 30 * 1000);
  assert.equal(roomSweepIntervalMs(4000), 5000);
  assert.equal(roomSweepIntervalMs(0), 5000);
});

test("una sala vence solo si lleva la gracia entera sin conexiones", () => {
  const grace = 10 * MIN;
  const now = 1_000_000_000;
  assert.equal(isRoomExpired({ emptySince: now - grace + 1 }, now, grace), false);
  assert.equal(isRoomExpired({ emptySince: now - grace }, now, grace), true);
  assert.equal(isRoomExpired({ emptySince: now - 3 * grace }, now, grace), true);
});

test("una sala con alguien conectado nunca vence, por vieja que sea", () => {
  assert.equal(isRoomExpired({ emptySince: null }, Number.MAX_SAFE_INTEGER, 1), false);
});

test("el servidor empieza la cuenta al quedarse vacía y la cancela cuando alguien se conecta", () => {
  assert.match(serverJs, /emptySince: Date\.now\(\)/, "una sala recién creada empieza vacía");
  assert.match(serverJs, /room\.clients\.add\(ws\);\s*room\.emptySince = null;/, "conectarse la salva");
  assert.match(serverJs, /room\.emptySince = Date\.now\(\);/, "al irse el último empieza la gracia");
  assert.match(serverJs, /isRoomExpired\(room, now, ROOM_GRACE_MS\)/, "el barrido usa la política");
});

test("al irse el último cliente la sala ya no se borra al momento, salvo con ROOM_GRACE_MINUTES=0", () => {
  const closeHandler = serverJs.slice(serverJs.indexOf('ws.on("close"'));
  assert.match(closeHandler, /if \(ROOM_GRACE_MS === 0\) \{\s*delete rooms\[roomId\];/);
  assert.match(closeHandler, /else \{\s*room\.emptySince = Date\.now\(\);/);
});

test("el servidor deja recuperar la sala solo con el token del host", () => {
  const start = serverJs.indexOf('app.post("/api/rooms/:roomId/resume"');
  assert.ok(start >= 0, "falta el endpoint para recuperar la sala");
  const handler = serverJs.slice(start, serverJs.indexOf("});", start));
  assert.match(handler, /hostToken !== room\.hostToken/);
  assert.match(handler, /status\(404\)/);
});

test("si se recupera la sala, el host anterior se desconecta con 4006 y la sala avisa que volvió", () => {
  assert.match(serverJs, /previousHost\.close\(4006, "Host replaced"\)/);
  assert.match(serverJs, /type: "hostStatus", payload: \{ connected: true \}/);
});

test("el host guarda la sala en el navegador y ofrece recuperarla al abrir la página", () => {
  assert.match(hostJs, /localStorage\.setItem\(SAVED_ROOM_KEY/);
  assert.match(hostJs, /\/api\/rooms\/\$\{encodeURIComponent\(saved\.roomId\)\}\/resume/);
  assert.match(hostJs, /offerSavedRoom\(\)/);
  assert.match(indexHtml, /id="resume-btn"/);
  assert.match(hostJs, /enterRoom\(saved\.roomId, saved\.hostToken\)/);
});

test("el host olvida la sala guardada cuando ya no existe", () => {
  assert.match(hostJs, /if \(room\) showSavedRoomOffer\(saved, room\.queueLength\);\s*else forgetSavedRoom\(\);/);
  assert.match(hostJs, /event\.code === 4004\) \{\s*forgetSavedRoom\(\);/);
});

test("el host que fue reemplazado no reconecta (dos hosts se quitarían el control sin parar)", () => {
  const onclose = hostJs.slice(hostJs.indexOf("ws.onclose"), hostJs.indexOf("ws.onerror"));
  assert.match(onclose, /event\.code === 4006\) \{[^}]*return;/s);
});

test("el remoto avisa cuando el host regresó, y solo si antes se había caído", () => {
  assert.match(remoteJs, /const hostReturned = connected && !hostConnected;/);
  assert.match(remoteJs, /if \(hostReturned\) showToast\("toast\.hostBack"\)/);
});

test("el servidor avisa a los remotos de todas las salas, no al host, cuando cambia la lista de descargas", () => {
  const start = serverJs.indexOf("function notifyDownloadsChanged()");
  assert.ok(start >= 0);
  const body = serverJs.slice(start, serverJs.indexOf("\n}\n", start));
  assert.match(body, /for \(const room of Object\.values\(rooms\)\)/);
  assert.match(body, /!client\.isHost/);
  assert.match(body, /type: "downloadsChanged"/);
  // Toda alta o baja del índice de descargas debe avisar. El índice es un Map (ver #30).
  assert.match(serverJs, /downloadedVideos\.set\(filename, entry\);\s*notifyDownloadsChanged\(\);/);
  assert.match(serverJs, /downloadedVideos\.delete\(filename\);\s*notifyDownloadsChanged\(\);/);
});

test("el remoto actualiza la lista de descargas al recibir el aviso, sin tocar otras pantallas", () => {
  assert.match(remoteJs, /message\.type === "downloadsChanged"\) refreshDownloadsLive\(\)/);
  const start = remoteJs.indexOf("async function refreshDownloadsLive()");
  assert.ok(start >= 0);
  const body = remoteJs.slice(start, remoteJs.indexOf("\n    }\n", start));
  assert.match(body, /showingLocalSearch\(\)\) renderSearchResults\(query\)/);
  assert.match(body, /renderAlphabet\(\)/);
});

test("los textos nuevos existen en todos los idiomas", () => {
  const keys = [
    "host.resume", "host.resumeQueue", "host.startNew", "host.resuming", "host.resumeFailed",
    "host.resumeError", "host.roomLost", "host.replaced", "toast.hostBack", "api.roomGone",
  ];
  for (const lang of Object.keys(MESSAGES)) {
    for (const key of keys) assert.ok(MESSAGES[lang][key], `${lang}: falta ${key}`);
  }
});
