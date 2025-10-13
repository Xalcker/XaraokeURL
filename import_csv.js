const fs = require("fs");
const sqlite3 = require("sqlite3").verbose();
const DB_PATH = "./karaoke.db";
const CSV_PATH = "./songs.csv";

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    return console.error(
      "Error al conectar con la base de datos:",
      err.message
    );
  }
  console.log("Conectado a la base de datos SQLite 'karaoke.db'");
  createTableAndImport();
});

function createTableAndImport() {
  db.run(
    `CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artist TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL UNIQUE
    )`,
    (err) => {
      if (err) {
        return console.error("Error al crear la tabla:", err.message);
      }
      console.log("Tabla 'songs' asegurada.");
      importData();
    }
  );
}

function importData() {
  fs.readFile(CSV_PATH, "utf8", (err, data) => {
    if (err) {
      return console.error("Error al leer el archivo CSV:", err.message);
    }

    const rows = data.trim().split("\n");
    const sql = `INSERT OR IGNORE INTO songs (artist, title, url, filename) VALUES (?, ?, ?, ?)`;
    const stmt = db.prepare(sql);

    let count = 0;
    rows.forEach((row) => {
      const parts = row.split(",");
      if (parts.length < 3) return;

      const artist = parts[0].trim();
      const title = parts[1].trim();
      const url = parts.slice(2).join(",").trim();
      const filename = `${artist} - ${title}.mp4`;

      if (artist && title && url) {
        stmt.run(artist, title, url, filename);
        count++;
      }
    });

    stmt.finalize((err) => {
      if (err) {
        return console.error("Error al finalizar la importación:", err.message);
      }
      console.log(
        `✅ ¡Importación completada! Se procesaron ${count} canciones.`
      );
      db.close((err) => {
        if (err) {
          return console.error(err.message);
        }
        console.log("Conexión a la base de datos cerrada.");
      });
    });
  });
}
