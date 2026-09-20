const test = require("node:test");
const assert = require("node:assert/strict");
const { hardenSessionStore } = require("../lib/sessionStore");

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
// Espera a que se cumpla una condición (los temporizadores de Windows tienen ~15 ms de resolución,
// así que una espera fija sería frágil).
async function waitFor(condition, timeoutMs = 2000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("la condición no se cumplió a tiempo");
    await tick(5);
  }
}
const fsError = (code) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

// Almacén falso con la misma forma que session-file-store (callbacks). `behavior` decide, en
// cada llamada, qué error devuelve (o null); `delayMs` simula el tiempo que tarda el disco.
function fakeStore({ behavior = () => null, delayMs = 0 } = {}) {
  const calls = { set: [], touch: [], destroy: [], log: [] };
  const state = { running: 0, maxRunningPerSid: new Map(), active: new Map() };
  const run = (method, sid, done) => {
    calls[method].push(sid);
    calls.log.push(`${method}:start`);
    const active = (state.active.get(sid) || 0) + 1;
    state.active.set(sid, active);
    state.maxRunningPerSid.set(sid, Math.max(state.maxRunningPerSid.get(sid) || 0, active));
    setTimeout(() => {
      state.active.set(sid, state.active.get(sid) - 1);
      calls.log.push(`${method}:end`);
      const err = behavior(method, sid, calls[method].length);
      done(err, err ? undefined : { ok: true });
    }, delayMs);
  };
  return {
    calls,
    state,
    set: (sid, session, done) => run("set", sid, done),
    touch: (sid, session, done) => run("touch", sid, done),
    destroy: (sid, done) => run("destroy", sid, done),
  };
}

const fast = { retryDelaysMs: [1, 1, 1] };

test("un error transitorio al guardar se reintenta y termina bien", async () => {
  // Falla con EPERM las dos primeras veces y luego funciona.
  const store = hardenSessionStore(fakeStore({ behavior: (m, s, n) => (n <= 2 ? fsError("EPERM") : null) }), fast);
  const result = await new Promise((resolve) => store.set("a", {}, (err, res) => resolve({ err, res })));
  assert.equal(result.err, null);
  assert.deepEqual(result.res, { ok: true });
  assert.equal(store.calls.set.length, 3);
});

test("EBUSY y EACCES también se consideran transitorios", async () => {
  for (const code of ["EBUSY", "EACCES"]) {
    const store = hardenSessionStore(fakeStore({ behavior: (m, s, n) => (n === 1 ? fsError(code) : null) }), fast);
    const { err } = await new Promise((resolve) => store.set("a", {}, (e) => resolve({ err: e })));
    assert.equal(err, null, code);
    assert.equal(store.calls.set.length, 2, code);
  }
});

test("si el bloqueo no se quita, guardar devuelve el error tras los reintentos", async () => {
  const store = hardenSessionStore(fakeStore({ behavior: () => fsError("EPERM") }), fast);
  const { err } = await new Promise((resolve) => store.set("a", {}, (e) => resolve({ err: e })));
  assert.equal(err.code, "EPERM");
  assert.equal(store.calls.set.length, 1 + fast.retryDelaysMs.length);
});

test("un error que no es transitorio no se reintenta", async () => {
  const store = hardenSessionStore(fakeStore({ behavior: () => fsError("ENOSPC") }), fast);
  const { err } = await new Promise((resolve) => store.set("a", {}, (e) => resolve({ err: e })));
  assert.equal(err.code, "ENOSPC");
  assert.equal(store.calls.set.length, 1);
});

test("touch se hace como mucho una vez por intervalo y sesión", async () => {
  let clock = 1000;
  const store = hardenSessionStore(fakeStore(), { ...fast, touchIntervalMs: 60000, now: () => clock });
  for (let i = 0; i < 20; i++) store.touch("a", {}, () => {});
  await tick(10);
  assert.equal(store.calls.touch.length, 1, "20 peticiones simultáneas -> una sola escritura");

  clock += 59999;
  store.touch("a", {}, () => {});
  await tick(10);
  assert.equal(store.calls.touch.length, 1, "aún dentro del intervalo");

  clock += 2;
  store.touch("a", {}, () => {});
  await tick(10);
  assert.equal(store.calls.touch.length, 2, "pasado el intervalo vuelve a renovar");

  store.touch("b", {}, () => {});
  await tick(10);
  assert.equal(store.calls.touch.length, 3, "otra sesión es independiente");
});

