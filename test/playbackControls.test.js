// Controles de reproducción en la interfaz: qué se ve y qué se puede tocar en el host y en el
// control remoto. Son comprobaciones sobre el código fuente de las pantallas.
//
// Lo que hace cumplir el servidor (solo el host manda playNext/timeUpdate/playbackState, solo
// quien canta puede pausar o saltar, el estado de pausa que se recuerda para quien entre
// después) ya no se comprueba aquí: se ejercita de verdad en test/wsQueue.test.js, contra un
// servidor real y con varios clientes conectados.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const remoteHtml = read("public", "remote.html");
const remoteJs = read("public", "remote.js");
const remoteCss = read("public", "css", "remote.css");
const hostHtml = read("public", "index.html");
const hostJs = read("public", "karaoke.js");

// Cuerpo de una función `function nombre(...) { ... }` o de un listener `xxx.addEventListener("evento", ... => { ... })`.
function bodyFrom(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `no se encontró: ${marker}`);
  const open = source.indexOf("{", source.indexOf(")", start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`llaves sin cerrar en ${marker}`);
}

// ---------- remoto: botón de play/pausa

test("play/pausa tiene los dos íconos y arranca como 'sonando' con nombre accesible traducible", () => {
  const button = /<button\b[^>]*id="playPauseBtn"[^>]*>[\s\S]*?<\/button>/.exec(remoteHtml);
  assert.ok(button);
  assert.match(button[0], /data-state="playing"/);
  assert.match(button[0], /class="icon-play"/);
  assert.match(button[0], /class="icon-pause"/);
  assert.match(button[0], /aria-label="[^"]+"/);
  assert.match(button[0], /data-i18n-aria-label="remote\.pause"/);
});

