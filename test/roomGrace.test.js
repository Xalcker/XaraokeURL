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
const { serverSource } = require("../test-helpers/serverSources");
// Todo el servidor junto: server.js + src/ (ver #36 y test-helpers/serverSources.js).
const serverJs = serverSource();
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

test("el remoto recuerda la última sala y vuelve a entrar sola al recargar", () => {
  assert.match(remoteJs, /localStorage\.setItem\(SAVED_ROOM_KEY, roomCode\)/);
  // Solo se guarda una vez confirmado que la sala existe.
  assert.match(remoteJs, /if \(data\.exists\) \{\s*saveRoom\(roomCode\);/);
  // Un enlace con ?sala= manda sobre la sala recordada.
  assert.match(remoteJs, /if \(signedIn && !joinFromLink\(\)\) rejoinSavedRoom\(\);/);
  const rejoin = remoteJs.slice(remoteJs.indexOf("function rejoinSavedRoom()"), remoteJs.indexOf("function dropRoomFromLink()"));
  assert.match(rejoin, /autoJoining = true;\s*roomForm\.requestSubmit\(\)/);
  // En modo desarrollo sin nombre no se entra sola: la persona elige su nombre.
  assert.match(rejoin, /devMode && !myName\) \{\s*devNameInput\.focus\(\);\s*return;/);
});

test("el remoto olvida la sala recordada cuando ya no existe y pide un código nuevo", () => {
  assert.match(remoteJs, /if \(loadSavedRoom\(\) === roomCode\) forgetSavedRoom\(\);/);
  assert.match(remoteJs, /automatic \? "remote\.join\.savedRoomGone" : "remote\.join\.roomMissing"/);
  assert.match(remoteJs, /if \(action === "roomGone"\) forgetSavedRoom\(\);/);
});

test("el remoto deja cambiar de sala sin cerrar sesión", () => {
  assert.match(read("public", "remote.html"), /<button type="button" id="leave-room-btn"/);
  assert.match(remoteJs, /leaveRoomBtn\.addEventListener\("click", \(\) => \{\s*forgetSavedRoom\(\);\s*window\.location\.href = window\.location\.pathname;/);
});

test("el servidor avisa a los remotos de todas las salas, no al host, cuando cambia la lista de descargas", () => {
  const start = serverJs.indexOf("function notifyDownloadsChanged()");
  assert.ok(start >= 0);
  const body = serverJs.slice(start, serverJs.indexOf("\n}\n", start));
  assert.match(body, /salas\.all\(\)/, "debe recorrer todas las salas, no solo una");
  assert.match(body, /!client\.isHost/);
  assert.match(body, /type: "downloadsChanged"/);
  // Toda alta o baja del índice de descargas debe avisar. El índice es un Map (ver #30).
  // El índice de descargas vive en src/downloads.js y avisa con el callback onChange, que el
  // arranque conecta con notifyDownloadsChanged (así no hay require circular).
  assert.match(serverJs, /entries\.set\(filename, entry\);\s*onChange\(\);/, "un alta debe avisar");
  assert.match(serverJs, /entries\.delete\(filename\);\s*onChange\(\);/, "una baja debe avisar");
  assert.match(serverJs, /onChange: \(\) => avisarCambioDescargas\(\)/, "el aviso se conecta al arrancar");
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
    "remote.join.savedRoomGone", "remote.leaveRoom",
  ];
  for (const lang of Object.keys(MESSAGES)) {
    for (const key of keys) assert.ok(MESSAGES[lang][key], `${lang}: falta ${key}`);
  }
});
