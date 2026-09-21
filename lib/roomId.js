const ROOM_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ROOM_ID_LENGTH = 4;

function generateRoomId(existingRooms = {}) {
  let result = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    result += ROOM_ID_CHARS.charAt(Math.floor(Math.random() * ROOM_ID_CHARS.length));
  }
  return existingRooms[result] ? generateRoomId(existingRooms) : result;
}

// Código de sala listo para usar (4 letras mayúsculas) o null si lo recibido no lo es. Sirve para
// el código que viaja en el enlace del QR: solo se acepta algo con la forma exacta de un código.
function normalizeRoomId(value) {
  if (typeof value !== "string") return null;
  const typed = value.trim();
  const code = typed.toUpperCase();
  // Se mide también lo escrito: "ß".toUpperCase() es "SS" y no debe colarse como dos letras.
  const valid = typed.length === ROOM_ID_LENGTH && code.length === ROOM_ID_LENGTH && [...code].every((char) => ROOM_ID_CHARS.includes(char));
  return valid ? code : null;
}

module.exports = { generateRoomId, normalizeRoomId };
