const sqlite3 = require("sqlite3");

// Calificaciones del karaoke (video y música, no de quien canta): un pulgar arriba (1) o abajo (-1) de
// cada persona a cada canción. Va en su propia base (ratings.db) y no en downloads.db porque las
// descargas se borran solas con el tiempo y una calificación debe sobrevivir a eso: por eso la canción
// se identifica con `song_key` ("yt:<id del video>" para las de YouTube, "lib:<archivo>" para las de la
// biblioteca) y no con el archivo descargado. Las fechas van en ISO 8601 UTC.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS ratings (
    song_key  TEXT NOT NULL,                       -- yt:<video_id> o lib:<filename>
    rater     TEXT NOT NULL,                       -- quién calificó (su nombre en la sala)
    value     INTEGER NOT NULL CHECK (value IN (-1, 1)),
    title     TEXT,                                -- título legible, solo para quien abra la base
    rated_at  TEXT NOT NULL,                       -- fecha y hora de la última calificación
    PRIMARY KEY (song_key, rater)                  -- una por persona y canción: calificar de nuevo la reemplaza
  )`;

// Abre (y crea si no existe) la base de calificaciones. `dbPath` puede ser ":memory:" (pruebas).
function openRatingsStore(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (openError) => {
      if (openError) return reject(openError);

      const run = (sql, params = []) =>
        new Promise((res, rej) =>
          db.run(sql, params, function onRun(err) {
            if (err) rej(err);
            else res(this);
          })
        );
      const get = (sql, params = []) =>
        new Promise((res, rej) =>
          db.get(sql, params, (err, row) => (err ? rej(err) : res(row)))
        );

      db.configure("busyTimeout", 3000);
      run(SCHEMA)
        .then(() =>
          resolve({
            // Guarda la calificación de `rater` a `songKey`; si ya había una, la reemplaza.
            async upsert({ songKey, rater, value, title, ratedAt }) {
              await run(
                `INSERT INTO ratings (song_key, rater, value, title, rated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (song_key, rater) DO UPDATE SET
                   value = excluded.value, title = excluded.title, rated_at = excluded.rated_at`,
                [songKey, rater, value, title ?? null, ratedAt]
              );
            },
            // Cuántos pulgares arriba y abajo tiene una canción.
            async summary(songKey) {
              const row = await get(
                `SELECT COALESCE(SUM(value = 1), 0) AS up, COALESCE(SUM(value = -1), 0) AS down
                 FROM ratings WHERE song_key = ?`,
                [songKey]
              );
              return { up: row.up, down: row.down };
            },
            close() {
              return new Promise((res, rej) => db.close((err) => (err ? rej(err) : res())));
            },
          })
        )
        .catch(reject);
    });
  });
}

module.exports = { openRatingsStore };
