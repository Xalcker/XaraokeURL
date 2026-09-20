// Reglas del sistema de diseño: evitan que se cuelen de nuevo colores escritos a mano,
// emojis estructurales o variables CSS mal escritas.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const read = (p) => fs.readFileSync(p, "utf8");

const cssFiles = fs.readdirSync(path.join(PUBLIC, "css")).filter((f) => f.endsWith(".css"));
const uiFiles = [
  "index.html",
  "remote.html",
  "karaoke.js",
  "remote.js",
  ...fs.readdirSync(path.join(PUBLIC, "js")).map((f) => path.join("js", f)),
];
// Todo lo que puede escribir un color en pantalla, salvo tokens.css (que los define).
const styledFiles = [
  ...cssFiles.filter((f) => f !== "tokens.css").map((f) => path.join(PUBLIC, "css", f)),
  ...uiFiles.map((f) => path.join(PUBLIC, f)),
  path.join(ROOT, "server.js"),
];

test("el verde anterior de la marca ya no aparece en ningún archivo", () => {
  const legacy = /#1DB954|#1ed760|rgba\(\s*29\s*,\s*185\s*,\s*84/i;
  for (const file of styledFiles) {
    assert.doesNotMatch(read(file), legacy, `${path.relative(ROOT, file)} usa el verde anterior: usa var(--accent)`);
  }
});

test("el turquesa del acento se define solo en tokens.css", () => {
  const accent = /#49d6d8|rgba\(\s*73\s*,\s*214\s*,\s*216/i;
  for (const file of styledFiles) {
    assert.doesNotMatch(read(file), accent, `${path.relative(ROOT, file)} escribe el acento a mano: usa var(--accent) o var(--accent-rgb)`);
  }
  assert.match(read(path.join(PUBLIC, "css", "tokens.css")), /--accent:\s*#49d6d8/i);
});

test("toda variable CSS que se usa está definida en tokens.css", () => {
  const defined = new Set([...read(path.join(PUBLIC, "css", "tokens.css")).matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const file of styledFiles.filter((f) => f.endsWith(".css") || f.endsWith("server.js"))) {
    for (const m of read(file).matchAll(/var\((--[\w-]+)/g)) {
      assert.ok(defined.has(m[1]), `${path.relative(ROOT, file)} usa ${m[1]}, que no está definida en tokens.css`);
    }
  }
});

test("el texto sobre fondos de acento usa --on-accent (oscuro), no blanco", () => {
  const dark = read(path.join(PUBLIC, "css", "tokens.css"));
  assert.match(dark, /--on-accent:\s*var\(--brand-dark\)/);
  for (const file of ["remote.css", "host.css"]) {
    const css = read(path.join(PUBLIC, "css", file));
    // Toda regla con fondo de acento debe fijar también su color de texto.
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*background(?:-color)?:\s*var\(--accent\)[^{}]*)\}/g)) {
      const selector = m[1].trim().split("\n").pop();
      if (selector.startsWith("@") || /^(0%|50%|100%)/.test(selector)) continue;
      assert.match(m[2], /color:\s*var\(--on-accent\)/, `${file}: "${selector}" tiene fondo de acento pero no color: var(--on-accent)`);
    }
  }
});

test("los elementos con fondo de acento siguen siendo legibles al pasar el cursor", () => {
  // Con texto oscuro (--on-accent), un :hover a gris dejaría el texto ilegible.
  for (const file of ["remote.css", "host.css"]) {
    const css = read(path.join(PUBLIC, "css", file));
    const accentSelectors = [];
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*background(?:-color)?:\s*var\(--accent\)[^{}]*)\}/g)) {
      const selector = m[1].trim().split("\n").pop().trim();
      if (/^[.#][\w-]+$/.test(selector)) accentSelectors.push(selector);
    }
    for (const sel of accentSelectors) {
      for (const m of css.matchAll(/([^{}]*):hover\s*\{([^{}]*)\}/g)) {
        const selectorList = `${m[1]}:hover`.split(",").map((s) => s.trim());
        if (!selectorList.some((s) => s === `${sel}:hover`)) continue;
        const bg = /background(?:-color)?:\s*([^;]+);/.exec(m[2]);
        if (bg) assert.match(bg[1], /var\(--accent/, `${file}: ${sel}:hover cambia el fondo a "${bg[1]}", pero su texto es oscuro`);
      }
    }
  }
});

test("la interfaz no usa emojis: para los íconos existe iconSvg / data-icon", () => {
  // Rangos: flechas, técnicos (⏭ ⏸), símbolos y dingbats (⚠ ★), y emojis (planos suplementarios).
  const emoji = /[←-⇿⌀-⏿☀-➿⬀-⯿]|[\uD83C-\uD83E][\uDC00-\uDFFF]/;
  for (const file of uiFiles) {
    const lines = read(path.join(PUBLIC, file)).split("\n");
    lines.forEach((line, i) => {
      assert.doesNotMatch(line, emoji, `${file}:${i + 1} usa un emoji; usa un ícono de js/icons.js`);
    });
  }
});
