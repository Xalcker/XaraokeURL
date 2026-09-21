// Topes de la cola (lib/queueLimits.js) y de mensajes por conexión (lib/wsRateLimit.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_MAX_QUEUE,
  DEFAULT_MAX_PER_PERSON,
  parseQueueLimit,
  parsePerPersonLimit,
  waitingCountFor,
  checkCanEnqueue,
} = require("../lib/queueLimits");
const { createMessageLimiter } = require("../lib/wsRateLimit");

const cola = (...nombres) => nombres.map((name, i) => ({ id: `s${i}`, name, song: `${name}${i}.mp4` }));

test("los topes por defecto son 100 en la sala y 5 por persona", () => {
  assert.equal(DEFAULT_MAX_QUEUE, 100);
  assert.equal(DEFAULT_MAX_PER_PERSON, 5);
  for (const v of [undefined, null, "", "   "]) {
    assert.deepEqual(parseQueueLimit(v), { limit: 100, warning: null });
    assert.deepEqual(parsePerPersonLimit(v), { limit: 5, warning: null });
  }
});

test("un entero se acepta y 0 u 'off' quitan el tope", () => {
  assert.deepEqual(parseQueueLimit("30"), { limit: 30, warning: null });
  for (const v of ["0", "off", "no", "ninguno", "OFF"]) {
    assert.deepEqual(parseQueueLimit(v), { limit: null, warning: null }, v);
  }
});

test("un valor inválido vuelve al de por defecto y avisa nombrando la variable", () => {
  const { limit, warning } = parseQueueLimit("muchas");
  assert.equal(limit, DEFAULT_MAX_QUEUE);
  assert.match(warning, /MAX_QUEUE_LENGTH/);
  assert.match(parsePerPersonLimit("-2").warning, /MAX_SONGS_PER_PERSON/);
  assert.match(parsePerPersonLimit("2.5").warning, /MAX_SONGS_PER_PERSON/);
});

test("la que suena no cuenta como canción en espera", () => {
  // Ana canta, y además tiene una esperando.
  assert.equal(waitingCountFor(cola("Ana", "Beto", "Ana"), "Ana"), 1);
  assert.equal(waitingCountFor(cola("Ana"), "Ana"), 0, "solo la que suena: nada esperando");
  assert.equal(waitingCountFor(cola("Ana", "Beto"), "Beto"), 1);
});

test("waitingCountFor aguanta entradas raras", () => {
  for (const q of [undefined, null, "no soy una cola"]) assert.equal(waitingCountFor(q, "Ana"), 0);
  for (const n of [undefined, "", null]) assert.equal(waitingCountFor(cola("Ana"), n), 0);
});

test("con la sala llena se rechaza y se dice cuál era el tope", () => {
  const llena = cola(...Array(10).fill("Beto"));
  const r = checkCanEnqueue(llena, "Ana", { maxQueue: 10, maxPerPerson: 100 });
  assert.deepEqual(r, { ok: false, reason: "queueFull", limit: 10 });
});

test("con el tope personal alcanzado se rechaza aunque quede sitio en la sala", () => {
  // Ana canta y tiene 3 esperando; el tope personal es 3.
  const q = cola("Ana", "Ana", "Ana", "Ana");
  const r = checkCanEnqueue(q, "Ana", { maxQueue: 100, maxPerPerson: 3 });
  assert.deepEqual(r, { ok: false, reason: "personalLimit", limit: 3 });
  // A otra persona no le afecta el tope de Ana.
  assert.deepEqual(checkCanEnqueue(q, "Beto", { maxQueue: 100, maxPerPerson: 3 }), { ok: true });
});

test("el tope de la sala manda sobre el personal cuando se dan los dos", () => {
  const q = cola("Ana", "Ana", "Ana");
  const r = checkCanEnqueue(q, "Ana", { maxQueue: 3, maxPerPerson: 1 });
  assert.equal(r.reason, "queueFull", "se avisa primero de lo que afecta a toda la sala");
});

test("sin topes (null) siempre cabe", () => {
  const q = cola(...Array(500).fill("Ana"));
  assert.deepEqual(checkCanEnqueue(q, "Ana", { maxQueue: null, maxPerPerson: null }), { ok: true });
  assert.deepEqual(checkCanEnqueue(q, "Ana", {}), { ok: true }, "sin opciones tampoco limita");
});

test("una cola vacía siempre admite la primera canción", () => {
  assert.deepEqual(checkCanEnqueue([], "Ana", { maxQueue: 1, maxPerPerson: 1 }), { ok: true });
});

// --- tope de mensajes por conexión ---

test("el limitador deja pasar hasta el tope y descarta el resto", () => {
  let ahora = 0;
  const lim = createMessageLimiter({ max: 3, windowMs: 1000, now: () => ahora });
  assert.deepEqual([lim.allow(), lim.allow(), lim.allow()], [true, true, true]);
  assert.equal(lim.allow(), false, "el cuarto se descarta");
  assert.equal(lim.dropped, 1);
});

test("al pasar la ventana se vuelve a empezar", () => {
  let ahora = 0;
  const lim = createMessageLimiter({ max: 2, windowMs: 1000, now: () => ahora });
  lim.allow();
  lim.allow();
  assert.equal(lim.allow(), false);
  ahora = 1000;
  assert.equal(lim.allow(), true, "ventana nueva");
});

test("el tope por defecto le sobra al host, que manda un timeUpdate por segundo", () => {
  let ahora = 0;
  const lim = createMessageLimiter({ now: () => ahora });
  // 10 segundos de host: un timeUpdate por segundo más algún playbackState.
  let pasaron = 0;
  for (let s = 0; s < 10; s++) {
    ahora = s * 1000;
    if (lim.allow()) pasaron++;
    if (lim.allow()) pasaron++;
  }
  assert.equal(pasaron, 20, "el host normal no debe verse afectado nunca");
  assert.equal(lim.dropped, 0);
});
