const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { iconSvg, ICON_NAMES } = require("../public/js/icons");

const PUBLIC = path.join(__dirname, "..", "public");
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), "utf8");

test("cada ícono es un SVG bien formado que hereda el color y se oculta a lectores de pantalla", () => {
  assert.ok(ICON_NAMES.length > 0);
  for (const name of ICON_NAMES) {
    const svg = iconSvg(name);
    assert.match(svg, /^<svg class="icon" viewBox="0 0 24 24"/, name);
    assert.match(svg, /stroke="currentColor"/, name);
    assert.match(svg, /aria-hidden="true"/, name);
    assert.match(svg, /<\/svg>$/, name);
  }
});

test("iconSvg devuelve '' para nombres que no existen, incluidos los heredados de Object", () => {
  for (const name of ["no-existe", "", undefined, null, "constructor", "toString", "__proto__", "<script>"]) {
    assert.equal(iconSvg(name), "", String(name));
  }
});

test("todos los íconos que usan el HTML y los scripts existen", () => {
  const used = new Set();
  for (const file of ["index.html", "remote.html"]) {
    for (const m of read(file).matchAll(/data-icon="([^"]+)"/g)) used.add(m[1]);
  }
  for (const m of read("remote.js").matchAll(/setLabel\([^,]+,\s*"([^"]+)"/g)) used.add(m[1]);
  // iconSvg("nombre") desde JavaScript (por ejemplo, el botón de pantalla completa del host).
  for (const file of ["remote.js", "karaoke.js"]) {
    for (const m of read(file).matchAll(/iconSvg\(\s*"([^"]+)"\s*\)/g)) used.add(m[1]);
  }

  assert.ok(used.size > 0, "no se encontró ningún uso de íconos");
  for (const name of used) {
    assert.ok(ICON_NAMES.includes(name), `el ícono "${name}" no existe en icons.js`);
  }
});
