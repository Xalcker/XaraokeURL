// Tiempo de gracia de quien canta (SINGER_GRACE_SECONDS): cuánto se espera a que vuelva, tras perder la
// conexión, antes de que los demás puedan pausar o saltar su canción.
const test = require("node:test");
const assert = require("node:assert/strict");
const { DEFAULT_SINGER_GRACE_SECONDS, parseSingerGrace } = require("../lib/roomPolicy");

const { serverSource } = require("../test-helpers/serverSources");
// Todo el servidor junto: server.js + src/ (ver #36 y test-helpers/serverSources.js).
const serverJs = serverSource();

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
  assert.match(serverJs, /parseSingerGrace\(\s*env\.SINGER_GRACE_SECONDS\s*\)/);
  // src/config.js junta todos los avisos de .env y los emite con el mismo helper, en vez de
  // un `if (xWarning)` por variable: lo que importa es que el de la gracia esté en la lista.
  assert.match(serverJs, /\[ttl, roomGrace, singerGrace,[^\]]*\]\.forEach\(avisar\)/);
});

