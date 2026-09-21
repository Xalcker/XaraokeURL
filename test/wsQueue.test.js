// Pruebas de integración de la cola y de las reglas de reproducción, con un servidor de verdad y
// varios clientes a la vez. Es lo que no se puede comprobar leyendo el código fuente: que el
// nombre lo ponga el servidor, que un remoto no pueda hacerse pasar por el host y que "solo quien
// canta controla" se cumpla de punta a punta.
//
// Cada bloque levanta su propio servidor, y no por gusto: crear salas está limitado a 10 por
// minuto y por IP, así que un solo servidor para todo se toparía con su propio limitador.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("../test-helpers/testServer");
const { connect, connectToRoom, assertNoMessage } = require("../test-helpers/wsClient");

const A = "Queen - Bohemian Rhapsody.mp4";
const B = "Soda Stereo - De Música Ligera.mp4";
const C = "Cerati - Crimen.mp4";
const CANCIONES = [
  { artist: "Queen", title: "Bohemian Rhapsody", filename: A },
  { artist: "Soda Stereo", title: "De Música Ligera", filename: B },
  { artist: "Cerati", title: "Crimen", filename: C },
];

const crearSala = async (server) => {
  const res = await fetch(`${server.baseUrl}/api/rooms`, { method: "POST" });
  assert.equal(res.status, 200, "no se pudo crear la sala (¿limitador de 10/min?)");
  return res.json();
};

