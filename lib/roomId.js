const ROOM_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ROOM_ID_LENGTH = 4;

function generateRoomId(existingRooms = {}) {
  let result = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) {
    result += ROOM_ID_CHARS.charAt(Math.floor(Math.random() * ROOM_ID_CHARS.length));
  }
  return existingRooms[result] ? generateRoomId(existingRooms) : result;
}

module.exports = { generateRoomId };
