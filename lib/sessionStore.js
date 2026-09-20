// Endurece un almacén de sesiones basado en archivos (session-file-store) para Windows.
//
// El problema: express-session renueva la sesión (`touch`) en cada petición, y el almacén de
// archivos lo hace escribiendo un archivo temporal y renombrándolo sobre el de la sesión. En
// Windows, si otro programa (antivirus, indexador, sincronizador de la nube, un editor) tiene
// abierto ese archivo justo entonces, el rename falla con EPERM (o EBUSY / EACCES). La librería
// reintenta las lecturas, pero no las escrituras, y el error termina en la consola del servidor.
//
// Lo que se hace aquí:
//  - Las escrituras (set, touch, destroy) de una misma sesión van una tras otra, nunca solapadas.
//  - Un error transitorio se reintenta unos instantes con espera creciente.
//  - Renovar la sesión (touch) es un extra: se hace como mucho una vez cada `touchIntervalMs` por
//    sesión, sin hacer esperar la respuesta, y si no se logra no es un error (se reintenta en la
//    siguiente petición).
// Guardar de verdad los datos (set) sí devuelve el error si tras los reintentos sigue fallando.

const TRANSIENT_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const DEFAULT_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800];
const MAX_TRACKED_SESSIONS = 10000;

function hardenSessionStore(store, options = {}) {
  const {
    touchIntervalMs = DEFAULT_TOUCH_INTERVAL_MS,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    now = Date.now,
    onTouchError = () => {},
  } = options;

  const original = {
    set: store.set.bind(store),
    touch: store.touch.bind(store),
    destroy: store.destroy.bind(store),
  };
  const queues = new Map(); // sid -> última operación pendiente de esa sesión
  const lastWrite = new Map(); // sid -> cuándo se escribió (o se pidió escribir) por última vez

  // Ejecuta run(callback) y lo repite si falla con un error transitorio. Siempre resuelve
  // ({ err, result }); nunca rechaza.
  function attempt(run) {
    return new Promise((resolve) => {
      let retries = 0;
      const go = () => {
        try {
          run((err, result) => {
            if (err && TRANSIENT_CODES.has(err.code) && retries < retryDelaysMs.length) {
              setTimeout(go, retryDelaysMs[retries++]);
              return;
            }
            resolve({ err: err || null, result });
          });
        } catch (err) {
          resolve({ err, result: undefined });
        }
      };
      go();
    });
  }

  // Encadena la operación tras las que ya esperan para esa sesión.
  function enqueue(sid, run) {
    const previous = queues.get(sid) || Promise.resolve();
    const next = previous.then(() => attempt(run));
    queues.set(sid, next);
    next.then(() => {
      if (queues.get(sid) === next) queues.delete(sid);
    });
    return next;
  }

  function forgetOldWrites(current) {
    if (lastWrite.size <= MAX_TRACKED_SESSIONS) return;
    for (const [sid, when] of lastWrite) {
      if (current - when >= touchIntervalMs) lastWrite.delete(sid);
    }
  }

  store.set = (sid, session, callback) => {
    enqueue(sid, (done) => original.set(sid, session, done)).then(({ err, result }) => {
      if (!err) lastWrite.set(sid, now());
      if (callback) callback(err, result);
    });
  };

  store.destroy = (sid, callback) => {
    lastWrite.delete(sid);
    enqueue(sid, (done) => original.destroy(sid, done)).then(({ err }) => {
      lastWrite.delete(sid);
      if (callback) callback(err);
    });
  };

  store.touch = (sid, session, callback) => {
    const current = now();
    const last = lastWrite.get(sid);
    if (last !== undefined && current - last < touchIntervalMs) {
      if (callback) process.nextTick(callback);
      return;
    }
    // Se reserva el turno desde ya para que las peticiones simultáneas no intenten lo mismo, y
    // se responde sin esperar: renovar la sesión no es algo por lo que haya que hacer esperar.
    lastWrite.set(sid, current);
    forgetOldWrites(current);
    if (callback) process.nextTick(callback);
    enqueue(sid, (done) => original.touch(sid, session, done)).then(({ err }) => {
      if (err) {
        lastWrite.delete(sid); // no se logró: la próxima petición vuelve a intentarlo
        onTouchError(err);
      }
    });
  };

  return store;
}

module.exports = {
  hardenSessionStore,
  TRANSIENT_CODES,
  DEFAULT_TOUCH_INTERVAL_MS,
  DEFAULT_RETRY_DELAYS_MS,
};
