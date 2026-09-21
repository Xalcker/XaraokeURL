// Tiempo de gracia de quien canta (SINGER_GRACE_SECONDS): cuánto se espera a que vuelva, tras perder la
// conexión, antes de que los demás puedan pausar o saltar su canción.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DEFAULT_SINGER_GRACE_SECONDS, parseSingerGrace } = require("../lib/roomPolicy");

const ROOT = path.join(__dirname, "..");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

test("parseSingerGrace usa 120 segundos si la variable no está definida o está vacía", () => {
  assert.equal(DEFAULT_SINGER_GRACE_SECONDS, 120);
  for (const value of [undefined, null, "", "   "]) {
    assert.deepEqual(parseSingerGrace(value), { graceMs: 120 * 1000, warning: null }, JSON.stringify(value));
  }
});

test("parseSingerGrace acepta segundos enteros y decimales, y 0 para no dar gracia", () => {
  assert.deepEqual(parseSingerGrace("30"), { graceMs: 30 * 1000, warning: null });
  assert.deepEqual(parseSingerGrace(" 1.5 "), { graceMs: 1500, warning: null });
  assert.deepEqual(parseSingerGrace(45), { graceMs: 45 * 1000, warning: null });
  assert.deepEqual(parseSingerGrace("0"), { graceMs: 0, warning: null });
});

test("parseSingerGrace vuelve al valor por defecto y avisa si el valor no es válido", () => {
  for (const value of ["abc", "-5", "NaN", "Infinity", "1,5", "2 min"]) {
    const result = parseSingerGrace(value);
    assert.equal(result.graceMs, 120 * 1000, value);
    assert.match(result.warning, /SINGER_GRACE_SECONDS/, value);
  }
});

test("el servidor lee SINGER_GRACE_SECONDS y avisa si es inválido", () => {
  assert.match(serverJs, /parseSingerGrace\(\s*process\.env\.SINGER_GRACE_SECONDS\s*\)/);
  assert.match(serverJs, /if \(singerGraceWarning\) console\.warn/);
});

test("cada sala lleva quién se fue y desde cuándo suena la canción de arriba", () => {
  assert.match(serverJs, /leftAt: new Map\(\),\s*headId: null,\s*headSince: 0,/);
});

test("al irse alguien se anota cuándo (si no le queda otro dispositivo) y se avisa cuando venza su gracia", () => {
  const close = serverJs.slice(serverJs.indexOf('ws.on("close"'));
  assert.match(close, /!ws\.isHost && ws\.userName && !connectedNames\(room\)\.has\(ws\.userName\)/);
  assert.match(close, /room\.leftAt\.set\(ws\.userName, Date\.now\(\)\);\s*scheduleAccessRecheck\(roomId, room\);/);
  assert.match(close, /if \(!ws\.isHost\) sendControlAccess\(room\);/);
});

test("al conectarse alguien deja de contar como ausente", () => {
  assert.match(serverJs, /if \(ws\.userName\) room\.leftAt\.delete\(ws\.userName\);/);
});

test("cuando cambia la canción de arriba se reinicia su cuenta y se vuelve a avisar al vencer", () => {
  const start = serverJs.indexOf("function broadcastQueue(");
  const body = serverJs.slice(start, serverJs.indexOf("\n}\n", start));
  assert.match(body, /const headId = room\.songQueue\[0\]\?\.id \?\? null;/);
  assert.match(body, /if \(headId !== room\.headId\) \{\s*room\.headId = headId;\s*room\.headSince = Date\.now\(\);\s*scheduleAccessRecheck\(roomId, room\);/);
});

test("el aviso al vencer la gracia no hace nada con gracia 0 ni si la sala ya no existe", () => {
  const start = serverJs.indexOf("function scheduleAccessRecheck(");
  const body = serverJs.slice(start, serverJs.indexOf("\n}\n", start));
  assert.match(body, /if \(SINGER_GRACE_MS === 0\) return;/);
  assert.match(body, /if \(rooms\[roomId\] === room\) sendControlAccess\(room\);/);
  assert.match(body, /\.unref\(\)/, "un temporizador pendiente no debe impedir que el servidor termine");
});

test("los permisos se calculan con los presentes (conectados y en gracia), no solo con los conectados", () => {
  assert.match(serverJs, /function roomPresentNames\(room\)\s*\{\s*return presentNames\(connectedNames\(room\), room\.leftAt, room\.headSince, Date\.now\(\), SINGER_GRACE_MS\);/);
  const access = serverJs.slice(serverJs.indexOf("function sendControlAccess("));
  assert.match(access.slice(0, 300), /const online = roomPresentNames\(room\);/);
});