test("touch responde sin esperar al disco", async () => {
  const store = hardenSessionStore(fakeStore({ delayMs: 200 }), fast);
  const started = Date.now();
  await new Promise((resolve) => store.touch("a", {}, resolve));
  assert.ok(Date.now() - started < 100, "la respuesta no debe esperar los 200 ms del disco");
});

test("si touch falla no es un error: se avisa y la próxima petición lo reintenta", async () => {
  const errors = [];
  let failing = true;
  const store = hardenSessionStore(fakeStore({ behavior: () => (failing ? fsError("EPERM") : null) }), {
    ...fast,
    onTouchError: (err) => errors.push(err.code),
  });
  let callbackError = "sin llamar";
  store.touch("a", {}, (err) => { callbackError = err; });
  await waitFor(() => errors.length > 0);
  assert.ok(callbackError === undefined || callbackError === null, "el callback de touch nunca lleva error");
  assert.deepEqual(errors, ["EPERM"]);
  const attemptsFirst = store.calls.touch.length;

  failing = false;
  store.touch("a", {}, () => {});
  await waitFor(() => store.calls.touch.length > attemptsFirst);
  await tick(40);
  assert.equal(store.calls.touch.length, attemptsFirst + 1, "no quedó marcada como renovada");
  assert.deepEqual(errors, ["EPERM"], "sin nuevos avisos");
});

test("guardar cuenta como escritura reciente: el touch siguiente se omite", async () => {
  const store = hardenSessionStore(fakeStore(), fast);
  await new Promise((resolve) => store.set("a", {}, resolve));
  store.touch("a", {}, () => {});
  await tick(10);
  assert.equal(store.calls.touch.length, 0);
});

test("las escrituras de una misma sesión nunca se solapan; las de sesiones distintas sí", async () => {
  const store = hardenSessionStore(fakeStore({ delayMs: 15 }), { ...fast, touchIntervalMs: 0 });
  const done = [];
  for (let i = 0; i < 5; i++) done.push(new Promise((resolve) => store.set("a", {}, resolve)));
  done.push(new Promise((resolve) => store.set("b", {}, resolve)));
  await Promise.all(done);
  assert.equal(store.state.maxRunningPerSid.get("a"), 1, "misma sesión: una a la vez");
  assert.equal(store.state.maxRunningPerSid.get("b"), 1);
  assert.equal(store.calls.set.length, 6);
});

test("las operaciones de una sesión conservan su orden", async () => {
  const order = [];
  const base = fakeStore({ delayMs: 5 });
  const store = hardenSessionStore(base, { ...fast, touchIntervalMs: 0 });
  store.set("a", {}, () => order.push("set"));
  store.touch("a", {}, () => {});
  store.destroy("a", () => order.push("destroy"));
  await waitFor(() => order.length === 2);
  assert.deepEqual(order, ["set", "destroy"]);
  // Cada operación empieza cuando terminó la anterior: set -> touch -> destroy.
  assert.deepEqual(base.calls.log, ["set:start", "set:end", "touch:start", "touch:end", "destroy:start", "destroy:end"]);
});

test("destruir una sesión olvida su renovación: si vuelve a existir, se renueva", async () => {
  const store = hardenSessionStore(fakeStore(), fast);
  store.touch("a", {}, () => {});
  await tick(10);
  await new Promise((resolve) => store.destroy("a", resolve));
  store.touch("a", {}, () => {});
  await tick(10);
  assert.equal(store.calls.touch.length, 2);
});

test("un destroy con bloqueo transitorio también se reintenta", async () => {
  const store = hardenSessionStore(fakeStore({ behavior: (m, s, n) => (n === 1 ? fsError("EBUSY") : null) }), fast);
  const err = await new Promise((resolve) => store.destroy("a", resolve));
  assert.equal(err, null);
  assert.equal(store.calls.destroy.length, 2);
});

test("devuelve el mismo almacén y mantiene lo demás intacto", () => {
  const base = fakeStore();
  base.get = () => "get original";
  assert.equal(hardenSessionStore(base, fast), base);
  assert.equal(base.get(), "get original");
});
