// Inicio de sesión de la app de Android: Credential Manager le entrega a la app un ID token de
// Google (un JWT firmado por Google) y la app lo manda al servidor. Aquí se decide si ese token,
// ya verificado (firma, vencimiento y audiencia los revisa google-auth-library), corresponde a
// alguien que puede entrar, y se arma con él el mismo perfil que deja passport-google-oauth20 en
// la sesión: así el resto del servidor (req.user.displayName, el WebSocket) no distingue si la
// persona entró desde el navegador o desde la app.

// Un ID token de Google mide alrededor de 1 KB; esto solo evita procesar basura enorme.
const MAX_ID_TOKEN_LENGTH = 4096;

function isPlausibleIdToken(value) {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_TOKEN_LENGTH;
}

// Devuelve el perfil de la persona, o null si no puede entrar: el correo tiene que estar
// verificado por Google y ser del dominio permitido (la misma regla que el login web).
function profileFromIdToken(payload, allowedDomain) {
  if (!payload || typeof payload !== "object") return null;
  const email = typeof payload.email === "string" ? payload.email : "";
  if (!email || payload.email_verified !== true) return null;
  if (!email.toLowerCase().endsWith(`@${String(allowedDomain).toLowerCase()}`)) return null;
  const displayName =
    (typeof payload.name === "string" && payload.name.trim()) || email.split("@")[0];
  return {
    provider: "google",
    id: String(payload.sub),
    displayName,
    name: {
      familyName: payload.family_name,
      givenName: payload.given_name,
    },
    emails: [{ value: email, verified: true }],
    photos: typeof payload.picture === "string" ? [{ value: payload.picture }] : [],
  };
}

module.exports = { isPlausibleIdToken, profileFromIdToken, MAX_ID_TOKEN_LENGTH };
