// Quién se queda con cada nombre en una sala sin login (lib/nameClaims.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { nameKey, isNameTaken, claimName } = require("../lib/nameClaims");

const salaVacia = () => ({ clients: new Set(), songQueue: [], pendingRatings: [], nameOwners: new Map() });
const conectar = (room, sessionId, extra = {}) => room.clients.add({ sessionId, ...extra });

test("nameKey no distingue mayúsculas ni acentos", () => {
  assert.equal(nameKey("Ána"), nameKey("ana"));
  assert.equal(nameKey("JOSÉ"), nameKey("jose"));
  assert.notEqual(nameKey("Ana"), nameKey("Ana María"));
});

test("el primero que entra con un nombre se lo queda", () => {
  const room = salaVacia();
  assert.equal(claimName(room, "Ana", "s1"), true);
  conectar(room, "s1");
  assert.equal(claimName(room, "ana", "s2"), false, "otra sesión no puede usarlo");
  assert.equal(isNameTaken(room, "ANA", "s2"), true);
  assert.equal(room.nameOwners.get(nameKey("Ana")), "s1", "el rechazo no cambia de dueño");
});

test("la misma sesión puede volver con su nombre", () => {
  const room = salaVacia();
  claimName(room, "Ana", "s1");
  conectar(room, "s1");
  assert.equal(claimName(room, "Ana", "s1"), true);
});

test("el nombre sigue ocupado mientras su dueño tenga canciones en la cola o calificaciones pendientes", () => {
  const room = salaVacia();
  claimName(room, "Ana", "s1"); // se conectó y ya se fue: no está en room.clients

  room.songQueue.push({ id: "1", song: "a.mp4", name: "Ana" });
  assert.equal(isNameTaken(room, "Ana", "s2"), true, "con su turno en la cola");

  room.songQueue.length = 0;
  room.pendingRatings.push({ id: "1", name: "Ana" });
  assert.equal(isNameTaken(room, "Ana", "s2"), true, "con una calificación pendiente");

  room.pendingRatings.length = 0;
  assert.equal(claimName(room, "Ana", "s2"), true, "sin nada pendiente, se libera");
  assert.equal(room.nameOwners.get(nameKey("Ana")), "s2");
});

test("el host no cuenta como dueño de un nombre", () => {
  const room = salaVacia();
  claimName(room, "Ana", "s1");
  conectar(room, "s1", { isHost: true });
  assert.equal(isNameTaken(room, "Ana", "s2"), false);
});

test("sin sala o sin nombre no hay nada ocupado", () => {
  assert.equal(isNameTaken(undefined, "Ana", "s1"), false);
  assert.equal(isNameTaken(salaVacia(), "", "s1"), false);
});
