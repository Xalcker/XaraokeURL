// Levanta server.js de verdad para las pruebas de integración.
//
// Es un proceso hijo a propósito, y no un `require("../server")`: así se ejercita el arranque real
// (comprobaciones del entorno, apertura de las tres bases, el WebSocket montado sobre el mismo
// servidor HTTP) sin tener que partir server.js antes de tener con qué respaldar el refactor.
// Cada servidor usa un puerto libre y una carpeta temporal propia, así que las pruebas no se pisan
// entre sí ni tocan los datos de quien las corre.
const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const sqlite3 = require("sqlite3");

const ROOT = path.join(__dirname, "..");
const READY_LINE = "Servidor corriendo en el puerto";
const STARTUP_TIMEOUT_MS = 30000;

// Un puerto que el sistema operativo da por libre en este momento.
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Crea un karaoke.db con las canciones que pida la prueba, para poder ejercitar la validación de
// `addSong` contra la biblioteca local. Sin canciones no se crea el archivo: el servidor arranca
// entonces en "modo sin biblioteca", que también hay que poder probar.
function createLibrary(dbPath, songs) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) return reject(err);
      db.serialize(() => {
        db.run(
          `CREATE TABLE songs (
             id INTEGER PRIMARY KEY AUTOINCREMENT,
             artist TEXT NOT NULL, title TEXT NOT NULL,
             url TEXT NOT NULL UNIQUE, filename TEXT NOT NULL UNIQUE
           )`
        );
        const stmt = db.prepare("INSERT INTO songs (artist, title, url, filename) VALUES (?, ?, ?, ?)");
        for (const s of songs) {
          stmt.run(s.artist, s.title, s.url || `http://ejemplo/${encodeURIComponent(s.filename)}`, s.filename);
        }
        stmt.finalize((e) => (e ? reject(e) : db.close((ce) => (ce ? reject(ce) : resolve()))));
      });
    });
  });
}

// Arranca el servidor y espera a que esté escuchando.
//
//   auth:  false (por defecto) levanta con DISABLE_GOOGLE_AUTH, que es como se prueba casi todo.
//          true levanta con Google OAuth activo y credenciales de mentira: alcanzan para construir
//          la estrategia, y con eso se puede comprobar que las rutas y el WebSocket piden sesión.
//   songs: canciones del catálogo local (crea karaoke.db). Vacío = modo sin biblioteca.
//   env:   variables extra (ROOM_GRACE_MINUTES, SINGER_GRACE_SECONDS...).
//
// Devuelve { port, baseUrl, wsUrl, output(), stop() }.
async function startServer({ auth = false, songs = [], env = {} } = {}) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xaraoke-test-"));
  const dbPath = path.join(dataDir, "karaoke.db");
  if (songs.length > 0) await createLibrary(dbPath, songs);

  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      DB_PATH: dbPath,
      SESSIONS_PATH: path.join(dataDir, "sessions"),
      DOWNLOADS_PATH: path.join(dataDir, "downloads"),
      DOWNLOADS_DB_PATH: path.join(dataDir, "downloads.db"),
      RATINGS_DB_PATH: path.join(dataDir, "ratings.db"),
      SESSION_SECRET: "secreto-de-prueba-suficientemente-largo-para-no-avisar",
      ...(auth
        ? { GOOGLE_CLIENT_ID: "id-de-prueba", GOOGLE_CLIENT_SECRET: "secreto-de-prueba" }
        : { DISABLE_GOOGLE_AUTH: "true" }),
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  child.stdout.on("data", (d) => (output += d));
  child.stderr.on("data", (d) => (output += d));

  const stop = async () => {
    if (!child.killed && child.exitCode === null) {
      const exited = new Promise((r) => child.once("exit", r));
      child.kill("SIGKILL");
      await exited;
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  // Manda una señal y espera a que el proceso salga por su cuenta, para poder comprobar el
  // apagado ordenado. Devuelve { code, signal }; null en `code` si lo mató la señal sin más.
  const signalAndWait = (senal = "SIGTERM", timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`el servidor no salió tras ${senal} en ${timeoutMs} ms.\n${output}`)),
        timeoutMs
      );
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        resolve({ code, signal });
      });
      child.kill(senal);
    });

  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`el servidor no arrancó en ${STARTUP_TIMEOUT_MS} ms.\n${output}`)),
        STARTUP_TIMEOUT_MS
      );
      const check = () => {
        if (output.includes(READY_LINE)) {
          clearTimeout(timer);
          resolve();
        }
      };
      child.stdout.on("data", check);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`el servidor salió con código ${code} antes de escuchar.\n${output}`));
      });
      check();
    });
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}`,
    output: () => output,
    signalAndWait,
    stop,
  };
}

module.exports = { startServer, freePort };
