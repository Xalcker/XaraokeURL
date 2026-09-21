// Comprobaciones de la configuración que deben pasar antes de levantar el servidor.

// express-session NO lanza si falta el secreto: solo emite un aviso de deprecación al crear el
// middleware, y después responde 500 en todas las peticiones. El servidor parece haber arrancado
// bien (llega a imprimir su puerto) y no sirve absolutamente nada, que es el peor modo de fallo
// posible. Por eso se comprueba aquí, antes de construir nada.

// Valores de ejemplo que no deben llegar a producción. El primero es el que trae .env.example:
// está en un repositorio público, así que con él las cookies de sesión son falsificables.
const PLACEHOLDER_SECRETS = new Set([
  "cambiar_por_un_secreto_aleatorio_muy_seguro",
  "tu_secreto_aqui",
  "changeme",
  "secret",
]);

const MIN_SECRET_LENGTH = 32;

const GENERATE_HINT =
  "Genera uno con: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";

// Revisa SESSION_SECRET y devuelve { error, warning }, con la misma forma que los demás parsers
// de .env (parseRoomGrace, parseDownloadTtl...): `error` es fatal y el servidor no debe arrancar;
// `warning` solo se avisa por consola.
//
// Falta el secreto            -> siempre fatal (nada funcionaría).
// Es un valor de ejemplo      -> fatal en producción, aviso fuera de ella.
// Es más corto de lo deseable -> solo aviso, para no tumbar un despliegue que ya venía andando.
function checkSessionSecret(value, { production = false } = {}) {
  const secret = typeof value === "string" ? value.trim() : "";

  if (!secret) {
    return {
      error: `Falta SESSION_SECRET: sin él express-session responde 500 a todas las peticiones. ${GENERATE_HINT}`,
      warning: null,
    };
  }

  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    const message = `SESSION_SECRET sigue siendo el valor de ejemplo de .env.example, que es público: las sesiones se pueden falsificar. ${GENERATE_HINT}`;
    return production ? { error: message, warning: null } : { error: null, warning: message };
  }

  if (secret.length < MIN_SECRET_LENGTH) {
    return {
      error: null,
      warning: `SESSION_SECRET tiene ${secret.length} caracteres; se recomiendan al menos ${MIN_SECRET_LENGTH}. ${GENERATE_HINT}`,
    };
  }

  return { error: null, warning: null };
}

module.exports = {
  checkSessionSecret,
  PLACEHOLDER_SECRETS,
  MIN_SECRET_LENGTH,
};
