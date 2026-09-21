const test = require("node:test");

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  DEFAULT_LANG,
  SUPPORTED,
  MESSAGES,
  pickLanguage,
  translate,
  applyTranslations,
} = require("../public/js/i18n");
const { normalizeSearchSuffix } = require("../lib/ytdlp");

const ROOT = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");

// Todos los .js del servidor bajo src/, recursivo: server.js se partió en módulos (#36) y las
// claves de traducción viven ahora repartidas entre ellos.
function fuentesDelServidor(dir = "src") {
  const base = path.join(__dirname, "..", dir);
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true }).flatMap((entrada) =>
    entrada.isDirectory()
      ? fuentesDelServidor(path.join(dir, entrada.name))
      : entrada.name.endsWith(".js")
        ? [path.join(dir, entrada.name)]
        : []
  );
}
const es = MESSAGES.es;
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// ---------- elección del idioma

test("sin preferencias, o con idiomas no soportados, se usa español", () => {
  assert.equal(DEFAULT_LANG, "es");
  for (const input of [undefined, null, "", "fr-FR,fr;q=0.9", "*", ["de", "pt-BR"], 42, "basura;;;q=x"]) {
    assert.equal(pickLanguage(input), "es", JSON.stringify(input));
  }
});

test("reconoce el idioma sin importar la región ni las mayúsculas", () => {
  for (const input of ["en", "en-US", "EN-gb", "en_AU", ["en-CA"]]) {
    assert.equal(pickLanguage(input), "en", JSON.stringify(input));
  }
  for (const input of ["es", "es-MX", "ES-ar", ["es-419"]]) {
    assert.equal(pickLanguage(input), "es", JSON.stringify(input));
  }
});

test("respeta el orden de preferencia de la persona", () => {
  assert.equal(pickLanguage(["fr", "en-US", "es"]), "en");
  assert.equal(pickLanguage(["es-MX", "en"]), "es");
  assert.equal(pickLanguage("en-US,es;q=0.5"), "en");
  assert.equal(pickLanguage("es;q=0.4,en;q=0.9"), "en", "el header se ordena por q, no por posición");
  assert.equal(pickLanguage("fr,en;q=0.8"), "en", "salta los idiomas no soportados hasta encontrar uno");
});

test("un idioma con q=0 está rechazado explícitamente", () => {
  assert.equal(pickLanguage("en;q=0,es"), "es");
  assert.equal(pickLanguage("en;q=0"), "es");
});

// ---------- traducción

test("translate sustituye parámetros y no interpreta patrones especiales", () => {
  assert.equal(translate("es", "remote.room", { code: "ABCD" }), "SALA: ABCD");
  assert.equal(translate("en", "remote.room", { code: "ABCD" }), "ROOM: ABCD");
  // "$&" y "$1" son patrones de String.replace: aquí deben quedar como texto.
  assert.equal(translate("en", "remote.user", { name: "$& $1 $$" }), "User: $& $1 $$");
});

test("un parámetro que no se pasa deja el marcador a la vista", () => {
  assert.equal(translate("es", "remote.room", {}), "SALA: {code}");
  assert.equal(translate("es", "remote.room"), "SALA: {code}");
});

test("una clave inexistente devuelve la propia clave; un idioma inexistente, el español", () => {
  assert.equal(translate("es", "no.existe"), "no.existe");
  assert.equal(translate("xx", "remote.logout"), es["remote.logout"]);
});

test("un texto que falta en un idioma cae en el español", () => {
  const saved = MESSAGES.en["remote.logout"];
  delete MESSAGES.en["remote.logout"];
  try {
    assert.equal(translate("en", "remote.logout"), es["remote.logout"]);
  } finally {
    MESSAGES.en["remote.logout"] = saved;
  }
});

test("los plurales usan la variante que corresponde a la cantidad", () => {
  assert.match(translate("es", "library.downloads", { n: 1 }), /^Hay 1 video ya descargado/);
  assert.match(translate("es", "library.downloads", { n: 3 }), /^Hay 3 videos ya descargados/);
  assert.match(translate("es", "library.downloads", { n: 0 }), /^Hay 0 videos/);
  assert.match(translate("en", "library.downloads", { n: 1 }), /^There is 1 video/);
  assert.match(translate("en", "library.downloads", { n: 2 }), /^There are 2 videos/);
  // En español, 1 000 000 cae en la categoría "many", que no tiene variante propia.
  assert.match(translate("es", "library.downloads", { n: 1000000 }), /^Hay 1000000 videos/);
});

