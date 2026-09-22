// El QR lleva la sala en el enlace y el teléfono entra directo con ella. Son comprobaciones sobre el
// código fuente (la regla sigue donde debe); el recorrido completo se probó con un servidor real.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const { serverSource } = require("../test-helpers/serverSources");
// Todo el servidor junto: server.js + src/ (ver #36 y test-helpers/serverSources.js).
const serverJs = serverSource();
const remoteJs = fs.readFileSync(path.join(ROOT, "public", "remote.js"), "utf8");
const hostJs = fs.readFileSync(path.join(ROOT, "public", "karaoke.js"), "utf8");

// Cuerpo de la función o del handler que empieza en `marker`.
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

test("la pantalla principal pide el QR de su sala", () => {
  assert.match(hostJs, /fetch\(`\/api\/qr\?sala=\$\{roomId\}`\)/);
});

test("sin sesión, la sala del enlace se guarda antes de ir a Google y se recupera al volver", () => {
  assert.match(serverJs, /app\.use\("\/remote\.html", ensureAuthenticatedRemote\)/);
  const guard = bodyFrom(serverJs, "function ensureAuthenticatedRemote(");
  assert.match(guard, /!req\.isAuthenticated\(\)/);
  assert.match(guard, /req\.session\.joinRoomId = roomId/);
  assert.match(guard, /normalizeRoomId\(req\.query\.sala\)/);
  // Passport renueva la sesión al iniciar sesión: sin keepSessionInfo se perdería la sala guardada.
  const callback = serverJs.slice(serverJs.lastIndexOf('"/auth/google/callback"'));
  assert.match(callback.slice(0, 600), /keepSessionInfo: true/);
  assert.match(callback.slice(0, 900), /normalizeRoomId\(req\.session\.joinRoomId\)/);
  assert.match(callback.slice(0, 900), /`\/remote\.html\?sala=\$\{roomId\}`/);
});

test("el remoto pone el código del enlace y entra solo cuando el nombre lo da la cuenta", () => {
  const join = bodyFrom(remoteJs, "function joinFromLink()");
  assert.match(join, /URLSearchParams\(window\.location\.search\)\.get\("sala"\)/);
  assert.match(join, /!\/\^\[A-Z\]\{4\}\$\/\.test\(roomCode\)\) return false/, "un código con mala forma debe ignorarse");
  assert.match(join, /roomCodeInput\.value = roomCode/);
  assert.match(join, /if \(devMode\)/);
  assert.match(join, /roomForm\.requestSubmit\(\)/);
  // Solo después de comprobar la sesión: sin ella la página ya está yendo a /login.
  // Y el enlace manda sobre la sala recordada (ver roomGrace.test.js).
  assert.match(remoteJs, /initializeAppFlow\(\)\.then\(\(signedIn\) => \{\s*if \(signedIn && !joinFromLink\(\)\) rejoinSavedRoom\(\);/);
  assert.match(bodyFrom(remoteJs, "async function initializeAppFlow()"), /return false;/);
});
