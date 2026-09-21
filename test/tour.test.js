// Tutorial guiado del control remoto: sus pasos apuntan a elementos y textos que existen, y la
// tarjeta se coloca siempre dentro de la pantalla.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REMOTE_TOUR_STEPS, cardPosition } = require("../public/js/tour");
const { SUPPORTED, MESSAGES } = require("../public/js/i18n");

const PUBLIC = path.join(__dirname, "..", "public");
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), "utf8");
const remoteHtml = read("remote.html");
const ids = new Set([...remoteHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

test("cada paso resalta un elemento que existe en remote.html (o va centrado) y no se repite", () => {
  assert.ok(REMOTE_TOUR_STEPS.length > 0);
  for (const step of REMOTE_TOUR_STEPS) {
    assert.ok(step.target === null || ids.has(step.target), `el paso "${step.key}" apunta a #${step.target}, que no existe`);
  }
  const keys = REMOTE_TOUR_STEPS.map((s) => s.key);
  assert.equal(new Set(keys).size, keys.length, "hay pasos con la misma clave");
  const targets = REMOTE_TOUR_STEPS.map((s) => s.target).filter(Boolean);
  assert.equal(new Set(targets).size, targets.length, "hay dos pasos sobre el mismo elemento");
});

test("cada paso tiene título y texto en todos los idiomas", () => {
  for (const lang of SUPPORTED) {
    for (const { key } of REMOTE_TOUR_STEPS) {
      for (const part of ["title", "text"]) {
        assert.ok(MESSAGES[lang][`tour.${key}.${part}`], `${lang}: falta tour.${key}.${part}`);
      }
    }
  }
});

test("los textos del tutorial que no corresponden a un paso también existen", () => {
  for (const lang of SUPPORTED) {
    for (const key of ["open", "skip", "back", "next", "done", "counter"]) {
      assert.ok(MESSAGES[lang][`tour.${key}`], `${lang}: falta tour.${key}`);
    }
  }
});

test("el tutorial incluye el botón que lo vuelve a abrir, y ese botón está en el encabezado", () => {
  assert.ok(REMOTE_TOUR_STEPS.some((s) => s.target === "help-btn"), "ningún paso explica el botón de ayuda");
  const header = remoteHtml.slice(remoteHtml.indexOf('id="app-top"'), remoteHtml.indexOf('id="sticky-top"'));
  assert.match(header, /<button\b[^>]*id="help-btn"/, "el botón de ayuda no está en el encabezado");
  assert.match(header, /<button\b[^>]*id="help-btn"[^>]*type="button"|<button\b[^>]*type="button"[^>]*id="help-btn"/);
});

test("el HTML trae la estructura que usa tour.js", () => {
  for (const id of ["tour", "tour-spot", "tour-card", "tour-counter", "tour-title", "tour-text", "tour-skip", "tour-back", "tour-next"]) {
    assert.ok(ids.has(id), `falta #${id} en remote.html`);
  }
  const dialog = /<div\b[^>]*id="tour"[^>]*>/.exec(remoteHtml)[0];
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /aria-modal="true"/);
  assert.match(dialog, /\bhidden\b/, "el tutorial debe empezar oculto");
  // tour.js se carga antes que remote.js, que lo usa al arrancar.
  assert.ok(remoteHtml.indexOf('src="js/tour.js"') > 0);
  assert.ok(remoteHtml.indexOf('src="js/tour.js"') < remoteHtml.indexOf('src="remote.js"'));
});

test("el tutorial queda por encima de todo lo demás", () => {
  const css = read("css/remote.css");
  const zIndexOf = (selector) => Number(new RegExp(`${selector}\\s*\\{[^}]*z-index:\\s*(\\d+)`).exec(css)?.[1]);
  const tour = zIndexOf("#tour");
  for (const other of ["#toast", "#confirm-modal", "#yt-download-modal", "#rating-card", "#room-modal", "#sticky-top"]) {
    assert.ok(tour > zIndexOf(other), `#tour (${tour}) debe quedar sobre ${other} (${zIndexOf(other)})`);
  }
});

// ---------- colocación de la tarjeta

const CARD = { width: 300, height: 180 };
const PHONE = { width: 360, height: 640 };

function assertInside(position, card, viewport, margin = 12) {
  assert.ok(position.top >= margin, `arriba: ${position.top}`);
  assert.ok(position.left >= margin, `izquierda: ${position.left}`);
  assert.ok(position.top + card.height <= viewport.height - margin, `abajo: ${position.top + card.height}`);
  assert.ok(position.left + card.width <= viewport.width - margin, `derecha: ${position.left + card.width}`);
}

test("la tarjeta va debajo del elemento si cabe", () => {
  const target = { top: 60, left: 20, width: 100, height: 40 };
  const position = cardPosition(target, CARD, PHONE);
  assert.equal(position.placement, "below");
  assert.equal(position.top, 60 + 40 + 12);
  assertInside(position, CARD, PHONE);
});

test("si no cabe debajo, va arriba", () => {
  const target = { top: 500, left: 20, width: 100, height: 40 };
  const position = cardPosition(target, CARD, PHONE);
  assert.equal(position.placement, "above");
  assert.equal(position.top, 500 - 12 - CARD.height);
  assertInside(position, CARD, PHONE);
});

test("se centra horizontalmente en el elemento, sin salirse por los lados", () => {
  const middle = cardPosition({ top: 60, left: 130, width: 100, height: 40 }, CARD, PHONE);
  assert.equal(middle.left, 180 - CARD.width / 2);
  for (const left of [0, 300]) {
    assertInside(cardPosition({ top: 60, left, width: 60, height: 40 }, CARD, PHONE), CARD, PHONE);
  }
});

test("si no cabe ni arriba ni abajo, va del lado con más espacio sin salirse de la pantalla", () => {
  // Espacio libre = lo que queda hasta el borde menos el hueco y el margen (12 px cada uno).
  const moreAbove = { top: 130, left: 20, width: 320, height: 400 };   // arriba 106, abajo 86
  const above = cardPosition(moreAbove, CARD, PHONE);
  assert.equal(above.placement, "above");
  assertInside(above, CARD, PHONE);
  const moreBelow = { top: 100, left: 20, width: 320, height: 420 };   // arriba 76, abajo 96
  const below = cardPosition(moreBelow, CARD, PHONE);
  assert.equal(below.placement, "below");
  assertInside(below, CARD, PHONE);
});

test("sin elemento, la tarjeta va en el centro", () => {
  const position = cardPosition(null, CARD, PHONE);
  assert.equal(position.placement, "center");
  assert.equal(position.left, (PHONE.width - CARD.width) / 2);
  assert.equal(position.top, (PHONE.height - CARD.height) / 2);
});

test("en una pantalla más chica que la tarjeta, se queda pegada al margen", () => {
  const tiny = { width: 200, height: 150 };
  for (const target of [null, { top: 10, left: 10, width: 50, height: 20 }]) {
    const position = cardPosition(target, CARD, tiny);
    assert.equal(position.top, 12);
    assert.equal(position.left, 12);
  }
});
