const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_TTL_HOURS,
  parseDownloadTtl,
  sweepIntervalMs,
  sanitizeSearchQuery,
} = require("../lib/downloadPolicy");

const HOUR = 60 * 60 * 1000;

test("parseDownloadTtl usa 6 horas si la variable no está definida o está vacía", () => {
  for (const value of [undefined, null, "", "   "]) {
    assert.deepEqual(parseDownloadTtl(value), { ttlMs: DEFAULT_TTL_HOURS * HOUR, warning: null });
  }
  assert.equal(DEFAULT_TTL_HOURS, 6);
});

test("parseDownloadTtl acepta horas enteras y decimales", () => {
  assert.equal(parseDownloadTtl("12").ttlMs, 12 * HOUR);
  assert.equal(parseDownloadTtl("0.5").ttlMs, 0.5 * HOUR);
  assert.equal(parseDownloadTtl(" 24 ").ttlMs, 24 * HOUR);
  assert.equal(parseDownloadTtl("12").warning, null);
});

test("parseDownloadTtl interpreta 0 y sus sinónimos como 'no borrar nunca'", () => {
  for (const value of ["0", "0.0", "never", "NEVER", "nunca", "forever", "off", "false", "no"]) {
    assert.deepEqual(parseDownloadTtl(value), { ttlMs: null, warning: null }, `valor: ${value}`);
  }
});

test("parseDownloadTtl cae al valor por defecto y avisa si el valor no es válido", () => {
  for (const value of ["abc", "-3", "6h", "NaN", "Infinity"]) {
    const result = parseDownloadTtl(value);
    assert.equal(result.ttlMs, DEFAULT_TTL_HOURS * HOUR, `valor: ${value}`);
    assert.match(result.warning, /DOWNLOAD_TTL_HOURS/);
  }
});

test("sweepIntervalMs es una cuarta parte de la vida útil, entre 5 s y 30 min", () => {
  assert.equal(sweepIntervalMs(6 * HOUR), 30 * 60 * 1000);
  assert.equal(sweepIntervalMs(1 * HOUR), 15 * 60 * 1000);
  assert.equal(sweepIntervalMs(1000), 5000);
});

test("sanitizeSearchQuery limpia espacios y limita la longitud", () => {
  assert.equal(sanitizeSearchQuery("  me   at\nthe zoo  "), "me at the zoo");
  assert.equal(Array.from(sanitizeSearchQuery("x".repeat(500))).length, 100);
});

test("sanitizeSearchQuery devuelve null si no es texto o queda vacío", () => {
  for (const value of [undefined, null, 5, {}, "", "   "]) {
    assert.equal(sanitizeSearchQuery(value), null);
  }
});
