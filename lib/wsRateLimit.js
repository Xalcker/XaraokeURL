// Tope de mensajes por conexión de WebSocket.
//
// Los endpoints HTTP tenían límites (crear salas, buscar, descargar), pero por WebSocket no
// había ninguno: era la única superficie del proyecto sin protección de caudal.
//
// El tope es holgado a propósito. El host manda un timeUpdate por segundo (ya viene limitado en
// public/karaoke.js) más algún playbackState, así que ni se acerca; un control remoto normal
// manda unos pocos mensajes sueltos. Lo que corta es el bucle.

const DEFAULT_MAX = 40;
const DEFAULT_WINDOW_MS = 10000;

// Ventana fija: se cuenta hasta `max` por cada `windowMs` y se reinicia. Es menos preciso que
// una ventana deslizante (en el borde se pueden colar casi el doble), pero para frenar un bucle
// sobra y no hay que guardar una marca de tiempo por mensaje.
function createMessageLimiter({ max = DEFAULT_MAX, windowMs = DEFAULT_WINDOW_MS, now = Date.now } = {}) {
  let inicioVentana = 0;
  let contador = 0;
  let descartados = 0;

  return {
    // true si el mensaje se puede atender; false si hay que descartarlo.
    allow() {
      const ahora = now();
      if (ahora - inicioVentana >= windowMs) {
        inicioVentana = ahora;
        contador = 0;
      }
      if (contador >= max) {
        descartados++;
        return false;
      }
      contador++;
      return true;
    },
    // Cuántos se han descartado en esta conexión (para avisar una sola vez).
    get dropped() {
      return descartados;
    },
  };
}

module.exports = { createMessageLimiter, DEFAULT_MAX, DEFAULT_WINDOW_MS };
