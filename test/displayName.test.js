const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizeDisplayName, MAX_DISPLAY_NAME_LENGTH } = require("../lib/displayName");

test("sanitizeDisplayName recorta espacios y colapsa los repetidos", () => {
  assert.equal(sanitizeDisplayName("  Ana   María  "), "Ana María");
});

test("sanitizeDisplayName convierte saltos de línea y tabuladores en espacios", () => {
  assert.equal(sanitizeDisplayName("Ana\nBeto\tCarla"), "Ana Beto Carla");
});

// U+202E (inversión de dirección de texto) y U+200B (espacio de ancho cero).
const RTL_OVERRIDE = String.fromCodePoint(0x202e);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);

test("sanitizeDisplayName quita los controles de dirección de texto", () => {
  assert.equal(sanitizeDisplayName(`Ana${RTL_OVERRIDE}odnaf`), "Anaodnaf");
});

test("sanitizeDisplayName devuelve null si no es texto o queda vacío", () => {
  for (const value of [undefined, null, 42, {}, [], "", "   ", "\n\t", ZERO_WIDTH_SPACE]) {
    assert.equal(sanitizeDisplayName(value), null);
  }
});

test("sanitizeDisplayName limita la longitud", () => {
  const name = sanitizeDisplayName("x".repeat(100));
  assert.equal(name.length, MAX_DISPLAY_NAME_LENGTH);
});

test("sanitizeDisplayName no parte un emoji al cortar por longitud", () => {
  const name = sanitizeDisplayName("🎤".repeat(100));
  assert.equal(Array.from(name).length, MAX_DISPLAY_NAME_LENGTH);
  assert.ok(Array.from(name).every((c) => c === "🎤"));
});

test("sanitizeDisplayName conserva acentos, eñes y emojis normales", () => {
  assert.equal(sanitizeDisplayName("José 🎤 Muñoz"), "José 🎤 Muñoz");
});