// ---------- los diccionarios están completos y son coherentes

test("todos los idiomas soportados tienen diccionario, y viceversa", () => {
  assert.deepEqual([...SUPPORTED].sort(), Object.keys(MESSAGES).sort());
  assert.ok(SUPPORTED.includes(DEFAULT_LANG));
});

test("todos los idiomas tienen exactamente las mismas claves que el español", () => {
  const spanish = Object.keys(es).sort();
  for (const lang of SUPPORTED) {
    assert.deepEqual(Object.keys(MESSAGES[lang]).sort(), spanish, `las claves de "${lang}" difieren de las de "es"`);
  }
});

test("cada texto usa los mismos {parámetros} en todos los idiomas y no está vacío", () => {
  for (const lang of SUPPORTED) {
    for (const [key, text] of Object.entries(MESSAGES[lang])) {
      assert.ok(text.trim(), `${lang}/${key} está vacío`);
      assert.deepEqual(placeholders(text), placeholders(es[key]), `${lang}/${key} usa otros {parámetros} que "es"`);
    }
  }
});

test("las claves que llevan HTML solo permiten <strong>", () => {
  for (const lang of SUPPORTED) {
    for (const [key, text] of Object.entries(MESSAGES[lang])) {
      const hasTags = /[<>]/.test(text);
      assert.equal(hasTags, key.endsWith(".html"), `${lang}/${key}: solo las claves ".html" pueden llevar etiquetas`);
      if (hasTags) {
        assert.equal(text.replace(/<\/?strong>/g, "").search(/[<>]/), -1, `${lang}/${key} usa una etiqueta distinta de <strong>`);
      }
    }
  }
});

test("los plurales tienen variante 'other' en todos los idiomas", () => {
  for (const lang of SUPPORTED) {
    for (const key of Object.keys(MESSAGES[lang]).filter((k) => k.endsWith(".one"))) {
      assert.ok(MESSAGES[lang][key.replace(/\.one$/, ".other")], `${lang}/${key}: falta la variante .other`);
    }
  }
});

test("las opciones del selector de YouTube existen en el servidor y tienen etiqueta", () => {
  for (const lang of SUPPORTED) {
    const options = MESSAGES[lang]["yt.suffixOptions"].split(",");
    assert.ok(options.includes("none") && options.includes("karaoke"), `${lang}: faltan opciones básicas`);
    for (const option of options) {
      assert.equal(normalizeSearchSuffix(option), option, `${lang}: "${option}" no es un sufijo que acepte el servidor`);
      assert.ok(MESSAGES[lang][`yt.suffix.${option}`], `${lang}: falta la etiqueta yt.suffix.${option}`);
    }
  }
});

// ---------- el código y el HTML usan claves que existen

