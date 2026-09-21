// Pruebas de integración del handshake del WebSocket: a quién deja entrar el servidor y a quién no.
// Es la puerta donde se decide si alguien es el host, así que conviene probarla de verdad y no
// solo leyendo el código.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("../test-helpers/testServer");
const { connect, closeCodeFor } = require("../test-helpers/wsClient");

const crearSala = (server) =>
  fetch(`${server.baseUrl}/api/rooms`, { method: "POST" }).then((r) => r.json());

test("handshake del WebSocket sin login (modo desarrollo)", async (t) => {
  const server = await startServer();
  t.after(() => server.stop());

  await t.test("sin código de sala se rechaza con 4005", async () => {
    assert.equal(await closeCodeFor(server.wsUrl), 4005);
  });

  await t.test("con una sala que no existe se rechaza con 4004", async () => {
    assert.equal(await closeCodeFor(`${server.wsUrl}/?sala=ZZZZ`), 4004);
  });

  await t.test("el código de sala no distingue mayúsculas", async () => {
    const { roomId } = await crearSala(server);
    const client = await connect(`${server.wsUrl}/?sala=${roomId.toLowerCase()}`);
    t.after(() => client.close());
    await client.waitFor("queueUpdate");
  });

  await t.test("un Origin de otro sitio se rechaza con 4003", async () => {
    const { roomId } = await crearSala(server);
    assert.equal(
      await closeCodeFor(`${server.wsUrl}/?sala=${roomId}`, { origin: "http://sitio-malicioso.example" }),
      4003
    );
  });

  await t.test("un Origin que no es ni una URL se rechaza con 4003", async () => {
    const { roomId } = await crearSala(server);
    assert.equal(await closeCodeFor(`${server.wsUrl}/?sala=${roomId}`, { origin: "no-soy-una-url" }), 4003);
  });

  await t.test("el Origin del propio servidor sí se acepta", async () => {
    const { roomId } = await crearSala(server);
    const client = await connect(`${server.wsUrl}/?sala=${roomId}`, {
      origin: `http://127.0.0.1:${server.port}`,
    });
    t.after(() => client.close());
    await client.waitFor("queueUpdate");
  });
});

test("handshake del WebSocket con Google OAuth activo", async (t) => {
  const server = await startServer({ auth: true });
  t.after(() => server.stop());

  await t.test("un control remoto sin sesión se rechaza con 4001", async () => {
    const { roomId } = await crearSala(server);
    assert.equal(await closeCodeFor(`${server.wsUrl}/?sala=${roomId}`), 4001);
  });

  await t.test("el host entra con su hostToken aunque no tenga sesión de Google", async () => {
    const { roomId, hostToken } = await crearSala(server);
    const host = await connect(`${server.wsUrl}/?sala=${roomId}&hostToken=${hostToken}`);
    t.after(() => host.close());
    // El host recibe dos hostStatus seguidos: el primero dice `false` porque el servidor aún no se
    // lo ha apuntado como host, y el segundo ya `true`. A los remotos les llega el valor correcto.
    await host.waitFor("hostStatus", (p) => p.connected === true);
  });

  await t.test("un hostToken equivocado no suplanta al host: se pide sesión igual", async () => {
    const { roomId } = await crearSala(server);
    for (const intento of ["", "cualquier-cosa", "00000000-0000-4000-8000-000000000000"]) {
      assert.equal(
        await closeCodeFor(`${server.wsUrl}/?sala=${roomId}&hostToken=${intento}`),
        4001,
        `debería rechazar el token "${intento}"`
      );
    }
  });

  await t.test("el hostToken de una sala no vale para otra", async () => {
    const a = await crearSala(server);
    const b = await crearSala(server);
    assert.equal(await closeCodeFor(`${server.wsUrl}/?sala=${b.roomId}&hostToken=${a.hostToken}`), 4001);
  });
});
