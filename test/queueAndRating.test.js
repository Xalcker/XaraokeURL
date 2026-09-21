// Reordenar la cola propia y calificar el karaoke al terminar una canción.
// Son comprobaciones sobre el código fuente: que las reglas sigan estando donde deben. El comportamiento
// completo (host y varios remotos por WebSocket) se probó a mano contra un servidor real.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ICON_NAMES } = require("../public/js/icons");
const { MESSAGES } = require("../public/js/i18n");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const remoteHtml = read("public", "remote.html");
const remoteJs = read("public", "remote.js");
const remoteCss = read("public", "css", "remote.css");
const hostJs = read("public", "karaoke.js");
const serverJs = read("server.js");

// Cuerpo de una función `function nombre(...) { ... }` o de un `case "x": { ... }`.
function bodyFrom(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `no se encontró: ${marker}`);
  const open = source.indexOf("{", source.indexOf(marker) + (marker.startsWith("case") ? marker.length : source.slice(start).indexOf(")")));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`llaves sin cerrar en ${marker}`);
}

// ---------- íconos

test("existen los íconos de subir, bajar y pulgares", () => {
  for (const name of ["arrow-up", "arrow-down", "thumb-up", "thumb-down"]) {
    assert.ok(ICON_NAMES.includes(name), `falta el ícono ${name}`);
  }
});

// ---------- reordenar

test("el servidor mueve solo las canciones de quien lo pide, con el nombre de su conexión (no el del mensaje)", () => {
  const move = bodyFrom(serverJs, 'case "moveSong"');
  assert.match(move, /moveOwnSong\(currentRoom\.songQueue, move\.id, ws\.userName, move\.direction\)/);
  assert.match(move, /!ws\.userName\) return/, "sin identidad no se mueve nada");
  assert.doesNotMatch(move, /payload\.name/, "el nombre nunca debe salir del cliente");
});

test("el servidor fija el nombre de cada conexión al conectarse, según su sesión", () => {
  assert.match(serverJs, /ws\.userName = isAuthenticated\s*\?\s*AUTH_DISABLED\s*\?\s*req\.session\?\.devName \|\| devUserName\(req\)\s*:\s*req\.session\.passport\.user\.displayName\s*:\s*null;/);
});

test("los botones de mover solo aparecen si tienes más de una canción en espera, y se deshabilitan en los extremos", () => {
  const render = bodyFrom(remoteJs, "function renderQueue(queue)");
  assert.match(render, /const waiting = queue\.slice\(1\)/, "la que suena (la primera) no se puede mover");
  assert.match(render, /if \(mineAt\.length > 1\)/);
  assert.match(render, /"arrow-up", "remote\.queue\.moveUp", position > 0/);
  assert.match(render, /"arrow-down", "remote\.queue\.moveDown", position < mineAt\.length - 1/);
});

test("los botones de solo ícono de mover tienen nombre accesible y avisan si no hay conexión", () => {
  const create = bodyFrom(remoteJs, "function createMoveButton(");
  assert.match(create, /setAttribute\("aria-label", label\)/);
  assert.match(create, /sendMessage\("moveSong", \{ id: item\.id, direction \}\)\) showToast\("toast\.offline"\)/);
  assert.match(remoteCss, /\.move-btn:disabled\s*\{[^}]*cursor:\s*not-allowed/);
});

// ---------- calificar

test("solo se pide calificar cuando la canción terminó sola y era la que el host tenía cargada", () => {
  const playNext = bodyFrom(serverJs, 'case "playNext"');
  assert.match(playNext, /sanitizePlayNext\(data\.payload\)/);
  assert.match(playNext, /if \(finished && ended && id === finished\.id\) requestRating\(ws\.roomId, finished\)/);
});

test("el host avisa que terminó una canción por sí sola; saltar no lo hace", () => {
  assert.match(hostJs, /player\.addEventListener\("ended", \(\) => send\(\{ type: "playNext", payload: \{ ended: true, id: currentSongId \} \}\)\)/);
  const handler = bodyFrom(hostJs, "function handleControlAction(payload)");
  const skip = handler.slice(handler.indexOf('case "skip":'));
  assert.match(skip, /send\(\{ type: "playNext" \}\)/);
  assert.doesNotMatch(skip, /ended/);
});

