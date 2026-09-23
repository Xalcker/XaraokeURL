// Quién tiene cada nombre dentro de una sala cuando no hay login (DISABLE_GOOGLE_AUTH).
//
// Sin login, el servidor sabe quién es cada persona solo por el nombre que eligió: con ese
// nombre se decide de quién es cada canción, quién puede pausar o saltar y quién ya votó. Si dos
// dispositivos entran con el mismo nombre, para el servidor son la misma persona y cada uno
// puede manejar las canciones del otro. Por eso el primer dispositivo (su sesión) que entra con
// un nombre se lo queda, y los demás tienen que elegir otro.
//
// El nombre se libera cuando su dueño ya no está: sin ninguna conexión abierta, sin canciones en
// la cola y sin calificaciones pendientes. Así un nombre no queda bloqueado toda la noche, pero
// nadie puede quedarse con el de quien solo se desconectó un momento y todavía tiene su turno.

// Se compara sin distinguir mayúsculas ni acentos: "Ana", "ana" y "Ána" se verían iguales en la
// pantalla de la sala, así que cuentan como el mismo nombre.
function nameKey(name) {
  return String(name)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("es");
}

// ¿La sesión dueña de ese nombre sigue en la sala?
function ownerStillPresent(room, key, ownerSessionId) {
  for (const client of room.clients) {
    if (!client.isHost && client.sessionId === ownerSessionId) return true;
  }
  const isKey = (name) => typeof name === "string" && nameKey(name) === key;
  return room.songQueue.some((item) => isKey(item.name)) || room.pendingRatings.some((p) => isKey(p.name));
}

// true si otra sesión (no `sessionId`) tiene ese nombre en la sala.
function isNameTaken(room, name, sessionId) {
  if (!room || !name) return false;
  const key = nameKey(name);
  const owner = room.nameOwners.get(key);
  if (!owner || owner === sessionId) return false;
  return ownerStillPresent(room, key, owner);
}

// Se queda con el nombre para esa sesión. Devuelve false (sin cambiar nada) si lo tiene otra.
function claimName(room, name, sessionId) {
  if (isNameTaken(room, name, sessionId)) return false;
  room.nameOwners.set(nameKey(name), sessionId);
  return true;
}

module.exports = { nameKey, isNameTaken, claimName };
