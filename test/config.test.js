// Comprobación de SESSION_SECRET al arrancar (lib/config.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { checkSessionSecret, MIN_SECRET_LENGTH } = require("../lib/config");

const BUENO = "a".repeat(MIN_SECRET_LENGTH);
const PLACEHOLDER = "cambiar_por_un_secreto_aleatorio_muy_seguro";

test("un secreto largo y propio no da error ni aviso", () => {
  assert.deepEqual(checkSessionSecret(BUENO), { error: null, warning: null });
  assert.deepEqual(checkSessionSecret(BUENO, { production: true }), { error: null, warning: null });
});

test("falta el secreto: siempre es fatal, dentro y fuera de producción", () => {
  for (const valor of [undefined, null, "", "   ", 123, {}]) {
    for (const production of [false, true]) {
      const { error, warning } = checkSessionSecret(valor, { production });
      assert.ok(error, `debería fallar con ${JSON.stringify(valor)} (production=${production})`);
      assert.match(error, /SESSION_SECRET/);
      assert.equal(warning, null);
    }
  }
});

test("el mensaje de falta explica el modo de fallo y cómo generar uno", () => {
  const { error } = checkSessionSecret(undefined);
  assert.match(error, /500/, "debe decir que si no, todas las peticiones fallan con 500");
  assert.match(error, /randomBytes/, "debe traer el comando para generar uno");
});

test("el valor de ejemplo de .env.example es fatal en producción y solo aviso fuera", () => {
  const enProduccion = checkSessionSecret(PLACEHOLDER, { production: true });
  assert.ok(enProduccion.error);
  assert.equal(enProduccion.warning, null);

  const enDesarrollo = checkSessionSecret(PLACEHOLDER, { production: false });
  assert.equal(enDesarrollo.error, null);
  assert.ok(enDesarrollo.warning);
});

test("los valores de ejemplo se reconocen sin importar mayúsculas ni espacios alrededor", () => {
  for (const valor of ["  changeme  ", "SECRET", "Tu_Secreto_Aqui", ` ${PLACEHOLDER.toUpperCase()} `]) {
    assert.ok(checkSessionSecret(valor, { production: true }).error, `debería rechazar ${valor}`);
  }
});

test("un secreto corto pero propio solo avisa: no tumba un despliegue que ya venía andando", () => {
  const { error, warning } = checkSessionSecret("corto", { production: true });
  assert.equal(error, null);
  assert.match(warning, new RegExp(String(MIN_SECRET_LENGTH)));
});

test("el valor que trae .env.example es exactamente el que se detecta", () => {
  const ejemplo = fs.readFileSync(path.join(__dirname, "..", ".env.example"), "utf8");
  const match = /^SESSION_SECRET=(.+)$/m.exec(ejemplo);
  assert.ok(match, "falta SESSION_SECRET en .env.example");
  assert.ok(
    checkSessionSecret(match[1].trim(), { production: true }).error,
    "el valor de .env.example debe quedar bloqueado en producción; si se cambia allí, hay que añadirlo a PLACEHOLDER_SECRETS"
  );
});
