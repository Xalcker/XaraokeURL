const test = require("node:test");
const assert = require("node:assert/strict");
const { generateRoomId } = require("../lib/roomId");

test("generateRoomId produce un código de 4 letras mayúsculas", () => {
  const id = generateRoomId();
  assert.match(id, /^[A-Z]{4}$/);
});

test("generateRoomId evita colisiones con salas existentes", () => {
  // Primeros 4 valores producen "AAAA" (ya ocupado, fuerza un reintento),
  // los siguientes 4 producen "NNNN" (libre).
  const sequence = [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5];
  let call = 0;
  const originalRandom = Math.random;
  Math.random = () => sequence[call++];
  try {
    const existingRooms = { AAAA: {} };
    const id = generateRoomId(existingRooms);
    assert.equal(id, "NNNN");
  } finally {
    Math.random = originalRandom;
  }
});