test("el CSS muestra solo el ícono de la acción que hará el botón", () => {
  assert.match(remoteCss, /#playPauseBtn\[data-state="playing"\] \.icon-play,\s*#playPauseBtn\[data-state="paused"\] \.icon-pause\s*\{\s*display:\s*none/);
  assert.match(remoteCss, /#controls \.control-btn:disabled\s*\{[^}]*cursor:\s*not-allowed/);
});

test("el remoto pide 'play' o 'pause' según el estado que ve, no 'alternar'", () => {
  const handler = bodyFrom(remoteJs, 'playPauseBtn.addEventListener("click"');
  assert.match(handler, /playbackPaused \? "play" : "pause"/);
  assert.doesNotMatch(handler, /playPause"/);
});

test("el estado de los controles sale de lo que informa el host, del host conectado y de la cola", () => {
  assert.match(remoteJs, /message\.type === "playbackState"/);
  const update = bodyFrom(remoteJs, "function updateControls()");
  assert.match(update, /hostConnected && currentQueue\.length > 0/);
  assert.match(update, /const usable = active && controlAllowed;/);
  assert.match(update, /playPauseBtn\.disabled = !usable/);
  assert.match(update, /dataset\.state = paused \? "paused" : "playing"/);
});

test("los botones de reproducción solo se habilitan si el servidor dice que se puede, y se explica por qué no", () => {
  // Arranca en "no": hasta que el servidor lo diga, no se ofrece nada que él rechazaría.
  assert.match(remoteJs, /let controlAllowed = false;/);
  assert.match(remoteJs, /controlAllowed = message\.payload\?\.allowed === true;/);
  const update = bodyFrom(remoteJs, "function updateControls()");
  assert.match(update, /controlsLocked\.classList\.toggle\("hidden", !active \|\| controlAllowed\)/);
  const hint = /<div\b[^>]*id="controls-locked"[^>]*>/.exec(remoteHtml);
  assert.ok(hint, "falta el aviso de por qué están deshabilitados");
  assert.match(hint[0], /class="hidden"/);
  assert.match(hint[0], /data-i18n="remote\.controlsLocked"/);
});

test("si el permiso se pierde con una confirmación de saltar abierta, esta se cierra", () => {
  const access = remoteJs.slice(remoteJs.indexOf('message.type === "controlAccess"'));
  assert.match(access.slice(0, 500), /!controlAllowed && confirmSkipId\) confirmModalCancel\.click\(\)/);
});

test("el remoto no finge que hizo algo cuando no hay conexión", () => {
  assert.match(remoteJs, /function sendMessage\(type, payload\)\s*\{\s*if \(!ws \|\| ws\.readyState !== WebSocket\.OPEN\) return false;/);
  assert.doesNotMatch(remoteJs, /\bws\.send\(JSON\.stringify\(\{ type: "(addSong|removeSong|controlAction)"/, "quedó un ws.send directo que lanzaría una excepción al reconectar");
});

// ---------- remoto: saltar con confirmación

test("saltar pide confirmación ANTES de enviar la orden, con el id de la canción que se vio", () => {
  const handler = bodyFrom(remoteJs, 'skipBtn.addEventListener("click"');
  // La asignación exacta: que la respuesta de la persona sea lo que decide (no un valor fijo).
  const confirm = handler.indexOf("const confirmed = await showConfirm(");
  const send = handler.indexOf('sendMessage("controlAction", { action: "skip", id: head.id })');
  assert.ok(confirm >= 0, "el botón de saltar ya no pide confirmación");
  assert.ok(send > confirm, "la orden de saltar se envía antes de confirmar (o sin id)");
  assert.match(handler, /!confirmed \|\| currentQueue\[0\]\?\.id !== head\.id\) return/, "debe cancelar si la canción cambió mientras se decidía");
  assert.match(handler, /danger: true/);
});

test("la confirmación abierta se cierra sola si la canción de arriba cambia, y el botón no admite doble toque", () => {
  const queue = bodyFrom(remoteJs, "function renderQueue(queue)");
  assert.match(queue, /confirmSkipId && queue\[0\]\?\.id !== confirmSkipId\) confirmModalCancel\.click\(\)/);
  assert.match(queue, /skipPendingId && queue\[0\]\?\.id !== skipPendingId\) clearSkipPending\(\)/);
  assert.match(bodyFrom(remoteJs, "function updateControls()"), /skipBtn\.disabled = !usable \|\| skipPendingId !== null/);
});

test("quitar una canción de tu cola pide confirmación ANTES de enviar la orden y se cierra si la canción ya no espera", () => {
  const handler = bodyFrom(remoteJs, "async function confirmAndRemove(item)");
  const confirm = handler.indexOf("const confirmed = await showConfirm(");
  const send = handler.indexOf('sendMessage("removeSong", { id: item.id })');
  assert.ok(confirm >= 0, "el botón de quitar ya no pide confirmación");
  assert.ok(send > confirm, "la orden de quitar se envía antes de confirmar");
  assert.match(handler, /!confirmed \|\|/);
  assert.match(remoteJs, /removeBtn\.onclick = \(\) => confirmAndRemove\(item\)/, "el botón no debe enviar removeSong directo");
  assert.match(bodyFrom(remoteJs, "function renderQueue(queue)"), /confirmRemoveId && !waiting\.some\(\(item\) => item\.id === confirmRemoveId\)\) confirmModalCancel\.click\(\)/);
});

test("el botón de confirmar de una acción que afecta a todos es rojo y con texto blanco legible", () => {
  const rule = /\.confirm-btn-danger\s*\{([^}]*)\}/.exec(remoteCss);
  assert.ok(rule, "falta .confirm-btn-danger");
  assert.match(rule[1], /background-color:\s*var\(--danger-banner\)/); // blanco sobre este rojo: 5,4:1
  assert.match(rule[1], /color:\s*#fff/);
});

// ---------- host

test("el host reanuda o pausa con órdenes explícitas y salta solo si sigue siendo la canción que se confirmó", () => {
  const handler = bodyFrom(hostJs, "function handleControlAction(payload)");
  assert.match(handler, /case "play":/);
  assert.match(handler, /case "pause":/);
  assert.match(handler, /case "playPause":/, "se conserva la orden de alternar de versiones anteriores del remoto");
  assert.match(handler, /if \(payload\.id && currentQueue\[0\]\?\.id !== payload\.id\) break;/);
});

test("añadir una canción no reinicia la que está en pausa: solo se carga la de arriba si es otra", () => {
  const check = bodyFrom(hostJs, "function checkAndPlayNext()");
  assert.match(check, /if \(head\.id === currentSongId\) return;/);
  assert.doesNotMatch(check, /player\.paused/, "decidir por player.paused reinicia la canción en pausa");
  assert.match(bodyFrom(hostJs, "async function playSong("), /currentSongId = null/, "si no se pudo cargar, debe poder reintentarse");
});

test("el host informa play y pausa, sin confundir el fin de la canción ni el vaciado con una pausa", () => {
  assert.match(hostJs, /player\.addEventListener\("play", \(\) => reportPlayback\(false\)\)/);
  const pause = bodyFrom(hostJs, 'player.addEventListener("pause"');
  assert.match(pause, /player\.ended \|\| !player\.getAttribute\("src"\)\) return/);
  assert.match(pause, /reportPlayback\(true\)/);
  assert.match(bodyFrom(hostJs, "ws.onopen = () =>"), /playbackState/, "al conectar, el host informa su estado");
});

test("el aviso 'En pausa' del host va sobre el video, debajo de la pantalla de espera, y empieza oculto", () => {
  const overlay = hostHtml.indexOf('id="paused-overlay"');
  const idle = hostHtml.indexOf('id="idle-screen"');
  const video = hostHtml.indexOf('id="karaokePlayer"');
  assert.ok(video < overlay && overlay < idle, "orden inesperado (el aviso debe ir entre el video y la pantalla de espera)");
  assert.match(/<div\b[^>]*id="paused-overlay"[^>]*>/.exec(hostHtml)[0], /class="[^"]*\bhidden\b/);
});

// ---------- servidor

