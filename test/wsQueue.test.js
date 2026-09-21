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
//
// No se da por hecho que el nombre haya quedado guardado: se comprueba con /api/me antes de
// conectar, y si no cuajó se reintenta. Un 200 en /api/dev-name no garantiza que la sesión se
// escribiera en disco (express-session responde igual si el almacén falla), y cuando eso pasa
// el servidor ve a esa persona como "Usuario Local" y el test falla mucho más adelante, con un
// mensaje que no señala la causa. Pasó una vez en CI, bajo carga, y no se reproduce en local.
async function fijarNombre(server, nombre) {
  let ultimoVisto = null;
  for (let intento = 0; intento < 3; intento++) {
    const res = await fetch(`${server.baseUrl}/api/dev-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nombre }),
    });
    assert.equal(res.status, 200, `no se pudo fijar el nombre ${nombre}`);
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    if (cookie) {
      const me = await fetch(`${server.baseUrl}/api/me`, { headers: { Cookie: cookie } }).then((r) => r.json());
      if (me.name === nombre) return cookie;
      ultimoVisto = me.name;
    } else {
      ultimoVisto = "(sin cookie de sesión)";
    }
  }
  throw new Error(
    `la sesión no conservó el nombre "${nombre}" tras 3 intentos (el servidor ve ${JSON.stringify(ultimoVisto)}). ` +
      "Sin esto el servidor encolaría a nombre del usuario por defecto y el fallo aparecería más tarde."
  );
}

async function remotoLlamado(server, roomId, nombre) {
  const cookie = await fijarNombre(server, nombre);
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

// Regresión de #42: server.js registraba su ws.on("message") dentro del callback de la sesión,
// así que cuando el handshake traía cookie (carga asíncrona, lee del disco) había una ventana en
// la que la conexión estaba abierta y el servidor no escuchaba. Lo que se mandara ahí se perdía
// sin error ni registro: 29 de cada 30 mensajes en la medición.
test("lo que se manda nada más abrir el WebSocket no se pierde (#42)", async (t) => {
  // Sin tope personal: esta prueba mide que no se pierda ningún mensaje, y las 10 canciones son
  // todas de la misma persona. Con el tope de #32 puesto chocaría por otro motivo.
  const server = await startServer({ songs: CANCIONES, env: { MAX_SONGS_PER_PERSON: "off" } });
  t.after(() => server.stop());

  const { roomId } = await crearSala(server);
  const cookie = await fijarNombre(server, "Ana");

  // connect() a secas, no connectToRoom(): aquí se manda sin esperar al primer mensaje del
  // servidor, que es justo lo que hace la pantalla principal en su onopen (public/karaoke.js).
  // Se repite unas cuantas veces porque el fallo era una carrera, no algo determinista.
  const INTENTOS = 10;
  for (let i = 0; i < INTENTOS; i++) {
    const ana = await connect(`${server.wsUrl}/?sala=${roomId}`, { headers: { Cookie: cookie } });
    ana.send({ type: "addSong", payload: { song: A } });
    await ana.waitFor("queueUpdate", (p) => p.length === i + 1, { timeoutMs: 5000 });
    await ana.close();
  }

  // Y ninguno se duplicó por el camino.
  const testigo = await connectToRoom(`${server.wsUrl}/?sala=${roomId}`);
  t.after(() => testigo.close());
  const { payload } = await testigo.waitFor("queueUpdate");
  assert.equal(payload.length, INTENTOS, "deben estar las 10, ni una perdida ni una repetida");
});

// El tope existe para que nadie llene memoria mandando sin parar antes de que el servidor sepa
// quién es. Pasarse no debe romper nada: se descarta lo que sobra y la conexión sigue sirviendo.
test("pasarse del tope de mensajes en espera no rompe la conexión (#42)", async (t) => {
  const server = await startServer({ songs: CANCIONES });
  t.after(() => server.stop());

  const { roomId } = await crearSala(server);
  const ana = await connect(`${server.wsUrl}/?sala=${roomId}`);
  t.after(() => ana.close());

  // 35 mensajes: pasan del tope de los que se guardan mientras carga la sesión (32), que es lo
  // que esta prueba quiere ejercitar, sin pasar del tope de caudal por ventana de #32 (40), que
  // se prueba aparte en test/queueLimits.test.js.
  for (let i = 0; i < 35; i++) ana.send({ type: "getQueue" });

  // La conexión sigue viva y atiende con normalidad.
  ana.clear();
  ana.send({ type: "addSong", payload: { song: A } });
  const { payload } = await ana.waitFor("queueUpdate", (p) => p.length === 1);
  assert.deepEqual(cancionesEnCola(payload), [A]);
});

// Los topes de la cola (#32) contra el servidor real: que no solo existan en lib/queueLimits.js,
// sino que el servidor los aplique y le diga a quien pidió la canción por qué no entró.
test("topes de la cola", async (t) => {
  const server = await startServer({
    songs: CANCIONES,
    env: { MAX_QUEUE_LENGTH: "4", MAX_SONGS_PER_PERSON: "2" },
  });
  t.after(() => server.stop());

  await t.test("al llegar al tope personal se rechaza y se explica", async (t) => {
    const { ana, beto } = await abrirSala(server, t);

    // Ana: 1 sonando + 2 esperando = su tope de 2 en espera.
    for (let i = 0; i < 3; i++) {
      ana.send({ type: "addSong", payload: { song: A } });
      await ana.waitFor("queueUpdate", (p) => p.length === i + 1);
    }

    ana.clear();
    ana.send({ type: "addSong", payload: { song: B } });
    const { payload } = await ana.waitFor("addSongRejected");
    assert.equal(payload.reason, "personalLimit");
    assert.equal(payload.limit, 2, "se dice cuál era el tope, para poder explicarlo");

    // Beto no se ve afectado por el tope de Ana.
    beto.clear();
    beto.send({ type: "addSong", payload: { song: C } });
    const { payload: cola } = await beto.waitFor("queueUpdate", (p) => p.length === 4);
    assert.equal(cola.filter((i) => i.name === "Beto").length, 1);
  });

  await t.test("al llenarse la sala se rechaza a todo el mundo", async (t) => {
    const { ana, beto } = await abrirSala(server, t);
    // 4 canciones (el tope de la sala): 2 de cada quien, para no toparse antes con el personal.
    for (const quien of [ana, beto, ana, beto]) quien.send({ type: "addSong", payload: { song: A } });
    await ana.waitFor("queueUpdate", (p) => p.length === 4);

    beto.clear();
    beto.send({ type: "addSong", payload: { song: B } });
    const { payload } = await beto.waitFor("addSongRejected");
    assert.equal(payload.reason, "queueFull");
    assert.equal(payload.limit, 4);
  });

  await t.test("la cola no crece más allá del tope por mucho que se insista", async (t) => {
    const { ana, beto } = await abrirSala(server, t);
    for (let i = 0; i < 50; i++) {
      ana.send({ type: "addSong", payload: { song: A } });
      beto.send({ type: "addSong", payload: { song: B } });
    }
    // Barrera: cuando llega la respuesta al getQueue, el servidor ya procesó todo lo anterior.
    ana.clear();
    ana.send({ type: "getQueue" });
    const { payload } = await ana.waitFor("queueUpdate");
    assert.ok(payload.length <= 4, `la cola quedó en ${payload.length}, debía parar en 4`);
  });

  await t.test("al liberarse un lugar se puede volver a agregar", async (t) => {
    const { host, ana } = await abrirSala(server, t);
    for (let i = 0; i < 3; i++) {
      ana.send({ type: "addSong", payload: { song: A } });
      await ana.waitFor("queueUpdate", (p) => p.length === i + 1);
    }
    ana.clear();
    ana.send({ type: "addSong", payload: { song: B } });
    await ana.waitFor("addSongRejected");

    // El host adelanta: una de Ana deja de estar esperando.
    host.send({ type: "playNext", payload: {} });
    await ana.waitFor("queueUpdate", (p) => p.length === 2);

    ana.clear();
    ana.send({ type: "addSong", payload: { song: B } });
    const { payload } = await ana.waitFor("queueUpdate", (p) => p.length === 3);
    assert.deepEqual(cancionesEnCola(payload).slice(-1), [B]);
  });
});

test("sin topes configurados la cola puede crecer (para quien lo prefiera así)", async (t) => {
  const server = await startServer({
    songs: CANCIONES,
    env: { MAX_QUEUE_LENGTH: "0", MAX_SONGS_PER_PERSON: "off" },
  });
  t.after(() => server.stop());

  const { ana } = await abrirSala(server, t);
  for (let i = 0; i < 12; i++) ana.send({ type: "addSong", payload: { song: A } });
  const { payload } = await ana.waitFor("queueUpdate", (p) => p.length === 12, { timeoutMs: 8000 });
  assert.equal(payload.length, 12);
});