function keysUsedInCode(source) {
  const keys = new Set();
  // t("clave"), tr(req, "clave"), translate(lang, "clave"), new DownloadError(400, "clave")
  const literal = /\b(?:t\(\s*|tr\(\s*\w+,\s*|translate\(\s*[\w.]+,\s*|DownloadError\(\s*\d+,\s*)["'`]([\w.]+)["'`]/g;
  for (const m of source.matchAll(literal)) keys.add(m[1]);
  return keys;
}

test("toda clave que pide el código existe en el diccionario", () => {
  // El servidor está repartido en src/ (ver #36), así que se recorre entero en vez de mirar
  // solo server.js: si no, una clave nueva en un módulo se colaría sin traducción.
  const files = [
    "server.js",
    ...fuentesDelServidor(),
    "public/remote.js",
    "public/karaoke.js",
    "public/js/tour.js",
  ];
  let total = 0;
  for (const file of files) {
    const keys = keysUsedInCode(read(file));
    total += keys.size;
    for (const key of keys) {
      const exists = key in es || `${key}.other` in es;
      assert.ok(exists, `${file} pide la clave "${key}", que no existe en public/js/i18n.js`);
    }
  }
  // Se cuenta en total y no por archivo: tras partir el servidor (#36) hay módulos que no piden
  // ninguna clave, pero si el patrón de la prueba dejara de encontrar nada, hay que enterarse.
  assert.ok(total > 20, `solo se encontraron ${total} claves en el código: ¿cambió el patrón?`);
});

test("todo data-i18n* del HTML apunta a una clave existente, y el texto en español coincide", () => {
  for (const file of ["public/index.html", "public/remote.html"]) {
    const html = read(file);
    const tags = [...html.matchAll(/<(\w+)\b([^>]*\bdata-i18n[^>]*)>/g)];
    assert.ok(tags.length > 0, `${file}: no hay elementos marcados`);
    for (const [whole, tag, attrs] of tags) {
      for (const [, attr, key] of attrs.matchAll(/\bdata-i18n(?:-([\w-]+))?="([^"]+)"/g)) {
        assert.ok(key in es, `${file}: ${whole.slice(0, 60)}... usa la clave "${key}", que no existe`);
        if (attr && attr !== "html") {
          // El atributo real (placeholder, aria-label...) trae el texto en español de respaldo.
          const real = new RegExp(`\\s${attr}="([^"]*)"`).exec(attrs);
          assert.ok(real, `${file}: data-i18n-${attr}="${key}" sin su atributo ${attr}`);
          assert.equal(real[1], es[key], `${file}: ${attr} de "${key}" no coincide con el diccionario en español`);
        } else {
          // El texto de respaldo entre las etiquetas debe ser el del diccionario.
          const start = html.indexOf(whole) + whole.length;
          const inner = html.slice(start, html.indexOf(`</${tag}>`, start));
          assert.equal(inner, es[key], `${file}: el texto de "${key}" en el HTML no coincide con el diccionario en español`);
        }
      }
    }
  }
});

test("los scripts no escriben textos de interfaz a mano: van en el diccionario", () => {
  // Dos señales de un texto de interfaz: una cadena con letras acentuadas, ¿ o ¡, o un rótulo
  // que empieza con mayúscula seguida de minúsculas ("Quitar", "Volver a intentar").
  const accented = /(["'`])(?:(?!\1)[^\\\n]|\\.)*[áéíóúñÁÉÍÓÚÑ¿¡](?:(?!\1)[^\\\n]|\\.)*\1/;
  const capitalized = /(["'`])[A-ZÁÉÍÓÚÑ¿¡][a-záéíóúñ]+(?=[ .,:!?"'`])/;
  for (const file of ["public/remote.js", "public/karaoke.js", "public/js/shared.js", "public/js/icons.js", "public/js/tour.js"]) {
    read(file).split(/\r?\n/).forEach((line, i) => {
      // Excepciones: los console.* y los Error internos son para quien desarrolla, no para
      // quien usa la pantalla; y el valor por defecto de unknownArtist en shared.js.
      if (/console\.|new Error\(|unknownArtist = "/.test(line)) return;
      const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, "").replace(/\s\/\/.*$/, "");
      const where = `${file}:${i + 1} tiene un texto de interfaz escrito a mano: usa t("clave")`;
      assert.doesNotMatch(code, accented, where);
      assert.doesNotMatch(code, capitalized, where);
    });
  }
});

test("las respuestas de error del servidor pasan por tr(), no llevan texto fijo", () => {
  const server = ["server.js", ...fuentesDelServidor()].map((f) => read(f)).join("\n");
  const fixed = /\berror:\s*["'`]/;
  server.split("\n").forEach((line, i) => {
    assert.doesNotMatch(line, fixed, `server.js:${i + 1} responde con un texto fijo: usa tr(req, "clave")`);
  });
});

// ---------- aplicar las traducciones a un documento

function fakeElement(attrs = {}) {
  const el = {
    attrs: { ...attrs },
    textContent: "",
    innerHTML: "",
    getAttribute: (name) => el.attrs[name] ?? null,
    setAttribute: (name, value) => { el.attrs[name] = value; },
  };
  return el;
}

test("applyTranslations rellena texto, HTML y atributos según el idioma", () => {
  const text = fakeElement({ "data-i18n": "remote.logout" });
  const html = fakeElement({ "data-i18n-html": "host.qrError.html" });
  const input = fakeElement({ "data-i18n-placeholder": "remote.search.placeholder", placeholder: "x" });
  const doc = {
    querySelectorAll: (selector) => {
      const map = {
        "[data-i18n]": [text],
        "[data-i18n-html]": [html],
        "[data-i18n-placeholder]": [input],
      };
      return map[selector] || [];
    },
  };
  applyTranslations("en", doc);
  assert.equal(text.textContent, "Log out");
  assert.match(html.innerHTML, /<strong>\/remote\.html<\/strong>/);
  assert.equal(input.attrs.placeholder, "Search song or artist...");
  applyTranslations("es", doc);
  assert.equal(text.textContent, "Salir");
});
