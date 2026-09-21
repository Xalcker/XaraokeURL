require("dotenv").config();
const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const { parseSongsCsv } = require("./lib/csv");

const DB_PATH =
  process.env.DB_PATH ||
  (process.env.NODE_ENV === "production" ? "/data/karaoke.db" : "./karaoke.db");
const CSV_PATH = process.env.CSV_PATH || "./songs.csv";

// Cuántas filas descartadas se detallan antes de resumir el resto.
const MAX_DESCARTADAS_LISTADAS = 10;

function abrirBase(ruta) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(ruta, (err) => (err ? reject(err) : resolve(db)));
  });
}

const run = (db, sql, params = []) =>
  new Promise((resolve, reject) =>
    db.run(sql, params, function alTerminar(err) {
      if (err) reject(err);
      else resolve(this);
    })
  );

const cerrar = (db) => new Promise((resolve) => db.close(() => resolve()));

async function importar() {
  let texto;
  try {
    texto = fs.readFileSync(CSV_PATH, "utf8");
  } catch (err) {
    throw new Error(`No se pudo leer ${CSV_PATH}: ${err.message}`, { cause: err });
  }

  const { songs, cabecera, descartadas } = parseSongsCsv(texto);
  if (cabecera) console.log("Se saltó la primera línea: son nombres de columna, no una canción.");
  if (songs.length === 0 && descartadas.length === 0) {
    throw new Error(`${CSV_PATH} no tiene ninguna canción.`);
  }

  const db = await abrirBase(DB_PATH);
  try {
    console.log(`Conectado a la base de datos SQLite en ${DB_PATH}`);
    await run(
      db,
      `CREATE TABLE IF NOT EXISTS songs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          artist TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL UNIQUE,
          filename TEXT NOT NULL UNIQUE
      )`
    );
    console.log("Tabla 'songs' asegurada.");

    // Una sola transacción: entran todas o no entra ninguna, y es muchísimo más rápido.
    await run(db, "BEGIN TRANSACTION");
    let nuevas = 0;
    let repetidas = 0;
    const fallidas = [];
    for (const song of songs) {
      try {
        const res = await run(
          db,
          "INSERT OR IGNORE INTO songs (artist, title, url, filename) VALUES (?, ?, ?, ?)",
          [song.artist, song.title, song.url, song.filename]
        );
        // INSERT OR IGNORE no falla con una repetida: simplemente no inserta nada.
        if (res.changes > 0) nuevas++;
        else repetidas++;
      } catch (err) {
        fallidas.push({ song, motivo: err.message });
      }
    }
    await run(db, "COMMIT");
    const sospechosas = songs.filter((s) => s.urlSospechosa);
    return { nuevas, repetidas, fallidas, descartadas, sospechosas, total: songs.length };
  } catch (err) {
    await run(db, "ROLLBACK").catch(() => {});
    throw err;
  } finally {
    await cerrar(db);
  }
}

function avisarDescartadas(titulo, lista, formatear) {
  if (lista.length === 0) return;
  console.warn(`⚠️  ${lista.length} ${titulo}:`);
  for (const item of lista.slice(0, MAX_DESCARTADAS_LISTADAS)) console.warn(`   ${formatear(item)}`);
  const resto = lista.length - MAX_DESCARTADAS_LISTADAS;
  if (resto > 0) console.warn(`   ...y ${resto} más.`);
}

importar()
  .then(({ nuevas, repetidas, fallidas, descartadas, sospechosas, total }) => {
    avisarDescartadas(
      "línea(s) del CSV sin usar",
      descartadas,
      (d) => `línea ${d.linea}: ${d.motivo} -> ${d.texto}`
    );
    avisarDescartadas(
      "canción(es) cuya URL no parece una URL (¿falta entrecomillar un campo con coma?)",
      sospechosas,
      (s) => `línea ${s.linea}: ${s.artist} - ${s.title} -> URL: ${s.url}`
    );
    avisarDescartadas(
      "canción(es) que la base rechazó",
      fallidas,
      (f) => `${f.song.filename}: ${f.motivo}`
    );

    console.log(
      `✅ Importación terminada: ${nuevas} nueva(s), ${repetidas} que ya estaba(n), ` +
        `${fallidas.length} con error, de ${total} leída(s). ` +
        `${descartadas.length} línea(s) del CSV sin usar.`
    );
    // Que el CSV traiga líneas rotas no es un fallo del importador, pero sí algo que quien lo
    // ejecuta (o un script) debe poder detectar sin leer la salida.
    if (fallidas.length > 0 || descartadas.length > 0) process.exitCode = 1;
  })
  .catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  });