// Un control remoto con nombre propio. En modo desarrollo el nombre vive en la sesión, así que
// primero se pide con /api/dev-name y después se lleva la cookie al handshake del WebSocket.
async function remotoLlamado(server, roomId, nombre) {
  const res = await fetch(`${server.baseUrl}/api/dev-name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: nombre }),
  });
  assert.equal(res.status, 200, `no se pudo fijar el nombre ${nombre}`);
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return connectToRoom(`${server.wsUrl}/?sala=${roomId}`, { headers: { Cookie: cookie } });
}

const conectarHost = (server, roomId, hostToken) =>
  connectToRoom(`${server.wsUrl}/?sala=${roomId}&hostToken=${hostToken}`);

const cancionesEnCola = (payload) => payload.map((i) => i.song);
const nombresEnCola = (payload) => payload.map((i) => i.name);

// Sala nueva con host y dos remotos con nombres distintos.
async function abrirSala(server, t) {
  const { roomId, hostToken } = await crearSala(server);
  const host = await conectarHost(server, roomId, hostToken);
  const ana = await remotoLlamado(server, roomId, "Ana");
  const beto = await remotoLlamado(server, roomId, "Beto");
  t.after(() => Promise.all([host.close(), ana.close(), beto.close()]));
  return { roomId, hostToken, host, ana, beto };
}

test("la cola: agregar, quitar y reordenar", async (t) => {
  const server = await startServer({ songs: CANCIONES });
  t.after(() => server.stop());

  await t.test("una canción agregada por un remoto llega a todos con su dueño", async (t) => {
    const { host, ana, beto } = await abrirSala(server, t);
    ana.send({ type: "addSong", payload: { song: A } });

    for (const [quien, cliente] of [["host", host], ["ana", ana], ["beto", beto]]) {
      const { payload } = await cliente.waitFor("queueUpdate", (p) => p.length === 1);
      assert.deepEqual(cancionesEnCola(payload), [A], `la cola que ve ${quien}`);
      assert.deepEqual(nombresEnCola(payload), ["Ana"], `el dueño según ${quien}`);
      assert.match(payload[0].id, /^[0-9a-f-]{36}$/, "el id lo genera el servidor");
    }
  });

  await t.test("el nombre lo pone el servidor: no se encola a nombre de otra persona", async (t) => {
    const { ana, beto } = await abrirSala(server, t);
    beto.send({ type: "addSong", payload: { song: A, name: "Ana" } });
    const { payload } = await ana.waitFor("queueUpdate", (p) => p.length === 1);
    assert.deepEqual(nombresEnCola(payload), ["Beto"], "queda a nombre de quien lo mandó");
  });

  await t.test("un filename que no está en la biblioteca no se encola", async (t) => {
    const { ana } = await abrirSala(server, t);
    ana.send({ type: "addSong", payload: { song: "no-existe.mp4" } });
    ana.send({ type: "addSong", payload: { song: A } });
    // Si el inventado se hubiera colado, estaría primero.
    const { payload } = await ana.waitFor("queueUpdate", (p) => p.length >= 1);
    assert.deepEqual(cancionesEnCola(payload), [A]);
  });

  await t.test("cada quien quita solo sus canciones", async (t) => {
    const { ana, beto } = await abrirSala(server, t);
    ana.send({ type: "addSong", payload: { song: A } });
    await ana.waitFor("queueUpdate", (p) => p.length === 1);
    beto.send({ type: "addSong", payload: { song: B } });
    const { payload: dos } = await ana.waitFor("queueUpdate", (p) => p.length === 2);
    const deAna = dos.find((i) => i.name === "Ana");

    // Beto intenta quitar la de Ana: el servidor le pone su propio nombre, así que no coincide.
    beto.clear();
    beto.send({ type: "removeSong", payload: { id: deAna.id, name: "Ana" } });
    const { payload: sigueIgual } = await beto.waitFor("queueUpdate");
    assert.equal(sigueIgual.length, 2, "desde Beto no se debe poder quitar la de Ana");

    ana.clear();
    ana.send({ type: "removeSong", payload: { id: deAna.id } });
    const { payload: unaMenos } = await ana.waitFor("queueUpdate", (p) => p.length === 1);
    assert.deepEqual(nombresEnCola(unaMenos), ["Beto"]);
  });

  await t.test("reordenar mueve solo las propias y nunca por encima de la que suena", async (t) => {
    const { ana, beto } = await abrirSala(server, t);
    // Cola: Ana(A) sonando, Beto(B), Ana(C)
    ana.send({ type: "addSong", payload: { song: A } });
    await ana.waitFor("queueUpdate", (p) => p.length === 1);
    beto.send({ type: "addSong", payload: { song: B } });
    await ana.waitFor("queueUpdate", (p) => p.length === 2);
    ana.send({ type: "addSong", payload: { song: C } });
    const { payload: tres } = await ana.waitFor("queueUpdate", (p) => p.length === 3);
    assert.deepEqual(cancionesEnCola(tres), [A, B, C]);

    // Ana sube su C: la única suya más arriba es la que suena, así que no hay a dónde.
    ana.clear();
    ana.send({ type: "moveSong", payload: { id: tres[2].id, direction: "up" } });
    await assertNoMessage(ana, "queueUpdate");

    // Beto intenta mover la de Ana: no es suya.
    beto.clear();
    beto.send({ type: "moveSong", payload: { id: tres[2].id, direction: "up" } });
    await assertNoMessage(beto, "queueUpdate");

    ana.clear();
    ana.send({ type: "getQueue" });
    const { payload: final } = await ana.waitFor("queueUpdate");
    assert.deepEqual(cancionesEnCola(final), [A, B, C], "la cola no cambió");
  });
});

test("reglas de reproducción: solo quien canta controla", async (t) => {
  const server = await startServer({ songs: CANCIONES, env: { SINGER_GRACE_SECONDS: "0" } });
  t.after(() => server.stop());

  await t.test("el servidor avisa a cada quien si puede controlar", async (t) => {
    const { ana, beto } = await abrirSala(server, t);
    ana.clear();
    beto.clear();
    ana.send({ type: "addSong", payload: { song: A } });

    const accesoAna = await ana.waitFor("controlAccess", (p) => p.allowed === true);
    const accesoBeto = await beto.waitFor("controlAccess", (p) => p.allowed === false);
    assert.equal(accesoAna.payload.allowed, true, "Ana canta: puede");
    assert.equal(accesoBeto.payload.allowed, false, "Beto no canta: no puede");
  });

  await t.test("y lo hace cumplir, no solo lo informa", async (t) => {
    const { host, ana, beto } = await abrirSala(server, t);
    ana.send({ type: "addSong", payload: { song: A } });
    await beto.waitFor("controlAccess", (p) => p.allowed === false);

    // Beto manda un skip. El getQueue de después hace de barrera: cuando su respuesta llega, el
    // servidor ya procesó el skip, así que si no reenvió nada es que lo descartó.
    host.clear();
    beto.send({ type: "controlAction", payload: { action: "skip" } });
    beto.clear();
    beto.send({ type: "getQueue" });
    await beto.waitFor("queueUpdate");
    await assertNoMessage(host, "controlAction");

    // La misma orden desde Ana sí llega al host.
    ana.send({ type: "controlAction", payload: { action: "pause" } });
    const orden = await host.waitFor("controlAction");
    assert.deepEqual(orden.payload, { action: "pause" }, "sin campos de más");
  });

  await t.test("si quien canta se va, cualquiera puede controlar su canción", async (t) => {
    const { host, ana, beto } = await abrirSala(server, t);
    ana.send({ type: "addSong", payload: { song: A } });
    await beto.waitFor("controlAccess", (p) => p.allowed === false);

    // Este servidor corre con SINGER_GRACE_SECONDS=0: al irse Ana, Beto puede de inmediato.
    await ana.close();
    await beto.waitFor("controlAccess", (p) => p.allowed === true);

    host.clear();
    beto.send({ type: "controlAction", payload: { action: "skip" } });
    const orden = await host.waitFor("controlAction");
    assert.equal(orden.payload.action, "skip");
  });

  await t.test("un remoto no puede mandar los mensajes que son solo del host", async (t) => {
    const { host, ana, beto } = await abrirSala(server, t);
    ana.send({ type: "addSong", payload: { song: A } });
    await beto.waitFor("queueUpdate", (p) => p.length === 1);

    // playNext adelantaría la cola sin pasar por la pantalla del host.
    beto.clear();
    beto.send({ type: "playNext", payload: {} });
    beto.send({ type: "getQueue" });
    const { payload } = await beto.waitFor("queueUpdate");
    assert.equal(payload.length, 1, "la cola no se debe mover desde un remoto");

    // timeUpdate y playbackState mostrarían a los demás un tiempo y un estado falsos.
    ana.clear();
    beto.send({ type: "timeUpdate", payload: { currentTime: 999, duration: 999, song: A } });
    beto.send({ type: "playbackState", payload: { paused: true } });
    await assertNoMessage(ana, "timeUpdate");
    await assertNoMessage(ana, "playbackState");

    // Del host sí pasan.
    host.send({ type: "timeUpdate", payload: { currentTime: 10, duration: 200, song: A } });
    const visto = await ana.waitFor("timeUpdate");
    assert.equal(visto.payload.currentTime, 10);
  });
});

test("el host: adelantar la cola, ser reemplazado y caerse", async (t) => {
  const server = await startServer({ songs: CANCIONES });
  t.after(() => server.stop());

  await t.test("el host adelanta la cola con playNext", async (t) => {
    const { host, ana } = await abrirSala(server, t);
    ana.send({ type: "addSong", payload: { song: A } });
    await host.waitFor("queueUpdate", (p) => p.length === 1);
    ana.send({ type: "addSong", payload: { song: B } });
    await host.waitFor("queueUpdate", (p) => p.length === 2);

    host.clear();
    host.send({ type: "playNext", payload: {} });
    const { payload } = await host.waitFor("queueUpdate", (p) => p.length === 1);
    assert.deepEqual(cancionesEnCola(payload), [B]);
  });

  await t.test("un mensaje corrupto no tumba el servidor ni la sala", async (t) => {
    const { ana } = await abrirSala(server, t);
    ana.ws.send("esto no es JSON");
    ana.ws.send("null");
    ana.ws.send("42");
    ana.ws.send(JSON.stringify({ type: "addSong" }));                      // sin payload
    ana.ws.send(JSON.stringify({ type: "addSong", payload: { song: 7 } })); // song no es texto
    ana.ws.send(JSON.stringify({ type: "tipo-inventado", payload: {} }));

    ana.clear();
    ana.send({ type: "addSong", payload: { song: A } });
    const { payload } = await ana.waitFor("queueUpdate", (p) => p.length === 1);
    assert.deepEqual(cancionesEnCola(payload), [A], "el servidor sigue atendiendo");
  });

  await t.test("una segunda pantalla de host desconecta a la anterior con 4006", async (t) => {
    const { roomId, hostToken } = await crearSala(server);
    const primero = await conectarHost(server, roomId, hostToken);
    await primero.waitFor("hostStatus", (p) => p.connected === true);

    const segundo = await conectarHost(server, roomId, hostToken);
    t.after(() => segundo.close());

    const cerrada = await primero.closePromise;
    assert.equal(cerrada.code, 4006);
  });

  await t.test("cuando el host se cae, los remotos se enteran", async (t) => {
    const { roomId, hostToken } = await crearSala(server);
    const host = await conectarHost(server, roomId, hostToken);
    const ana = await remotoLlamado(server, roomId, "Ana");
    t.after(() => ana.close());

    await ana.waitFor("hostStatus", (p) => p.connected === true);
    ana.clear();
    await host.close();
    await ana.waitFor("hostStatus", (p) => p.connected === false);
  });
});

test("ciclo de vida de la sala", async (t) => {
  await t.test("sin tiempo de gracia, la sala se borra al quedarse vacía", async (t) => {
    const server = await startServer({ songs: CANCIONES, env: { ROOM_GRACE_MINUTES: "0" } });
    t.after(() => server.stop());

    const { roomId, hostToken } = await crearSala(server);
    const host = await conectarHost(server, roomId, hostToken);
    const existe = () => fetch(`${server.baseUrl}/api/rooms/${roomId}`).then((r) => r.json());
    assert.deepEqual(await existe(), { exists: true });

    await host.close();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(await existe(), { exists: false });
  });

  await t.test("con tiempo de gracia sobrevive y el host la recupera con su cola", async (t) => {
    const server = await startServer({ songs: CANCIONES, env: { ROOM_GRACE_MINUTES: "10" } });
    t.after(() => server.stop());

    const { roomId, hostToken } = await crearSala(server);
    const host = await conectarHost(server, roomId, hostToken);
    const ana = await remotoLlamado(server, roomId, "Ana");
    ana.send({ type: "addSong", payload: { song: A } });
    await host.waitFor("queueUpdate", (p) => p.length === 1);

    await Promise.all([host.close(), ana.close()]);
    await new Promise((r) => setTimeout(r, 300));

    const resume = await fetch(`${server.baseUrl}/api/rooms/${roomId}/resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostToken }),
    });
    assert.equal(resume.status, 200);
    assert.deepEqual(await resume.json(), { queueLength: 1 }, "la cola sigue ahí");

    const vuelve = await conectarHost(server, roomId, hostToken);
    t.after(() => vuelve.close());
    const { payload } = await vuelve.waitFor("queueUpdate");
    assert.deepEqual(cancionesEnCola(payload), [A]);
  });
});

// Falla a propósito hasta que se arregle #42: describe lo que debería pasar, no lo que pasa.
// Al arreglarlo, se le quita el `todo` y debe quedar en verde.
test(
  "un mensaje enviado nada más abrir el WebSocket no se pierde (#42)",
  { todo: "pendiente de #42: el manejador se registra después de cargar la sesión" },
  async (t) => {
    const server = await startServer({ songs: CANCIONES });
    t.after(() => server.stop());

    const { roomId } = await crearSala(server);
    const res = await fetch(`${server.baseUrl}/api/dev-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ana" }),
    });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");

    // connect() y no connectToRoom(): aquí se manda sin esperar al primer mensaje, que es
    // justo lo que hace el host de verdad en su onopen (public/karaoke.js).
    const ana = await connect(`${server.wsUrl}/?sala=${roomId}`, { headers: { Cookie: cookie } });
    t.after(() => ana.close());
    ana.send({ type: "addSong", payload: { song: A } });

    await ana.waitFor("queueUpdate", (p) => p.length === 1, { timeoutMs: 3000 });
  }
);
