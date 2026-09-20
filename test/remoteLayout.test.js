// Estructura de las pantallas: que el JS encuentre lo que busca en el HTML y que las pestañas
// y los botones de solo ícono sean accesibles.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PUBLIC = path.join(__dirname, "..", "public");
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), "utf8");

const remoteHtml = read("remote.html");
const idsIn = (html) => new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

// Ids que los scripts crean por su cuenta (no están en el HTML estático).
const DYNAMIC_IDS = new Set(["song-duration", "ytSuffixSelect"]);

for (const [html, script] of [
  ["index.html", "karaoke.js"],
  ["remote.html", "remote.js"],
]) {
  test(`${script}: todo id que busca con getElementById existe en ${html}`, () => {
    const ids = idsIn(read(html));
    const wanted = [...read(script).matchAll(/getElementById\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]);
    assert.ok(wanted.length > 5, "no se encontraron llamadas a getElementById (¿cambió el patrón?)");
    for (const id of wanted) {
      assert.ok(ids.has(id) || DYNAMIC_IDS.has(id), `${script} busca #${id}, que no existe en ${html}`);
    }
  });
}

test("remote.html: ningún id está repetido", () => {
  const all = [...remoteHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(all.filter((id, i) => all.indexOf(id) !== i), []);
});

test("las pestañas apuntan a paneles que existen y solo una empieza seleccionada", () => {
  const ids = idsIn(remoteHtml);
  const tabs = [...remoteHtml.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map((m) => m[0]);
  assert.equal(tabs.length, 2);
  for (const tab of tabs) {
    const controls = /aria-controls="([^"]+)"/.exec(tab);
    assert.ok(controls && ids.has(controls[1]), `una pestaña apunta a un panel inexistente: ${tab}`);
    assert.match(tab, /aria-selected="(true|false)"/);
    assert.match(tab, /type="button"/);
  }
  assert.equal(tabs.filter((t) => /aria-selected="true"/.test(t)).length, 1);
  // La pestaña activa entra en el orden de tabulación; la otra se alcanza con las flechas.
  assert.equal(tabs.filter((t) => /tabindex="-1"/.test(t)).length, 1);
  assert.ok(!/tabindex="-1"/.test(tabs.find((t) => /aria-selected="true"/.test(t))));

  for (const panel of remoteHtml.matchAll(/<section\b[^>]*role="tabpanel"[^>]*>/g)) {
    const labelled = /aria-labelledby="([^"]+)"/.exec(panel[0]);
    assert.ok(labelled && ids.has(labelled[1]), `un panel sin pestaña que lo nombre: ${panel[0]}`);
  }
});

test("de los dos paneles, solo el de la pestaña activa empieza visible", () => {
  const panels = [...remoteHtml.matchAll(/<section\b([^>]*role="tabpanel"[^>]*)>/g)].map((m) => m[1]);
  assert.equal(panels.length, 2);
  assert.equal(panels.filter((p) => /class="[^"]*\bhidden\b/.test(p)).length, 1);
});

test("los botones de solo ícono tienen nombre accesible", () => {
  // Los del reproductor no llevan texto, así que el nombre tiene que venir de aria-label.
  for (const id of ["playPauseBtn", "skipBtn"]) {
    const button = new RegExp(`<button\\b[^>]*id="${id}"[^>]*>`).exec(remoteHtml);
    assert.ok(button, `no se encontró #${id}`);
    assert.match(button[0], /aria-label="[^"]+"/, `#${id} no tiene aria-label`);
    assert.match(button[0], /data-i18n-aria-label="[^"]+"/, `#${id} no traduce su aria-label`);
  }
});

test("la barra fija reúne, en este orden: aviso de host, mini-reproductor, aviso de turno y pestañas", () => {
  const sticky = remoteHtml.slice(remoteHtml.indexOf('id="sticky-top"'), remoteHtml.indexOf('id="search-panel"'));
  const order = ["host-status-banner", "mini-player", "turn-notification-banner", "tabs"].map((id) => sticky.indexOf(`id="${id}"`));
  assert.ok(order.every((i) => i >= 0), "falta alguno de los cuatro bloques dentro de #sticky-top");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "el orden de los bloques cambió");
});

test("la barra fija se pega arriba y tiene un fondo opaco", () => {
  const css = read("css/remote.css");
  const rule = /#sticky-top\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, "falta la regla de #sticky-top");
  assert.match(rule[1], /position:\s*sticky/);
  assert.match(rule[1], /top:\s*0\b/);
  // Opaco: con transparencia, el texto de la lista se ve a través de la barra al bajar.
  const background = /background-color:\s*([^;]+);/.exec(rule[1]);
  assert.ok(background, "la barra fija no declara background-color");
  assert.match(background[1].trim(), /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgb\()/i, `fondo no opaco: ${background[1]}`);
});
