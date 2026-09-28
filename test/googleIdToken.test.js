const test = require("node:test");
const assert = require("node:assert/strict");
const { isPlausibleIdToken, profileFromIdToken, MAX_ID_TOKEN_LENGTH } = require("../lib/googleIdToken");

const PAYLOAD = {
  sub: "1234567890",
  email: "ana@xalcker.xyz",
  email_verified: true,
  name: "Ana Pérez",
  given_name: "Ana",
  family_name: "Pérez",
  picture: "https://lh3.googleusercontent.com/a/foto",
};

test("el perfil tiene la misma forma que el que deja el login web", () => {
  const profile = profileFromIdToken(PAYLOAD, "xalcker.xyz");
  assert.equal(profile.provider, "google");
  assert.equal(profile.id, "1234567890");
  assert.equal(profile.displayName, "Ana Pérez");
  assert.deepEqual(profile.emails, [{ value: "ana@xalcker.xyz", verified: true }]);
  assert.deepEqual(profile.name, { givenName: "Ana", familyName: "Pérez" });
});

test("solo entra un correo verificado del dominio permitido", () => {
  assert.equal(profileFromIdToken({ ...PAYLOAD, email: "ana@gmail.com" }, "xalcker.xyz"), null);
  assert.equal(profileFromIdToken({ ...PAYLOAD, email_verified: false }, "xalcker.xyz"), null);
  assert.equal(profileFromIdToken({ ...PAYLOAD, email: undefined }, "xalcker.xyz"), null);
  // Que el dominio aparezca en otra parte del correo no basta.
  assert.equal(profileFromIdToken({ ...PAYLOAD, email: "ana@xalcker.xyz.evil.com" }, "xalcker.xyz"), null);
  assert.ok(profileFromIdToken({ ...PAYLOAD, email: "Ana@Xalcker.XYZ" }, "xalcker.xyz"));
  assert.equal(profileFromIdToken(null, "xalcker.xyz"), null);
});

test("sin nombre en la cuenta se usa lo de antes de la arroba", () => {
  assert.equal(profileFromIdToken({ ...PAYLOAD, name: "  " }, "xalcker.xyz").displayName, "ana");
});

test("el token tiene que ser un texto de tamaño razonable", () => {
  assert.equal(isPlausibleIdToken("a.b.c"), true);
  assert.equal(isPlausibleIdToken(""), false);
  assert.equal(isPlausibleIdToken(42), false);
  assert.equal(isPlausibleIdToken("x".repeat(MAX_ID_TOKEN_LENGTH + 1)), false);
});
