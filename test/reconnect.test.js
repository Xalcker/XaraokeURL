// Qué hace el control remoto cuando se le cierra el WebSocket (public/js/reconnect.js).
// Antes reintentaba siempre, cada 3 s y para siempre, sin mirar el código de cierre.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  reconnectPolicy,
  nextRetryDelay,
  FIRST_RETRY_MS,
  MAX_RETRY_MS,
} = require("../public/js/reconnect");
const { MESSAGES } = require("../public/js/i18n");

test("una sala que ya no existe no se reintenta: hay que volver a unirse", () => {
  const { action, messageKey } = reconnectPolicy(4004);
  assert.equal(action, "roomGone");
  assert.equal(messageKey, "remote.conn.roomGone");
});

test("una sesión vencida manda a iniciar sesión, no a reintentar", () => {
  const { action, messageKey } = reconnectPolicy(4001);
  assert.equal(action, "login");
  assert.equal(messageKey, "remote.conn.sessionExpired");
});

test("un rechazo del servidor que la persona no puede resolver se detiene", () => {
  for (const code of [4003, 4005]) {
    assert.equal(reconnectPolicy(code).action, "stop", `código ${code}`);
  }
});

test("un corte de red o un servidor reiniciándose sí se reintentan", () => {
  // 1006 es el cierre anormal típico de un corte; 1001 al irse la página; 1000 el normal.
  for (const code of [1000, 1001, 1006, 1011, undefined]) {
    assert.equal(reconnectPolicy(code).action, "retry", `código ${code}`);
  }
});

test("la espera empieza en 3 s, se duplica y se queda en 30 s", () => {
  assert.equal(nextRetryDelay(0), FIRST_RETRY_MS);
  assert.deepEqual([0, 1, 2, 3].map((n) => nextRetryDelay(n)), [3000, 6000, 12000, 24000]);
  for (const n of [4, 10, 100]) {
    assert.equal(nextRetryDelay(n), MAX_RETRY_MS, `intento ${n} no debe pasar del tope`);
  }
});

test("nextRetryDelay aguanta un número raro sin devolver algo absurdo", () => {
  for (const v of [undefined, null, -3, NaN, "no soy un número"]) {
    assert.equal(nextRetryDelay(v), FIRST_RETRY_MS, JSON.stringify(v));
  }
});

test("todos los mensajes que devuelve la política existen en los dos idiomas", () => {
  const claves = [1006, 4001, 4003, 4004, 4005].map((c) => reconnectPolicy(c).messageKey);
  for (const clave of new Set(claves)) {
    for (const lang of Object.keys(MESSAGES)) {
      assert.ok(MESSAGES[lang][clave], `falta ${clave} en "${lang}"`);
    }
  }
});

test("el control remoto usa la política en vez de reintentar a ciegas", () => {
  const remoteJs = fs.readFileSync(path.join(__dirname, "..", "public", "remote.js"), "utf8");
  assert.match(remoteJs, /reconnectPolicy\(event\.code\)/, "debe mirar el código de cierre");
  assert.match(remoteJs, /nextRetryDelay\(reconnectAttempt/, "debe usar la espera creciente");
  assert.doesNotMatch(
    remoteJs,
    /onclose\s*=\s*\(\)\s*=>\s*setTimeout/,
    "no debe volver el reintento fijo que ignoraba el motivo del cierre"
  );

  const html = fs.readFileSync(path.join(__dirname, "..", "public", "remote.html"), "utf8");
  assert.ok(
    html.indexOf('src="js/reconnect.js"') < html.indexOf('src="remote.js"'),
    "reconnect.js se debe cargar antes que remote.js"
  );
});

test("ni el host ni el remoto se rompen con un mensaje que no es JSON", () => {
  const dir = path.join(__dirname, "..", "public");
  for (const archivo of ["remote.js", "karaoke.js"]) {
    const src = fs.readFileSync(path.join(dir, archivo), "utf8");
    const i = src.indexOf("ws.onmessage");
    assert.ok(i >= 0, `falta onmessage en ${archivo}`);
    const bloque = src.slice(i, i + 400);
    assert.match(bloque, /try\s*\{[\s\S]*JSON\.parse\(event\.data\)/, `${archivo} debe protegerlo`);
  }
});
