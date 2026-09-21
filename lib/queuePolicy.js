// Reglas para reordenar la cola: cada persona ordena SUS canciones entre sí, sin mover las de nadie más.

// Mueve una canción de `name` un lugar hacia arriba ("up") o hacia abajo ("down") dentro de las canciones
// de esa misma persona: intercambia su posición con la canción suya que tiene al lado, así ninguna canción
// de otra persona cambia de turno. La que suena (posición 0) no se toca ni se puede mover, y tampoco se
// puede pasar por encima de ella.
//
// Devuelve la cola nueva, o null si no hay nada que mover (la canción no existe, no es de esa persona, es
// la que suena, o ya es la primera/última de las suyas). No modifica la cola que recibe.
function moveOwnSong(queue, id, name, direction) {
  if (!Array.isArray(queue) || typeof name !== "string" || !name) return null;
  if (direction !== "up" && direction !== "down") return null;

  const own = [];
  queue.forEach((item, index) => {
    if (index > 0 && item.name === name) own.push(index);
  });
  const from = own.find((index) => queue[index].id === id);
  if (from === undefined) return null;

  const position = own.indexOf(from);
  const to = own[direction === "up" ? position - 1 : position + 1];
  if (to === undefined) return null;

  const moved = queue.slice();
  [moved[from], moved[to]] = [moved[to], moved[from]];
  return moved;
}

module.exports = { moveOwnSong };
