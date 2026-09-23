// Estructura de la pantalla principal (host): modo TV, pantalla de espera, pantalla completa.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), "utf8");
const html = read("index.html");
const css = read("css/host.css");

// Cuerpo de la primera regla CSS que tenga exactamente ese selector.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\#]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  assert.ok(match, `falta la regla ${selector} en host.css`);
  return match[1];
}

test("los scripts se cargan en orden: íconos, textos, utilidades, pantalla siempre encendida y, al final, la lógica", () => {
  const order = ["js/icons.js", "js/i18n.js", "js/shared.js", "js/wakeLock.js", "karaoke.js"].map((s) => html.indexOf(`src="${s}"`));
  assert.ok(order.every((i) => i >= 0), "falta alguno de los scripts");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});

test("el botón de pantalla completa empieza oculto y tiene nombre accesible traducible", () => {
  const button = /<button\b[^>]*id="fullscreen-btn"[^>]*>/.exec(html);
  assert.ok(button, "falta #fullscreen-btn");
  assert.match(button[0], /class="[^"]*\bhidden\b/, "debe empezar oculto (se muestra solo si el navegador lo permite)");
  assert.match(button[0], /type="button"/);
  assert.match(button[0], /aria-label="[^"]+"/);
  assert.match(button[0], /data-i18n-aria-label="host\.fullscreen"/);
  assert.match(button[0], /data-i18n-title="host\.fullscreen"/);
});

// Posición donde empieza y donde termina el <div> que se abre en `start` (cuenta los <div> anidados).
function divExtent(source, start) {
  let depth = 0;
  for (const tag of source.slice(start).matchAll(/<div\b|<\/div>/g)) {
    depth += tag[0] === "</div>" ? -1 : 1;
    if (depth === 0) return [start, start + tag.index + tag[0].length];
  }
  throw new Error("el <div> no se cierra");
}

test("la pantalla de espera va dentro de la columna del video, después de él", () => {
  const column = html.indexOf('<div class="player-column"');
  assert.ok(column >= 0, "falta la columna del video");
  const [from, to] = divExtent(html, column);
  const video = html.indexOf('id="karaokePlayer"');
  const idle = html.indexOf('id="idle-screen"');
  assert.ok(video > from && video < to, "el video debe estar dentro de la columna");
  assert.ok(idle > video && idle < to, "la pantalla de espera debe estar dentro de la columna, después del video");
  for (const id of ["idle-title", "idle-room-code", "idle-qr", "idle-hint", "remote-url"]) {
    assert.ok(html.includes(`id="${id}"`), `falta #${id}`);
  }
});

test("el QR de la pantalla de espera tiene texto alternativo traducible", () => {
  const qr = /<img\b[^>]*id="idle-qr"[^>]*>/.exec(html);
  assert.ok(qr);
  assert.match(qr[0], /data-i18n-alt="host\.qrAlt"/);
  assert.match(qr[0], /class="[^"]*\bhidden\b/, "debe empezar oculto hasta que llegue el QR");
});

test("la letra escala con la pantalla: html usa clamp() con vw y ningún tamaño de letra está en px", () => {
  const root = ruleBody("html");
  assert.match(root, /font-size:\s*clamp\([^)]*vw[^)]*\)/);
  const pixelFonts = css.split(/\r?\n/).map((line, i) => ({ line, n: i + 1 })).filter(({ line }) => /font-size:\s*[\d.]+px/.test(line));
  assert.deepEqual(pixelFonts, [], "un font-size en px no crece con la pantalla: usa rem");
});

test("las barras laterales son proporcionales a la pantalla, no un ancho fijo", () => {
  const body = css.match(/\.sidebar-left,\s*\.sidebar-right\s*\{([^}]*)\}/);
  assert.ok(body, "falta la regla de las barras laterales");
  assert.match(body[1], /flex:\s*0 0 clamp\([^)]*vw[^)]*\)/);
});

test("la pantalla de espera cubre el video y la columna es su referencia", () => {
  assert.match(ruleBody(".player-column"), /position:\s*relative/);
  const idle = ruleBody("#idle-screen");
  assert.match(idle, /position:\s*absolute/);
  assert.match(idle, /inset:\s*0/);
});

test("sin actividad se oculta el cursor y el botón, pero no si el botón tiene el foco del teclado", () => {
  assert.match(ruleBody("body.ui-idle"), /cursor:\s*none/);
  const hide = css.match(/body\.ui-idle #fullscreen-btn:not\(:focus-visible\)\s*\{([^}]*)\}/);
  assert.ok(hide, "falta la regla que oculta el botón (con :not(:focus-visible))");
  assert.match(hide[1], /opacity:\s*0/);
});

test("el botón de pantalla completa queda por encima de la bienvenida", () => {
  const zIndex = (selector) => Number(/z-index:\s*(\d+)/.exec(ruleBody(selector))[1]);
  assert.ok(zIndex("#fullscreen-btn") > zIndex("#welcome-modal"));
});

test("karaoke.js usa la pantalla de espera, la pantalla completa y el Wake Lock", () => {
  const js = read("karaoke.js");
  for (const needle of ["createWakeLock(", "requestFullscreen()", "exitFullscreen()", "fullscreenchange"]) {
    assert.ok(js.includes(needle), `karaoke.js ya no contiene ${needle}`);
  }
  // Que se use, no solo que exista: el Wake Lock se pide al crear la sala y la pantalla de espera se
  // actualiza cada vez que cambia la cola.
  assert.match(js, /if \(wakeLock\.supported\) wakeLock\.enable\(\);/);
  assert.match(js, /function renderAllSections\(\) \{\s*updateIdleScreen\(\);/);
});

test("karaoke.js arranca solo con ?autostart y no deja alert() que congele el kiosko", () => {
  const js = read("karaoke.js");
  assert.match(js, /new URLSearchParams\(location\.search\)\.has\("autostart"\)/);
  assert.match(js, /if \(autostart\) autoStartSession\(\);/);
  // Los avisos pasan por notify(), que en modo kiosko los deja en consola en vez de abrir un diálogo.
  assert.doesNotMatch(js, /\balert\(t\(/);
});
