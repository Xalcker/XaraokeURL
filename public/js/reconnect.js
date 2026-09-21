// Qué hacer cuando se cierra el WebSocket del control remoto.
// Se carga como <script> plano en el navegador (define reconnectPolicy y nextRetryDelay) y
// también es requireable desde Node para las pruebas (mismo patrón que shared.js y wakeLock.js).
//
// Antes el remoto reintentaba siempre, cada 3 segundos y para siempre, sin mirar por qué se
// cerró. Si la sala ya no existía o la sesión había vencido, eso era un bucle infinito con la
// pantalla congelada mostrando una cola que ya no iba a cambiar, y sin decir nada.
(function (root, factory) {
  const mod = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = mod;
  }
  if (root) {
    Object.assign(root, mod);
  }
})(typeof window !== "undefined" ? window : undefined, function () {
  // Códigos con los que el servidor cierra a propósito (ver wss.on("connection") en server.js).
  const ROOM_NOT_FOUND = 4004;
  const NOT_AUTHENTICATED = 4001;
  const ORIGIN_NOT_ALLOWED = 4003;
  const NO_ROOM_ID = 4005;

  const FIRST_RETRY_MS = 3000;
  const MAX_RETRY_MS = 30000;

  // Decide qué hacer según el código de cierre. Devuelve { action, messageKey }:
  //   "retry"     -> volver a intentar más tarde (corte de red, servidor reiniciándose).
  //   "roomGone"  -> la sala ya no existe: reintentar no sirve, hay que volver a unirse.
  //   "login"     -> la sesión venció: hay que iniciar sesión otra vez.
  //   "stop"      -> algo que no se arregla reintentando y que la persona no puede resolver.
  function reconnectPolicy(code) {
    switch (code) {
      case ROOM_NOT_FOUND:
        return { action: "roomGone", messageKey: "remote.conn.roomGone" };
      case NOT_AUTHENTICATED:
        return { action: "login", messageKey: "remote.conn.sessionExpired" };
      case ORIGIN_NOT_ALLOWED:
      case NO_ROOM_ID:
        return { action: "stop", messageKey: "remote.conn.rejected" };
      default:
        return { action: "retry", messageKey: "remote.conn.retrying" };
    }
  }

  // Espera antes del siguiente intento: empieza en 3 s y se va duplicando hasta 30 s, para no
  // martillear un servidor que está caído. `attempt` empieza en 0.
  function nextRetryDelay(attempt, { first = FIRST_RETRY_MS, max = MAX_RETRY_MS } = {}) {
    const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
    return Math.min(max, first * 2 ** n);
  }

  return {
    reconnectPolicy,
    nextRetryDelay,
    ROOM_NOT_FOUND,
    NOT_AUTHENTICATED,
    FIRST_RETRY_MS,
    MAX_RETRY_MS,
  };
});
