// Ejecuta import_csv.js de verdad y comprueba qué quedó en la base y con qué código de salida.
// El script antes reportaba éxito y salía con 0 aunque hubiera corrompido filas o no hubiera
// leído nada, así que ni una persona ni un script podían enterarse.
const test = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sqlite3 = require("sqlite3");

const ROOT = path.join(__dirname, "..");

function ejecutar(csv, { conArchivo = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xaraoke-import-"));
  const csvPath = path.join(dir, "songs.csv");
  const dbPath = path.join(dir, "karaoke.db");
  if (conArchivo) fs.writeFileSync(csvPath, csv);

  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(ROOT, "import_csv.js")],
      { cwd: ROOT, env: { ...process.env, CSV_PATH: csvPath, DB_PATH: dbPath, NODE_ENV: "development" } },
      (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr, dbPath, dir })
    );
  });
}

function leerCanciones(dbPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(dbPath)) return resolve([]);
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(err);
      db.all("SELECT artist, title, url, filename FROM songs ORDER BY artist", (e, rows) =>
        db.close(() => (e ? reject(e) : resolve(rows)))
      );
    });
  });
}

test("importa un CSV normal y no mete la cabecera como canción", async () => {
  const r = await ejecutar(
    ["artista,titulo,url", "Queen,Bohemian Rhapsody,http://x/1.mp4", "Soda Stereo,De Música Ligera,http://x/2.mp4", ""].join("\n")
  );
  assert.equal(r.code, 0, r.stderr);
  const canciones = await leerCanciones(r.dbPath);
  assert.deepEqual(canciones.map((c) => c.artist), ["Queen", "Soda Stereo"]);
  assert.ok(!canciones.some((c) => c.artist === "artista"), "la cabecera no debe entrar");
  fs.rmSync(r.dir, { recursive: true, force: true });
});

// El caso exacto del issue: antes quedaba artista "Tyler", título "The Creator" y
// url "EARFQUAKE,http://x/2.mp4", y el script lo reportaba como éxito.
test("un artista con coma, entrecomillado, ya no corrompe la fila", async () => {
  const r = await ejecutar(
    ["artista,titulo,url", '"Tyler, The Creator",EARFQUAKE,http://x/2.mp4', ""].join("\n")
  );
  assert.equal(r.code, 0, r.stderr);
  const [c] = await leerCanciones(r.dbPath);
  assert.equal(c.artist, "Tyler, The Creator");
  assert.equal(c.title, "EARFQUAKE");
  assert.equal(c.url, "http://x/2.mp4");
  assert.equal(c.filename, "Tyler, The Creator - EARFQUAKE.mp4");
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("sin archivo CSV avisa y sale con código distinto de 0", async () => {
  const r = await ejecutar("", { conArchivo: false });
  assert.notEqual(r.code, 0, "debe poder detectarse desde un script");
  assert.match(r.stderr + r.stdout, /No se pudo leer/);
});

test("una línea rota se informa con su número y hace salir con error", async () => {
  const r = await ejecutar(
    ["artista,titulo,url", "Queen,Bohemian Rhapsody,http://x/1.mp4", "rota,sin-url", ""].join("\n")
  );
  assert.notEqual(r.code, 0, "que haya líneas sin usar debe notarse en el código de salida");
  assert.match(r.stderr + r.stdout, /línea 3/);
  const canciones = await leerCanciones(r.dbPath);
  assert.deepEqual(canciones.map((c) => c.artist), ["Queen"], "la buena sí entra");
  fs.rmSync(r.dir, { recursive: true, force: true });
});

test("reimportar lo mismo no duplica y lo dice", async () => {
  const csv = ["artista,titulo,url", "Queen,Bohemian Rhapsody,http://x/1.mp4", ""].join("\n");
  const primera = await ejecutar(csv);
  assert.equal(primera.code, 0, primera.stderr);
  assert.match(primera.stdout, /1 nueva/);

  // Segunda pasada sobre la misma base.
  const dir = primera.dir;
  const segunda = await new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(ROOT, "import_csv.js")],
      {
        cwd: ROOT,
        env: { ...process.env, CSV_PATH: path.join(dir, "songs.csv"), DB_PATH: path.join(dir, "karaoke.db") },
      },
      (err, stdout, stderr) => resolve({ code: err ? err.code ?? 1 : 0, stdout, stderr })
    );
  });
  assert.equal(segunda.code, 0, segunda.stderr);
  assert.match(segunda.stdout, /0 nueva\(s\), 1 que ya estaba/);
  assert.equal((await leerCanciones(path.join(dir, "karaoke.db"))).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("una coma sin comillas ya no corrompe en silencio: avisa y señala la línea", async () => {
  const r = await ejecutar(
    ["artista,titulo,url", "Tyler, The Creator,EARFQUAKE,http://x/2.mp4", ""].join("\n")
  );
  const salida = r.stdout + r.stderr;
  assert.match(salida, /no parece una URL/, "debe avisar");
  assert.match(salida, /línea 2/, "debe decir qué línea");
  assert.match(salida, /entrecomillar/, "debe sugerir la causa");
  fs.rmSync(r.dir, { recursive: true, force: true });
});
