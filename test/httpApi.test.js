// Pruebas de integración de la API HTTP, contra un servidor de verdad (ver test-helpers/testServer.js).
// A diferencia del resto de la suite, aquí se ejecuta server.js: son las que detectan que una ruta
// dejó de pedir sesión o que un código de estado cambió, cosas que mirar el código fuente no ve.
const test = require("node:test");
const assert = require("node:assert/strict");
const { startServer } = require("../test-helpers/testServer");

const CANCIONES = [
  { artist: "Queen", title: "Bohemian Rhapsody", filename: "Queen - Bohemian Rhapsody.mp4" },
  { artist: "Soda Stereo", title: "De Música Ligera", filename: "Soda Stereo - De Música Ligera.mp4" },
];

test("API HTTP sin login (modo desarrollo)", async (t) => {
  const server = await startServer({ songs: CANCIONES });
  t.after(() => server.stop());
  const get = (ruta, init) => fetch(`${server.baseUrl}${ruta}`, init);

  await t.test("crear una sala devuelve un código de 4 letras y un hostToken secreto", async () => {
    const res = await get("/api/rooms", { method: "POST" });
    assert.equal(res.status, 200);
    const { roomId, hostToken } = await res.json();
    assert.match(roomId, /^[A-Z]{4}$/);
    assert.match(hostToken, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  await t.test("dos salas seguidas no comparten ni el código ni el token", async () => {
    const a = await get("/api/rooms", { method: "POST" }).then((r) => r.json());
    const b = await get("/api/rooms", { method: "POST" }).then((r) => r.json());
    assert.notEqual(a.roomId, b.roomId);
    assert.notEqual(a.hostToken, b.hostToken);
  });

  await t.test("consultar una sala dice si existe, sin importar mayúsculas", async () => {
    const { roomId } = await get("/api/rooms", { method: "POST" }).then((r) => r.json());
    assert.deepEqual(await get(`/api/rooms/${roomId}`).then((r) => r.json()), { exists: true });
    assert.deepEqual(await get(`/api/rooms/${roomId.toLowerCase()}`).then((r) => r.json()), { exists: true });
    assert.deepEqual(await get("/api/rooms/ZZZZ").then((r) => r.json()), { exists: false });
  });

  await t.test("recuperar la sala solo funciona con su hostToken", async () => {
    const { roomId, hostToken } = await get("/api/rooms", { method: "POST" }).then((r) => r.json());
    const resume = (body) =>
      get(`/api/rooms/${roomId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    assert.equal((await resume({ hostToken })).status, 200, "con el token correcto");
    for (const intento of [{}, { hostToken: "" }, { hostToken: "otro" }, { hostToken: 42 }, { hostToken: null }]) {
      assert.equal((await resume(intento)).status, 404, `debería rechazar ${JSON.stringify(intento)}`);
    }
  });

  await t.test("recuperar una sala que no existe da 404 aunque el token tenga buena pinta", async () => {
    const res = await get("/api/rooms/ZZZZ/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hostToken: "00000000-0000-4000-8000-000000000000" }),
    });
    assert.equal(res.status, 404);
  });

  await t.test("el catálogo llega agrupado por inicial y por artista", async () => {
    const songs = await get("/api/songs").then((r) => r.json());
    assert.deepEqual(Object.keys(songs).sort(), ["Q", "S"]);
    assert.deepEqual(songs.Q.Queen, ["Queen - Bohemian Rhapsody.mp4"]);
  });

  await t.test("la URL de una canción sale del catálogo; una que no existe da 404", async () => {
    const ok = await get(`/api/song-url?song=${encodeURIComponent(CANCIONES[0].filename)}`);
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).url, /^http/);

    assert.equal((await get("/api/song-url?song=no-existe.mp4")).status, 404);
    assert.equal((await get("/api/song-url")).status, 400, "sin el parámetro es una petición mal hecha");
  });

  await t.test("el QR trae la imagen y el enlace con la sala dentro", async () => {
    const { roomId } = await get("/api/rooms", { method: "POST" }).then((r) => r.json());
    const { qrUrl, remoteUrl, joinUrl } = await get(`/api/qr?sala=${roomId}`).then((r) => r.json());
    assert.match(qrUrl, /^data:image\/png;base64,/);
    assert.match(remoteUrl, /\/remote\.html$/);
    assert.equal(joinUrl, `${remoteUrl}?sala=${roomId}`);
  });

  await t.test("un código de sala inventado en el QR se ignora en vez de viajar en el enlace", async () => {
    const { joinUrl, remoteUrl } = await get("/api/qr?sala=no-es-un-codigo").then((r) => r.json());
    assert.equal(joinUrl, remoteUrl);
  });

  await t.test("sin descargas, la lista de descargas está vacía", async () => {
    assert.deepEqual(await get("/api/downloads").then((r) => r.json()), []);
  });

  await t.test("helmet pone sus cabeceras en las respuestas", async () => {
    const res = await get("/api/downloads");
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
    assert.ok(res.headers.get("x-frame-options"), "falta X-Frame-Options");
  });

  // CSP estuvo desactivado mucho tiempo porque había scripts inline (ver #37). Este test evita
  // que vuelva a apagarse, y sobre todo que se "arregle" un inline nuevo metiendo 'unsafe-inline',
  // que es lo que haría que la política dejara de servir para nada.
  await t.test("la CSP está puesta y no permite scripts ni estilos inline", async () => {
    const csp = (await get("/")).headers.get("content-security-policy");
    assert.ok(csp, "falta la cabecera Content-Security-Policy");

    const directiva = (nombre) =>
      (csp.split(";").find((d) => d.trim().startsWith(`${nombre} `)) || "").trim();

    assert.match(directiva("script-src"), /^script-src 'self'$/, "script-src debe ser solo 'self'");
    assert.match(directiva("style-src"), /^style-src 'self'$/, "style-src debe ser solo 'self'");
    assert.doesNotMatch(csp, /unsafe-inline/, "nada de 'unsafe-inline'");
    assert.doesNotMatch(csp, /unsafe-eval/, "nada de 'unsafe-eval'");
    assert.match(directiva("object-src"), /'none'/);
    assert.match(directiva("frame-ancestors"), /'none'/);

    // Lo que el karaoke sí necesita: el QR va en data:, las miniaturas de YouTube en https,
    // y las canciones del catálogo son URLs arbitrarias que salen de songs.csv.
    assert.match(directiva("img-src"), /data:/);
    assert.match(directiva("img-src"), /https:/);
    assert.match(directiva("media-src"), /http:/);
    assert.match(directiva("connect-src"), /wss?:/);

    // En una red local se sirve por http: forzar https rompería la página y los vídeos.
    assert.doesNotMatch(csp, /upgrade-insecure-requests/);
  });

  await t.test("ya no queda nada inline que la CSP fuera a bloquear", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const dir = path.join(__dirname, "..", "public");
    for (const archivo of ["index.html", "remote.html"]) {
      const html = fs.readFileSync(path.join(dir, archivo), "utf8");
      assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, `${archivo}: script inline`);
      assert.doesNotMatch(html, /<style[\s>]/, `${archivo}: bloque <style>`);
      assert.doesNotMatch(html, /\sstyle="/, `${archivo}: atributo style=`);
      assert.doesNotMatch(html, /\son[a-z]+=/, `${archivo}: manejador en atributo (onclick, etc.)`);
    }
  });

  await t.test("crear salas está limitado: a la 11.ª en un minuto responde 429", async () => {
    // El limitador es de 10 por minuto y las pruebas de arriba ya gastaron varias, así que
    // basta con insistir hasta toparse con él.
    let visto429 = false;
    for (let i = 0; i < 15 && !visto429; i++) {
      visto429 = (await get("/api/rooms", { method: "POST" })).status === 429;
    }
    assert.ok(visto429, "nunca llegó el 429: el limitador de salas no está actuando");
  });
});

test("API HTTP con Google OAuth activo", async (t) => {
  const server = await startServer({ auth: true, songs: CANCIONES });
  t.after(() => server.stop());
  const get = (ruta) => fetch(`${server.baseUrl}${ruta}`, { redirect: "manual" });

  await t.test("las rutas del catálogo mandan a iniciar sesión", async () => {
    for (const ruta of ["/api/songs", "/api/downloads", "/api/ratings", "/api/me", "/remote.html"]) {
      const res = await get(ruta);
      assert.equal(res.status, 302, `${ruta} debería redirigir`);
      assert.equal(res.headers.get("location"), "/login", `${ruta} debería mandar a /login`);
    }
  });

  await t.test("la pantalla de login se sirve y ofrece entrar con Google", async () => {
    const res = await fetch(`${server.baseUrl}/login`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /\/auth\/google/);
  });

  await t.test("/api/dev-name no existe cuando el login está activo", async () => {
    const res = await fetch(`${server.baseUrl}/api/dev-name`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Intruso" }),
    });
    assert.equal(res.status, 404);
  });

  await t.test("crear una sala no pide sesión: el host es una pantalla sin login", async () => {
    const res = await fetch(`${server.baseUrl}/api/rooms`, { method: "POST" });
    assert.equal(res.status, 200);
  });
});
