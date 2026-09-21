// Apagado ordenado y tope de consultas de sala (#38), contra el servidor real.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("../test-helpers/testServer");
const { connect } = require("../test-helpers/wsClient");

test("con SIGTERM el servidor cierra ordenadamente y sale con 0", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  const { roomId, hostToken } = await fetch(`${server.baseUrl}/api/rooms`, { method: "POST" }).then((r) => r.json());
  const host = await connect(`${server.wsUrl}/?sala=${roomId}&hostToken=${hostToken}`);

  const { code, signal } = await server.signalAndWait("SIGTERM");
  assert.equal(code, 0, `debía salir con 0, salió con code=${code} signal=${signal}`);

  const salida = server.output();
  assert.match(salida, /SIGTERM recibido/, "debe decir que está cerrando");
  assert.match(salida, /Todo cerrado/, "debe llegar hasta el final del cierre");
  assert.doesNotMatch(salida, /tardó demasiado/, "no debía hacer falta el cierre forzado");

  // A quien estaba conectado se le cierra la conexión, no se le deja colgado.
  const cerrada = await host.closePromise;
  assert.ok(cerrada, "el WebSocket del host debe cerrarse");
});

test("con SIGINT (Ctrl+C) hace lo mismo", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());
  const { code } = await server.signalAndWait("SIGINT");
  assert.equal(code, 0);
  assert.match(server.output(), /SIGINT recibido/);
});

test("consultar si una sala existe está limitado, para no poder barrer los códigos", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  // El tope es 60/min. Un barrido se topa con él enseguida; quien se une consulta una o dos veces.
  let visto429 = false;
  let atendidas = 0;
  for (let i = 0; i < 80 && !visto429; i++) {
    const res = await fetch(`${server.baseUrl}/api/rooms/ZZZZ`);
    if (res.status === 429) visto429 = true;
    else atendidas++;
  }
  assert.ok(visto429, "nunca llegó el 429: se podrían barrer las 456.976 combinaciones");
  assert.ok(atendidas >= 50, `cortó demasiado pronto (${atendidas}): unirse a una sala debe seguir funcionando`);
});
