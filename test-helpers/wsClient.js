// Cliente de WebSocket para las pruebas de integración: se conecta, guarda lo que llega y deja
// esperar a que aparezca un mensaje concreto, en vez de dormir un rato y cruzar los dedos.
const WebSocket = require("ws");

const DEFAULT_TIMEOUT_MS = 10000;

// Se conecta y resuelve cuando la conexión está abierta. Si el servidor la rechaza en el
// handshake, rechaza con un error que lleva el código de cierre en `err.code`.
function connect(url, { origin, headers, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const ws = new WebSocket(url, {
    ...(origin ? { origin } : {}),
    ...(headers ? { headers } : {}),
  });
  const received = [];
  let cursor = 0;
  const waiters = [];
  let closed = null;

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      message = { type: "__no-es-json__", raw: String(raw) };
    }
    received.push(message);
    for (const w of [...waiters]) if (w.try()) waiters.splice(waiters.indexOf(w), 1);
  });

  const closePromise = new Promise((resolve) => {
    ws.on("close", (code, reason) => {
      closed = { code, reason: String(reason) };
      for (const w of waiters.splice(0)) w.fail(new Error(`la conexión se cerró (${code}) mientras se esperaba`));
      resolve(closed);
    });
  });

  const client = {
    ws,
    received,
    get closed() {
      return closed;
    },
    closePromise,
    send(message) {
      ws.send(JSON.stringify(message));
      return client;
    },
    // Olvida lo recibido hasta ahora: se llama antes de una acción para que `waitFor` no se
    // quede con un mensaje viejo que ya cumplía la condición.
    clear() {
      cursor = received.length;
      return client;
    },
    // Lo contrario: vuelve a dejar visible todo lo recibido desde el principio.
    rewind() {
      cursor = 0;
      return client;
    },
    // Espera al primer mensaje de ese tipo (desde el último clear) que cumpla `predicate`.
    // De a una espera por cliente: el cursor es compartido, así que dos waitFor a la vez sobre el
    // mismo cliente se pisarían.
    waitFor(type, predicate = () => true, { timeoutMs: t = DEFAULT_TIMEOUT_MS } = {}) {
      return new Promise((resolve, reject) => {
        const scan = () => {
          for (let i = cursor; i < received.length; i++) {
            if (received[i].type === type && predicate(received[i].payload, received[i])) {
              cursor = i + 1;
              resolve(received[i]);
              return true;
            }
          }
          return false;
        };
        if (scan()) return;
        if (closed) return reject(new Error(`la conexión ya estaba cerrada (${closed.code}); se esperaba "${type}"`));

        // El waiter se quita de la lista pase lo que pase. Si al expirar se quedara ahí, el
        // siguiente mensaje que encajara lo consumiría igual y adelantaría el cursor, dejando
        // ciega a la espera siguiente. Importa porque assertNoMessage expira siempre a propósito.
        const olvidar = () => {
          const i = waiters.indexOf(waiter);
          if (i !== -1) waiters.splice(i, 1);
        };
        const timer = setTimeout(() => {
          olvidar();
          const vistos = received.slice(cursor).map((m) => m.type).join(", ") || "ninguno";
          reject(new Error(`no llegó "${type}" en ${t} ms. Mensajes vistos desde el último clear: ${vistos}`));
        }, t);
        const waiter = {
          try: () => {
            if (!scan()) return false;
            clearTimeout(timer);
            return true;
          },
          fail: (err) => {
            clearTimeout(timer);
            reject(err);
          },
        };
        waiters.push(waiter);
      });
    },
    async close() {
      if (closed) return closed;
      ws.close();
      return closePromise;
    },
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no se pudo conectar a ${url} en ${timeoutMs} ms`)), timeoutMs);
    ws.once("open", () => {
      clearTimeout(timer);
      resolve(client);
    });
    ws.once("close", (code) => {
      clearTimeout(timer);
      const err = new Error(`el servidor rechazó la conexión con el código ${code}`);
      err.code = code;
      reject(err);
    });
    ws.once("error", () => {}); // el "close" de arriba ya cuenta la historia
  });
}

// Se conecta a una sala y NO devuelve el cliente hasta que llega el primer mensaje del servidor.
//
// Esa espera no es cosmética. server.js registra su ws.on("message") DENTRO del callback de la
// sesión, y cuando el handshake trae cookie esa carga es asíncrona (lee del disco el archivo de
// la sesión). En esa ventana la conexión ya está abierta pero el servidor todavía no escucha, así
// que todo lo que se le mande se pierde sin dejar rastro: medido, 29 de cada 30 mensajes. Ver #42.
//
// El primer queueUpdate sale del mismo bloque síncrono en el que se registra el manejador, así
// que recibirlo garantiza que el servidor ya está escuchando. Cuando #42 se arregle, esta espera
// dejará de hacer falta, pero no estorba.
async function connectToRoom(url, options) {
  const client = await connect(url, options);
  try {
    await client.waitFor("queueUpdate");
  } catch (err) {
    await client.close();
    throw err;
  }
  // La barrera no debe consumir nada: quien llama sigue viendo el queueUpdate inicial y todo lo
  // que haya llegado con él, como si se hubiera conectado sin más.
  return client.rewind();
}

// Comprueba que NO llega ningún mensaje de ese tipo en `ms`. Sirve para lo que el servidor debe
// ignorar en silencio: un mensaje que solo puede mandar el host, o una orden de quien no canta.
async function assertNoMessage(client, type, ms = 400) {
  try {
    await client.waitFor(type, () => true, { timeoutMs: ms });
  } catch {
    return; // no llegó, que es justo lo que se quería
  }
  throw new Error(`llegó un "${type}" que el servidor debería haber ignorado`);
}

// Código con el que el servidor cierra una conexión que no acepta. Falla si la deja abierta.
//
// Ojo con los dos caminos: el servidor completa el handshake (HTTP 101) y recién entonces llama a
// ws.close(4004, ...), así que lo normal es que la conexión se abra y se cierre un instante
// después. Por eso no alcanza con mirar si connect() falló.
async function closeCodeFor(url, options = {}) {
  const { timeoutMs = 5000 } = options;
  let client;
  try {
    client = await connect(url, options);
  } catch (err) {
    if (typeof err.code === "number") return err.code; // rechazado durante el handshake
    throw err;
  }
  const cerrada = await Promise.race([
    client.closePromise,
    new Promise((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
  if (!cerrada) {
    await client.close();
    throw new Error(`el servidor dejó la conexión abierta; se esperaba que la cerrara (${url})`);
  }
  return cerrada.code;
}

module.exports = { connect, connectToRoom, closeCodeFor, assertNoMessage };
