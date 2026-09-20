const test = require("node:test");
const assert = require("node:assert/strict");
const { createWakeLock } = require("../public/js/wakeLock");

// Dobles de navigator y document con la forma mínima que usa el módulo.
function fakeEnv({ visible = true, supported = true, behavior = () => null } = {}) {
  const events = [];
  const handlers = { visibilitychange: [] };
  const doc = {
    visibilityState: visible ? "visible" : "hidden",
    addEventListener: (name, fn) => handlers[name].push(fn),
  };
  const sentinels = [];
  const nav = supported
    ? {
        wakeLock: {
          request: async (type) => {
            const error = behavior(sentinels.length);
            if (error) throw error;
            const listeners = [];
            const sentinel = {
              type,
              released: false,
              addEventListener: (name, fn) => listeners.push(fn),
              release: async () => { sentinel.released = true; },
              // Lo que hace el navegador cuando suelta el bloqueo por su cuenta.
              systemRelease: () => { sentinel.released = true; listeners.forEach((fn) => fn()); },
            };
            sentinels.push(sentinel);
            return sentinel;
          },
        },
      }
    : {};
  return {
    nav,
    doc,
    sentinels,
    events,
    onChange: (active, error) => events.push(error ? `${active}:${error.name}` : String(active)),
    setVisible(value) {
      doc.visibilityState = value ? "visible" : "hidden";
      handlers.visibilitychange.forEach((fn) => fn());
    },
  };
}
const make = (env) => createWakeLock({ nav: env.nav, doc: env.doc, onChange: env.onChange });
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("sin Wake Lock API (contexto no seguro) no hace nada y no falla", async () => {
  const env = fakeEnv({ supported: false });
  const lock = make(env);
  assert.equal(lock.supported, false);
  await lock.enable();
  await lock.disable();
  env.setVisible(true);
  assert.equal(lock.isActive(), false);
  assert.deepEqual(env.events, []);
});

test("enable pide el bloqueo de pantalla una sola vez", async () => {
  const env = fakeEnv();
  const lock = make(env);
  assert.equal(lock.supported, true);
  await lock.enable();
  await lock.enable();
  assert.equal(env.sentinels.length, 1);
  assert.equal(env.sentinels[0].type, "screen");
  assert.equal(lock.isActive(), true);
  assert.deepEqual(env.events, ["true"]);
});

test("si la pestaña no se ve, espera a que vuelva a verse", async () => {
  const env = fakeEnv({ visible: false });
  const lock = make(env);
  await lock.enable();
  assert.equal(env.sentinels.length, 0);
  env.setVisible(true);
  await tick();
  assert.equal(env.sentinels.length, 1);
  assert.equal(lock.isActive(), true);
});

test("cuando el navegador lo suelta al ocultarse la pestaña, lo vuelve a pedir al regresar", async () => {
  const env = fakeEnv();
  const lock = make(env);
  await lock.enable();
  env.sentinels[0].systemRelease();
  assert.equal(lock.isActive(), false);
  assert.deepEqual(env.events, ["true", "false"]);
  env.setVisible(false); // oculta: no se pide
  await tick();
  assert.equal(env.sentinels.length, 1);
  env.setVisible(true);
  await tick();
  assert.equal(env.sentinels.length, 2);
  assert.equal(lock.isActive(), true);
});

test("si el navegador lo suelta con la pestaña a la vista, no insiste en bucle", async () => {
  const env = fakeEnv();
  const lock = make(env);
  await lock.enable();
  env.sentinels[0].systemRelease(); // por ejemplo, ahorro de batería
  await tick();
  await tick();
  assert.equal(env.sentinels.length, 1, "no se vuelve a pedir hasta el próximo cambio de visibilidad");
  assert.equal(lock.isActive(), false);
});

test("si la petición se niega avisa con el error y lo reintenta al volver a verse", async () => {
  const denied = Object.assign(new Error("denegado"), { name: "NotAllowedError" });
  const env = fakeEnv({ behavior: (count) => (count === 0 && env.attempts++ === 0 ? denied : null) });
  env.attempts = 0;
  const lock = make(env);
  await lock.enable();
  assert.equal(lock.isActive(), false);
  assert.deepEqual(env.events, ["false:NotAllowedError"]);
  env.setVisible(true);
  await tick();
  assert.equal(lock.isActive(), true);
  assert.deepEqual(env.events, ["false:NotAllowedError", "true"]);
});

test("disable suelta el bloqueo y ya no se vuelve a pedir", async () => {
  const env = fakeEnv();
  const lock = make(env);
  await lock.enable();
  await lock.disable();
  assert.equal(env.sentinels[0].released, true);
  assert.equal(lock.isActive(), false);
  env.setVisible(true);
  await tick();
  assert.equal(env.sentinels.length, 1);
  assert.deepEqual(env.events, ["true", "false"]);
});

test("si se desactiva mientras se espera la respuesta, el bloqueo tardío se suelta", async () => {
  const env = fakeEnv();
  const lock = make(env);
  const pending = lock.enable();
  await lock.disable(); // llega antes de que termine la petición
  await pending;
  assert.equal(env.sentinels.length, 1);
  assert.equal(env.sentinels[0].released, true);
  assert.equal(lock.isActive(), false);
});

test("varias llamadas seguidas a enable no piden varios bloqueos", async () => {
  const env = fakeEnv();
  const lock = make(env);
  await Promise.all([lock.enable(), lock.enable(), lock.enable()]);
  assert.equal(env.sentinels.length, 1);
});