test("solo quien cantó la canción puede calificarla, con el nombre de su conexión", () => {
  const rating = bodyFrom(serverJs, "async function handleRating(");
  assert.match(rating, /!ws\.userName\) return/);
  assert.match(rating, /p\.id === rating\.id && p\.name === ws\.userName/);
  assert.match(rating, /rater: pending\.name/, "la calificación se guarda a nombre de quien cantó, no de un dato del mensaje");
  assert.match(rating, /songKey: pending\.songKey/, "la clave la decide el servidor, no el cliente");
});

test("la petición de calificar le llega solo a los remotos de quien cantó (nunca al host) y se reenvía al reconectar", () => {
  assert.match(bodyFrom(serverJs, "function sendToUser("), /!client\.isHost && client\.userName === name/);
  assert.match(serverJs, /if \(ws\.userName && !isHost\) \{\s*room\.pendingRatings\s*\.filter\(\(pending\) => pending\.name === ws\.userName\)/);
});

test("la canción se identifica por el video de YouTube, no por el archivo (que se borra con el tiempo)", () => {
  const key = bodyFrom(serverJs, "function songKeyOf(");
  assert.match(key, /`yt:\$\{download\.videoId\}`/);
  assert.match(key, /`lib:\$\{filename\}`/);
});

test("si la base de calificaciones no abre, el servidor arranca y no pide calificar", () => {
  const init = bodyFrom(serverJs, "async function initRatings(");
  assert.match(init, /catch \(err\)/);
  assert.doesNotMatch(init, /process\.exit|throw/);
  assert.match(serverJs, /if \(!room \|\| !ratingsStore \|\| !item\.name\) return;/);
});

test("la tarjeta de calificar empieza oculta, tiene pulgar arriba y abajo con texto, y una salida", () => {
  const card = /<div\b[^>]*id="rating-card"[^>]*>/.exec(remoteHtml);
  assert.ok(card);
  assert.match(card[0], /class="[^"]*\bhidden\b/);
  assert.match(card[0], /aria-labelledby="rating-title"/);
  for (const [id, icon, key] of [["rating-up", "thumb-up", "rating.up"], ["rating-down", "thumb-down", "rating.down"]]) {
    const button = new RegExp(`<button\\b[^>]*id="${id}"[^>]*>([\\s\\S]*?)</button>`).exec(remoteHtml);
    assert.ok(button, `falta #${id}`);
    assert.match(button[1], new RegExp(`data-icon="${icon}"`));
    assert.match(button[1], new RegExp(`data-i18n="${key}"`), "el pulgar lleva también su texto, no solo el ícono");
  }
  assert.match(remoteHtml, /<button\b[^>]*id="rating-skip"[^>]*data-i18n="rating\.skip"/);
});

test("el texto aclara que se califica el karaoke (video y música), no el canto", () => {
  assert.match(MESSAGES.es["rating.hint"], /video y la música, no cómo cantaste/);
  assert.match(MESSAGES.en["rating.hint"], /video and the music, not your singing/);
  assert.match(remoteHtml, /id="rating-hint" data-i18n="rating\.hint"/);
});

test("el remoto envía 1, -1 o 0 (ahora no), no se traga una calificación sin conexión y no repite peticiones", () => {
  assert.match(remoteJs, /ratingUp\.addEventListener\("click", \(\) => answerRating\(1\)\)/);
  assert.match(remoteJs, /ratingDown\.addEventListener\("click", \(\) => answerRating\(-1\)\)/);
  assert.match(remoteJs, /ratingSkip\.addEventListener\("click", \(\) => answerRating\(0\)\)/);
  const answer = bodyFrom(remoteJs, "function answerRating(value)");
  assert.match(answer, /!sendMessage\("rateSong", \{ id: current\.id, value \}\)\) \{\s*showToast\("toast\.offline"\);\s*return;/);
  assert.match(bodyFrom(remoteJs, "function addRatingRequest(request)"), /ratingRequests\.some\(\(r\) => r\.id === request\.id\)\) return/);
  assert.match(remoteJs, /message\.type === "ratingRequest"/);
  assert.match(remoteJs, /message\.type === "ratingResolved"/);
});

test("el pulgar arriba usa el acento con texto oscuro y sigue legible al pasar el cursor", () => {
  const rule = /\.rating-btn-up\s*\{([^}]*)\}/.exec(remoteCss);
  assert.ok(rule);
  assert.match(rule[1], /background-color:\s*var\(--accent\)/);
  assert.match(rule[1], /color:\s*var\(--on-accent\)/);
  assert.match(remoteCss, /\.rating-btn-up:hover\s*\{[^}]*var\(--accent-hover\)/);
});
